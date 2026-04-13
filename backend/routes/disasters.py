"""
Ambee Natural Disasters API (latest and history by lat/lng).

Flow: resolve coordinates with OpenWeather geocoding (same rules as /api/weather/*),
then call Ambee with header x-api-key.

Docs: https://docs.ambeedata.com/apis/natural-disasters
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from dotenv import load_dotenv
from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required

from routes.weather import _backend_env_path, _geocode_pipeline

disasters_bp = Blueprint("disasters", __name__, url_prefix="/api/disasters")

AMBEE_LATEST_URL = "https://api.ambeedata.com/disasters/latest/by-lat-lng"
AMBEE_HISTORY_URL = "https://api.ambeedata.com/disasters/history/by-lat-lng"
_UA = "Mozilla/5.0 (compatible; SGS-Audit/1.0)"


def _load_env():
    load_dotenv(dotenv_path=_backend_env_path(), override=True)


def _ambee_request_json(url: str, api_key: str):
    req = Request(
        url,
        headers={
            "x-api-key": api_key,
            "User-Agent": _UA,
            "Accept": "application/json",
        },
    )
    try:
        with urlopen(req, timeout=60) as resp:
            return json.loads(resp.read().decode())
    except HTTPError as e:
        body = ""
        try:
            body = (e.read() or b"").decode(errors="replace")
        except Exception:
            pass
        try:
            err_j = json.loads(body) if body else {}
            msg = err_j.get("message", body) if isinstance(err_j, dict) else body
        except json.JSONDecodeError:
            msg = body or str(e.reason)
        raise RuntimeError(f"Ambee HTTP {e.code}: {msg}") from e


def _ambee_latest(lat: float, lng: float, api_key: str, limit: int, page: int):
    params = urlencode(
        {
            "lat": lat,
            "lng": lng,
            "limit": max(1, min(int(limit), 50)),
            "page": max(1, int(page)),
        }
    )
    url = f"{AMBEE_LATEST_URL}?{params}"
    return _ambee_request_json(url, api_key)


def _ambee_history(
    lat: float,
    lng: float,
    from_s: str,
    to_s: str,
    api_key: str,
    limit: int,
    page: int,
):
    params = urlencode(
        {
            "lat": lat,
            "lng": lng,
            "from": from_s.strip(),
            "to": to_s.strip(),
            "limit": max(1, min(int(limit), 50)),
            "page": max(1, int(page)),
        }
    )
    url = f"{AMBEE_HISTORY_URL}?{params}"
    return _ambee_request_json(url, api_key)


def _resolve_lat_lng_geocode(owm_key: str):
    """
    From request args: lat+lng OR q (+ OpenWeather).
    Returns (geocode_info dict, lat_f, lng_f) or (None, None, error_response) where error is (body, status).
    """
    lat_q = request.args.get("lat")
    lng_q = request.args.get("lng")
    q = (request.args.get("q") or "").strip()

    if lat_q is not None and lng_q is not None and str(lat_q).strip() != "" and str(lng_q).strip() != "":
        try:
            lat_f = float(lat_q)
            lng_f = float(lng_q)
        except (TypeError, ValueError):
            return None, None, None, (jsonify({"message": "Invalid lat or lng."}), 400)
        geocode_info = {"source": "coordinates", "lat": lat_f, "lng": lng_f}
        return geocode_info, lat_f, lng_f, None

    if q:
        if not owm_key:
            return None, None, None, (
                jsonify({"message": "OpenWeather is not configured (missing OPENWEATHER_API_KEY)."}),
                503,
            )
        try:
            raw_q, place_only, geo_q, geo = _geocode_pipeline(q, owm_key)
        except HTTPError as e:
            return None, None, None, (jsonify({"message": f"Geocoding failed: {e.code}"}), 502)
        except URLError as e:
            return None, None, None, (jsonify({"message": f"Network error: {e.reason!s}"}), 502)
        except Exception as exc:
            return None, None, None, (jsonify({"message": str(exc)}), 502)

        if not geo:
            return None, None, None, (
                jsonify({
                    "message": "No location found for geocoding. Try a shorter place name or country=LK.",
                    "geocode": {
                        "source": "openweather",
                        "query": q,
                        "place_extracted": place_only,
                        "geocode_query": geo_q,
                    },
                    "ambee": None,
                }),
                404,
            )

        first = geo[0]
        lat_f = float(first["lat"])
        lng_f = float(first["lon"])
        geocode_info = {
            "source": "openweather",
            "query": raw_q,
            "place_extracted": place_only,
            "geocode_query": geo_q,
            "lat": lat_f,
            "lng": lng_f,
            "name": first.get("name"),
            "state": first.get("state"),
            "country": first.get("country"),
        }
        return geocode_info, lat_f, lng_f, None

    return None, None, None, (
        jsonify({"message": "Provide q= (location) or both lat= and lng=."}),
        400,
    )


@disasters_bp.get("/latest-by-location")
@jwt_required()
def disasters_latest_by_location():
    """
    Geocode with OpenWeather (unless lat & lng are supplied), then Ambee latest disasters.

    Query:
      q — location label; required if lat/lng omitted.
      lat, lng — optional; if both set, OpenWeather is skipped.
      limit, page — Ambee pagination (default limit=5, page=1).
    """
    _load_env()
    owm_key = os.getenv("OPENWEATHER_API_KEY", "").strip()
    ambee_key = os.getenv("AMBEE_API_KEY", "").strip()

    if not ambee_key:
        return jsonify({"message": "Ambee is not configured (missing AMBEE_API_KEY)."}), 503

    limit = request.args.get("limit", default=5, type=int) or 5
    page = request.args.get("page", default=1, type=int) or 1

    geocode_info, lat_f, lng_f, err = _resolve_lat_lng_geocode(owm_key)
    if err:
        body, status = err
        return body, status

    try:
        ambee_data = _ambee_latest(lat_f, lng_f, ambee_key, limit, page)
    except RuntimeError as e:
        return jsonify({"message": str(e), "geocode": geocode_info, "ambee": None}), 502
    except URLError as e:
        return jsonify({"message": f"Network error: {e.reason!s}", "geocode": geocode_info, "ambee": None}), 502
    except Exception as exc:
        return jsonify({"message": str(exc), "geocode": geocode_info, "ambee": None}), 502

    return jsonify({"geocode": geocode_info, "ambee": ambee_data}), 200


@disasters_bp.get("/history-by-location")
@jwt_required()
def disasters_history_by_location():
    """
    Geocode (unless lat & lng supplied), then Ambee history by lat/lng.

    Query:
      q, lat, lng — same as /latest-by-location.
      from, to — required. Format YYYY-MM-DD HH:mm:ss (URL-encoded spaces allowed).
      limit, page — Ambee pagination (default limit=20, page=1).
    """
    _load_env()
    owm_key = os.getenv("OPENWEATHER_API_KEY", "").strip()
    ambee_key = os.getenv("AMBEE_API_KEY", "").strip()

    if not ambee_key:
        return jsonify({"message": "Ambee is not configured (missing AMBEE_API_KEY)."}), 503

    from_s = (request.args.get("from") or "").strip()
    to_s = (request.args.get("to") or "").strip()
    if not from_s or not to_s:
        return jsonify({
            "message": "Query parameters from= and to= are required (format YYYY-MM-DD HH:mm:ss).",
        }), 400

    limit = request.args.get("limit", default=20, type=int) or 20
    page = request.args.get("page", default=1, type=int) or 1

    geocode_info, lat_f, lng_f, err = _resolve_lat_lng_geocode(owm_key)
    if err:
        body, status = err
        return body, status

    try:
        ambee_data = _ambee_history(lat_f, lng_f, from_s, to_s, ambee_key, limit, page)
    except RuntimeError as e:
        return jsonify({"message": str(e), "geocode": geocode_info, "ambee": None}), 502
    except URLError as e:
        return jsonify({"message": f"Network error: {e.reason!s}", "geocode": geocode_info, "ambee": None}), 502
    except Exception as exc:
        return jsonify({"message": str(exc), "geocode": geocode_info, "ambee": None}), 502

    return jsonify({
        "geocode": geocode_info,
        "from": from_s,
        "to": to_s,
        "ambee": ambee_data,
    }), 200
