"""
OpenWeather: Geocoding API uses short place names.

For labels like "STAR GARMENTS ( PVT) LTD - KOGGALA", only the part after the last
" - " is sent (e.g. KOGGALA), optionally with country ",LK" for Sri Lanka.
"""

from __future__ import annotations

import os
import re
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from dotenv import load_dotenv
from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required


def _backend_env_path():
    return Path(__file__).resolve().parents[1] / ".env"


weather_bp = Blueprint("weather", __name__, url_prefix="/api/weather")

GEO_URL = "https://api.openweathermap.org/geo/1.0/direct"
CURRENT_URL = "https://api.openweathermap.org/data/2.5/weather"
FORECAST_URL = "https://api.openweathermap.org/data/2.5/forecast"

_OWM_UA = "Mozilla/5.0 (compatible; SGS-Audit/1.0)"


def _get_json(url: str):
    req = Request(url, headers={"User-Agent": _OWM_UA})
    with urlopen(req, timeout=45) as resp:
        return __import__("json").loads(resp.read().decode())


def _split_prefix_and_place(raw: str) -> tuple[str, str]:
    """
    "GEORGIA DC - SAVANNAH" -> ("GEORGIA DC", "SAVANNAH").
    Single segment -> ("", full string).
    """
    raw = (raw or "").strip()
    if not raw:
        return "", ""
    normalized = raw.replace("\u2013", "-").replace("\u2014", "-").replace("\u2212", "-")
    parts = re.split(r"\s*-\s*", normalized)
    if len(parts) > 1:
        prefix = " - ".join(parts[:-1]).strip()
        place = parts[-1].strip()
        return prefix, place if place else raw
    return "", raw


def _extract_place_name(raw: str) -> str:
    """
    From "STAR GARMENTS ( PVT) LTD - KOGGALA" return "KOGGALA".

    Uses the segment after the last hyphen surrounded by optional spaces
    (ASCII hyphen, en-dash, em-dash). Does not send the company prefix to OpenWeather.
    """
    _, place = _split_prefix_and_place(raw)
    return place


def _openweather_geocode_q(place: str, country_code: str | None) -> str:
    """
    Build `q` for https://api.openweathermap.org/geo/1.0/direct
    e.g. "KOGGALA,LK" — small towns often need the country code.
    """
    place = place.strip()
    if not place:
        return ""
    if not country_code or len(country_code) != 2:
        return place
    cc = country_code.upper()
    # Already "Name,XX"
    if "," in place:
        last = place.rsplit(",", 1)[-1].strip().upper()
        if len(last) == 2 and last.isalpha():
            return place
    return f"{place},{cc}"


def _resolve_country_code() -> str | None:
    """
    ISO 3166-1 alpha-2 for geocoding (default LK for Sri Lanka sites).

    Override per request: ?country=LK or ?country= (empty = no country suffix).
    Override in backend/.env: OPENWEATHER_GEO_COUNTRY=LK
    """
    qp = request.args.get("country")
    if qp is not None:
        qp = qp.strip()
        if qp == "":
            return None
        return qp[:2].upper() if len(qp) >= 2 else None

    env = (os.getenv("OPENWEATHER_GEO_COUNTRY") or "").strip()
    if env == "":
        return "LK"
    return env[:2].upper()


# US state names in site prefix (e.g. "GEORGIA DC - SAVANNAH" -> GA). Longest first for "WEST VIRGINIA" vs "VIRGINIA".
_US_STATE_NAMES_CODES: list[tuple[str, str]] = [
    ("DISTRICT OF COLUMBIA", "DC"),
    ("NORTH CAROLINA", "NC"),
    ("SOUTH CAROLINA", "SC"),
    ("NORTH DAKOTA", "ND"),
    ("SOUTH DAKOTA", "SD"),
    ("NEW HAMPSHIRE", "NH"),
    ("NEW JERSEY", "NJ"),
    ("NEW MEXICO", "NM"),
    ("NEW YORK", "NY"),
    ("WEST VIRGINIA", "WV"),
    ("RHODE ISLAND", "RI"),
    ("ALABAMA", "AL"),
    ("ALASKA", "AK"),
    ("ARIZONA", "AZ"),
    ("ARKANSAS", "AR"),
    ("CALIFORNIA", "CA"),
    ("COLORADO", "CO"),
    ("CONNECTICUT", "CT"),
    ("DELAWARE", "DE"),
    ("FLORIDA", "FL"),
    ("GEORGIA", "GA"),
    ("HAWAII", "HI"),
    ("IDAHO", "ID"),
    ("ILLINOIS", "IL"),
    ("INDIANA", "IN"),
    ("IOWA", "IA"),
    ("KANSAS", "KS"),
    ("KENTUCKY", "KY"),
    ("LOUISIANA", "LA"),
    ("MAINE", "ME"),
    ("MARYLAND", "MD"),
    ("MASSACHUSETTS", "MA"),
    ("MICHIGAN", "MI"),
    ("MINNESOTA", "MN"),
    ("MISSISSIPPI", "MS"),
    ("MISSOURI", "MO"),
    ("MONTANA", "MT"),
    ("NEBRASKA", "NE"),
    ("NEVADA", "NV"),
    ("OHIO", "OH"),
    ("OKLAHOMA", "OK"),
    ("OREGON", "OR"),
    ("PENNSYLVANIA", "PA"),
    ("TENNESSEE", "TN"),
    ("TEXAS", "TX"),
    ("UTAH", "UT"),
    ("VERMONT", "VT"),
    ("VIRGINIA", "VA"),
    ("WASHINGTON", "WA"),
    ("WISCONSIN", "WI"),
    ("WYOMING", "WY"),
]
_US_STATE_NAMES_CODES.sort(key=lambda x: -len(x[0]))


def _us_state_code_from_prefix(prefix: str) -> str | None:
    """If the left part of 'PREFIX - CITY' names a US state/DC, return its USPS code."""
    if not prefix or not prefix.strip():
        return None
    p = re.sub(r"\s+", " ", prefix.upper()).strip()
    for name, code in _US_STATE_NAMES_CODES:
        if name in p:
            return code
    return None


def _openweather_q_city_state_us(place: str, state_code: str) -> str:
    """City,state,country for OpenWeather direct geocoding (US)."""
    return f"{place.strip()},{state_code.upper()},US"


def _openweather_geocode_list(key: str, geo_q: str):
    if not geo_q:
        return []
    params = urlencode({"q": geo_q, "limit": 5, "appid": key})
    geo_url = f"{GEO_URL}?{params}"
    data = _get_json(geo_url)
    return data if isinstance(data, list) else []


def _geocode_pipeline(raw_q: str, key: str):
    """
    Returns (original_q, place_only, q_sent_to_openweather, geo_list).

    If the prefix before the last '-' contains a US state name (e.g. GEORGIA DC - SAVANNAH),
    uses SAVANNAH,GA,US instead of SAVANNAH,LK. If LK is used and no results, retries with
    the city name only (no country) so international sites still resolve.
    """
    prefix, place = _split_prefix_and_place(raw_q)
    if not place:
        return raw_q, "", "", []

    us_state = _us_state_code_from_prefix(prefix)
    if us_state:
        geo_q = _openweather_q_city_state_us(place, us_state)
    else:
        cc = _resolve_country_code()
        geo_q = _openweather_geocode_q(place, cc)

    geo = _openweather_geocode_list(key, geo_q)

    if not geo and not us_state:
        cc = _resolve_country_code()
        if cc == "LK":
            geo_q2 = place
            geo = _openweather_geocode_list(key, geo_q2)
            if geo:
                geo_q = geo_q2

    return raw_q, place, geo_q, geo


@weather_bp.get("/lookup")
@jwt_required()
def weather_lookup():
    """
    Geocode (place name only + optional ,LK), then current weather + forecast.

    Query: q=... (full label ok — company part is stripped before OpenWeather).
    Optional: country=LK | country= (empty disables suffix).
    """
    load_dotenv(dotenv_path=_backend_env_path(), override=True)
    key = os.getenv("OPENWEATHER_API_KEY", "").strip()
    if not key:
        return jsonify({"message": "Weather is not configured (missing OPENWEATHER_API_KEY)."}), 503

    q = (request.args.get("q") or "").strip()
    if not q:
        return jsonify({"message": "Query parameter q is required."}), 400

    units = request.args.get("units", "metric")
    if units not in ("metric", "imperial", "standard"):
        units = "metric"

    try:
        raw_q, place_only, geo_q, geo = _geocode_pipeline(q, key)
    except HTTPError as e:
        return jsonify({"message": f"Geocoding failed: {e.code}"}), 502
    except URLError as e:
        return jsonify({"message": f"Network error: {e.reason!s}"}), 502
    except Exception as exc:
        return jsonify({"message": str(exc)}), 502

    if not geo:
        return jsonify({
            "message": "No location found for this search. Try ?country=LK or a larger nearby town.",
            "query": q,
            "place_extracted": place_only,
            "geocode_query": geo_q,
            "geocoding": [],
            "current": None,
            "forecast": None,
        }), 404

    first = geo[0]
    lat = first.get("lat")
    lon = first.get("lon")

    common = urlencode({"lat": lat, "lon": lon, "appid": key, "units": units})
    cur_url = f"{CURRENT_URL}?{common}"
    fc_url = f"{FORECAST_URL}?{common}"

    try:
        current = _get_json(cur_url)
        forecast = _get_json(fc_url)
    except Exception as exc:
        return jsonify({
            "message": str(exc),
            "query": q,
            "place_extracted": place_only,
            "geocode_query": geo_q,
            "geocoding": geo,
            "current": None,
            "forecast": None,
        }), 502

    return jsonify({
        "query": q,
        "place_extracted": place_only,
        "geocode_query": geo_q,
        "geocoding": geo,
        "current": current,
        "forecast": forecast,
        "units": units,
    }), 200


@weather_bp.get("/geocode")
@jwt_required()
def weather_geocode():
    """Lat/lon only; same stripping and country rules as /lookup."""
    load_dotenv(dotenv_path=_backend_env_path(), override=True)
    key = os.getenv("OPENWEATHER_API_KEY", "").strip()
    if not key:
        return jsonify({"message": "Weather is not configured (missing OPENWEATHER_API_KEY)."}), 503

    q = (request.args.get("q") or "").strip()
    if not q:
        return jsonify({"message": "Query parameter q is required."}), 400

    try:
        raw_q, place_only, geo_q, geo = _geocode_pipeline(q, key)
    except HTTPError as e:
        return jsonify({"message": f"Geocoding failed: {e.code}"}), 502
    except URLError as e:
        return jsonify({"message": f"Network error: {e.reason!s}"}), 502
    except Exception as exc:
        return jsonify({"message": str(exc)}), 502

    if not geo:
        return jsonify({
            "message": "No location found for this search.",
            "query": q,
            "place_extracted": place_only,
            "geocode_query": geo_q,
            "geocoding": [],
        }), 404

    first = geo[0]
    return jsonify({
        "query": q,
        "place_extracted": place_only,
        "geocode_query": geo_q,
        "lat": first.get("lat"),
        "lon": first.get("lon"),
        "name": first.get("name"),
        "state": first.get("state"),
        "country": first.get("country"),
        "geocoding": geo,
    }), 200
