import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from typing import Optional

from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required, get_jwt_identity

from config.db import get_db

map_bp = Blueprint("map", __name__, url_prefix="/api/map")

MAX_LOCATIONS = 50
MAX_REGIONS = 50
NOMINATIM_URL = "https://nominatim.openstreetmap.org/reverse"
NOMINATIM_SEARCH = "https://nominatim.openstreetmap.org/search"
# Nominatim requires a valid User-Agent identifying the application.
UA = "SGS-Audit-Platform/1.0 (audit-app; contact via organisation)"

_last_nominatim_call = 0.0


def _rate_limit_nominatim():
    global _last_nominatim_call
    now = time.monotonic()
    elapsed = now - _last_nominatim_call
    if elapsed < 1.1:
        time.sleep(1.1 - elapsed)
    _last_nominatim_call = time.monotonic()


def _nominatim_get_json(url: str):
    _rate_limit_nominatim()
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _simplified_from_hits(hits: list) -> list:
    skip_classes = frozenset(
        {"highway", "waterway", "railway", "aeroway", "shop", "amenity", "tourism"}
    )
    seen = set()
    out = []
    for h in hits:
        if not isinstance(h, dict):
            continue
        cls = (h.get("class") or "").lower()
        if cls in skip_classes:
            continue
        item = _simplify_search_hit(h)
        pid = item.get("place_id")
        if pid is None or pid in seen:
            continue
        seen.add(pid)
        out.append(item)
        if len(out) >= 10:
            break
    return out


def _search_region_hits(q: str, countrycodes: Optional[str]) -> list:
    params = {
        "q": q,
        "format": "json",
        "addressdetails": "1",
        "limit": "12",
        "polygon_geojson": "0",
    }
    if countrycodes and re.fullmatch(r"[a-z]{2}(,[a-z]{2})*", countrycodes):
        params["countrycodes"] = countrycodes
    url = f"{NOMINATIM_SEARCH}?{urllib.parse.urlencode(params)}"
    try:
        data = _nominatim_get_json(url)
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"Search service error: {e.code}") from e
    except Exception as exc:
        raise RuntimeError(f"Search failed: {str(exc)}") from exc
    return data if isinstance(data, list) else []


@map_bp.get("/reverse")
@jwt_required()
def reverse_geocode():
    lat = request.args.get("lat", type=float)
    lon = request.args.get("lon", type=float)
    if lat is None or lon is None:
        return jsonify({"message": "lat and lon query parameters are required."}), 400
    if not (-90 <= lat <= 90) or not (-180 <= lon <= 180):
        return jsonify({"message": "Invalid coordinates."}), 400

    params = urllib.parse.urlencode(
        {"lat": lat, "lon": lon, "format": "json", "addressdetails": "0"}
    )
    url = f"{NOMINATIM_URL}?{params}"

    _rate_limit_nominatim()
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        return jsonify({"message": f"Geocoding service error: {e.code}"}), 502
    except Exception as exc:
        return jsonify({"message": f"Geocoding failed: {str(exc)}"}), 502

    display = data.get("display_name") or data.get("name") or f"{lat:.5f}, {lon:.5f}"
    return jsonify(
        {
            "lat": lat,
            "lon": lon,
            "address": display,
            "raw": data,
        }
    ), 200


@map_bp.get("/locations")
@jwt_required()
def get_locations():
    user_id = get_jwt_identity()
    doc = get_db()["user_map_locations"].find_one({"user_id": user_id})
    if not doc:
        return jsonify({"locations": [], "updated_at": None}), 200
    locs = doc.get("locations", [])
    return jsonify(
        {
            "locations": locs,
            "updated_at": doc["updated_at"].isoformat() if doc.get("updated_at") else None,
        }
    ), 200


@map_bp.put("/locations")
@jwt_required()
def save_locations():
    user_id = get_jwt_identity()
    body = request.get_json(silent=True) or {}
    locations = body.get("locations")

    if not isinstance(locations, list):
        return jsonify({"message": "locations must be an array."}), 400
    if len(locations) > MAX_LOCATIONS:
        return jsonify({"message": f"At most {MAX_LOCATIONS} locations allowed."}), 422

    cleaned = []
    for i, item in enumerate(locations):
        if not isinstance(item, dict):
            return jsonify({"message": f"Invalid item at index {i}."}), 400
        try:
            lat = float(item["lat"])
            lon = float(item["lon"])
        except (KeyError, TypeError, ValueError):
            return jsonify({"message": f"Each location needs lat and lon (numbers) at index {i}."}), 400
        if not (-90 <= lat <= 90) or not (-180 <= lon <= 180):
            return jsonify({"message": f"Invalid coordinates at index {i}."}), 422
        addr = str(item.get("address", "")).strip() or f"{lat:.5f}, {lon:.5f}"
        cleaned.append({"lat": lat, "lon": lon, "address": addr[:500]})

    now = datetime.now(timezone.utc)
    get_db()["user_map_locations"].update_one(
        {"user_id": user_id},
        {"$set": {"user_id": user_id, "locations": cleaned, "updated_at": now}},
        upsert=True,
    )

    return jsonify(
        {
            "message": "Map saved.",
            "locations": cleaned,
            "updated_at": now.isoformat(),
        }
    ), 200


def _classify_region(hit: dict) -> str:
    """Best-effort: state vs district vs broader administrative region."""
    addr = hit.get("address") or {}
    addrtype = (hit.get("addresstype") or addr.get("type") or "").lower()
    if addrtype == "state":
        return "state"
    if addrtype in ("county", "district", "municipality", "city_district", "region"):
        return "district"
    ext = hit.get("extratags") or {}
    level = ext.get("admin_level")
    if level:
        try:
            lv = int(level)
            if lv <= 4:
                return "state"
            if lv <= 7:
                return "district"
        except ValueError:
            pass
    cls = (hit.get("class") or "").lower()
    typ = (hit.get("type") or "").lower()
    if cls == "boundary" and typ == "administrative":
        if addr.get("state") and not (addr.get("county") or addr.get("district") or addr.get("city")):
            return "state"
        if addr.get("county") or addr.get("district"):
            return "district"
    return "region"


def _simplify_search_hit(hit: dict) -> dict:
    place_id = hit.get("place_id")
    display = hit.get("display_name") or hit.get("name") or ""
    lat = hit.get("lat")
    lon = hit.get("lon")
    bbox = hit.get("boundingbox")
    kind = _classify_region(hit)
    try:
        lat_f = float(lat) if lat is not None else None
        lon_f = float(lon) if lon is not None else None
    except (TypeError, ValueError):
        lat_f, lon_f = None, None
    return {
        "place_id": place_id,
        "display_name": display[:500],
        "region_type": kind,
        "lat": lat_f,
        "lon": lon_f,
        "bbox": bbox if isinstance(bbox, list) and len(bbox) == 4 else None,
    }


@map_bp.get("/regions/search")
@jwt_required()
def regions_search():
    q = (request.args.get("q") or "").strip()
    if len(q) < 2:
        return jsonify({"message": "Query must be at least 2 characters."}), 400
    if len(q) > 200:
        return jsonify({"message": "Query too long."}), 400

    countrycodes = (request.args.get("countrycodes") or "").strip().lower().replace(" ", "")
    cc = countrycodes if re.fullmatch(r"[a-z]{2}(,[a-z]{2})*", countrycodes) else None

    try:
        hits = _search_region_hits(q, cc)
    except RuntimeError as exc:
        return jsonify({"message": str(exc)}), 502

    return jsonify({"results": _simplified_from_hits(hits)}), 200


def _pick_region_option(simplified: list, prefer: str):
    """Prefer a hit classified as prefer ('state' or 'district'), else first usable."""
    if not simplified:
        return None
    for item in simplified:
        if item.get("region_type") == prefer:
            return item
    for item in simplified:
        if item.get("region_type") == "region":
            return item
    return simplified[0]


@map_bp.get("/regions/from-point")
@jwt_required()
def regions_from_point():
    """Reverse-geocode a click and suggest matching state / district boundaries."""
    lat = request.args.get("lat", type=float)
    lon = request.args.get("lon", type=float)
    if lat is None or lon is None:
        return jsonify({"message": "lat and lon query parameters are required."}), 400
    if not (-90 <= lat <= 90) or not (-180 <= lon <= 180):
        return jsonify({"message": "Invalid coordinates."}), 400

    params = urllib.parse.urlencode(
        {
            "lat": lat,
            "lon": lon,
            "format": "json",
            "addressdetails": "1",
            "extratags": "1",
        }
    )
    url = f"{NOMINATIM_URL}?{params}"
    try:
        data = _nominatim_get_json(url)
    except urllib.error.HTTPError as e:
        return jsonify({"message": f"Geocoding service error: {e.code}"}), 502
    except Exception as exc:
        return jsonify({"message": f"Geocoding failed: {str(exc)}"}), 502

    if not isinstance(data, dict):
        data = {}

    addr = data.get("address") or {}
    country_code = (addr.get("country_code") or "").lower() or None
    state_name = (addr.get("state") or "").strip()
    district_name = (
        addr.get("state_district")
        or addr.get("county")
        or addr.get("city_district")
        or addr.get("region")
        or ""
    )
    district_name = str(district_name).strip()
    if district_name and state_name and district_name.lower() == state_name.lower():
        district_name = ""

    summary = (
        data.get("display_name")
        or data.get("name")
        or f"{lat:.5f}, {lon:.5f}"
    )

    options = []
    seen_pid = set()

    def append_unique(item, label_type: str):
        if not item:
            return
        pid = item.get("place_id")
        if pid is None or pid in seen_pid:
            return
        seen_pid.add(pid)
        row = dict(item)
        row["region_type"] = label_type
        options.append(row)

    try:
        if state_name:
            hits_s = _search_region_hits(state_name, country_code)
            sim_s = _simplified_from_hits(hits_s)
            st = _pick_region_option(sim_s, "state")
            if st:
                append_unique(st, "state")

        if district_name:
            q_d = f"{district_name}, {state_name}" if state_name else district_name
            hits_d = _search_region_hits(q_d, country_code)
            sim_d = _simplified_from_hits(hits_d)
            dist = _pick_region_option(sim_d, "district")
            if dist:
                append_unique(dist, "district")
    except RuntimeError as exc:
        return jsonify({"message": str(exc)}), 502

    return (
        jsonify(
            {
                "lat": lat,
                "lon": lon,
                "summary": str(summary)[:500],
                "options": options,
            }
        ),
        200,
    )


@map_bp.get("/regions/locations")
@jwt_required()
def get_regions():
    user_id = get_jwt_identity()
    doc = get_db()["user_map_regions"].find_one({"user_id": user_id})
    if not doc:
        return jsonify({"regions": [], "updated_at": None}), 200
    return jsonify(
        {
            "regions": doc.get("regions", []),
            "updated_at": doc["updated_at"].isoformat() if doc.get("updated_at") else None,
        }
    ), 200


@map_bp.put("/regions/locations")
@jwt_required()
def save_regions():
    user_id = get_jwt_identity()
    body = request.get_json(silent=True) or {}
    regions = body.get("regions")

    if not isinstance(regions, list):
        return jsonify({"message": "regions must be an array."}), 400
    if len(regions) > MAX_REGIONS:
        return jsonify({"message": f"At most {MAX_REGIONS} regions allowed."}), 422

    cleaned = []
    seen_ids = set()
    for i, item in enumerate(regions):
        if not isinstance(item, dict):
            return jsonify({"message": f"Invalid item at index {i}."}), 400
        pid = item.get("place_id")
        if pid is None:
            return jsonify({"message": f"Each region needs place_id at index {i}."}), 400
        pid_str = str(pid)
        if pid_str in seen_ids:
            continue
        seen_ids.add(pid_str)
        display = str(item.get("display_name", "")).strip()
        if not display:
            return jsonify({"message": f"display_name required at index {i}."}), 400
        rtype = str(item.get("region_type", "region")).lower()
        if rtype not in ("state", "district", "region"):
            rtype = "region"
        lat = item.get("lat")
        lon = item.get("lon")
        row = {
            "place_id": pid_str,
            "display_name": display[:500],
            "region_type": rtype,
        }
        if lat is not None and lon is not None:
            try:
                row["lat"] = float(lat)
                row["lon"] = float(lon)
            except (TypeError, ValueError):
                pass
        bbox = item.get("bbox")
        if isinstance(bbox, list) and len(bbox) == 4:
            row["bbox"] = bbox
        cleaned.append(row)

    now = datetime.now(timezone.utc)
    get_db()["user_map_regions"].update_one(
        {"user_id": user_id},
        {"$set": {"user_id": user_id, "regions": cleaned, "updated_at": now}},
        upsert=True,
    )

    return jsonify(
        {
            "message": "Region map saved.",
            "regions": cleaned,
            "updated_at": now.isoformat(),
        }
    ), 200
