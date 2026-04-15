import os
import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from bson import ObjectId
from dotenv import load_dotenv
from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required, get_jwt_identity
from groq import Groq

from config.db import get_db

ai_bp = Blueprint("ai", __name__, url_prefix="/api/ai")

DIRECT_KEYWORDS = [
    "factory", "production", "manufactur", "machine", "machinery", "equipment",
    "cutting", "sewing", "washing", "boiler", "compress", "industrial",
    "raw material", "wip", "warehouse", "plant", "assembly", "processing",
    "dye", "finishing", "exhaust", "ventilation", "electrical",
]

INDIRECT_KEYWORDS = [
    "office", "hr", "finance", "meeting", "corporate", "admin", "administration",
    "logo", "signage", "landscape", "entrance", "washroom", "canteen", "cafeteria",
    "security", "guard", "blinds", "carpet", "decor", "consult", "architect",
    "software", "laptop", "macbook", "printer", "firewall", "server", "network",
]


def _get_groq_client():
    # Ensure the backend .env is loaded even if process cwd differs.
    env_path = Path(__file__).resolve().parents[1] / ".env"
    load_dotenv(dotenv_path=env_path, override=True)

    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        raise ValueError("GROQ_API_KEY is not set in environment variables.")
    return Groq(api_key=api_key)


def _build_prompt_operational_only(
    asset_type: str,
    compact_uses: list,
    total_unique_uses: int,
    pre_counts: dict,
    direct_examples: list,
    indirect_examples: list,
) -> str:
    """
    Prompt built only from operational usage lines.
    Asks the model to group into themes (not echo raw codes)
    and produce an estimated count breakdown.
    """
    uses_text = "\n".join(f"- {u}" for u in compact_uses) if compact_uses else "- (none provided)"
    total_rows = total_unique_uses
    direct_est  = pre_counts.get("direct", 0)
    indirect_est = pre_counts.get("indirect", 0)
    unclear_est  = pre_counts.get("unclear", 0)

    return f"""You are an expert sustainability and operations analyst reviewing fixed asset operational usage data for a manufacturing company.

Asset type: "{asset_type}"
Total unique usage descriptions in register: {total_rows}
Pre-classification baseline — direct: {direct_est}, indirect: {indirect_est}, unclear: {unclear_est}

Below are the operational usage descriptions for this asset type only:
{uses_text}

---

IMPORTANT INSTRUCTIONS:
1. Read ALL the descriptions above carefully.
2. Mentally group them into meaningful THEMES (e.g. "Factory floor repairs", "Office partitions", "Electrical & piping systems") — do NOT copy-paste raw database codes or reference numbers.
3. Produce a clean, business-readable analysis using the exact format below.
4. Do NOT invent totals, percentages, or count ranges — exact figures are appended automatically after your reply.

Respond in EXACTLY this format (no deviations):

✅ Included (Direct Manufacturing Impact)

Assets that support production, factory operations, or industrial processes, such as:
- [theme 1 — descriptive, 3-6 words]
- [theme 2]
- [theme 3]
- [theme 4]
- [theme 5]
- [theme 6]
- [theme 7]

---

❌ Excluded (Non-Manufacturing / Indirect)

Assets related to:
- [theme 1 — descriptive, 3-6 words]
- [theme 2]
- [theme 3]
- [theme 4]
- [theme 5]
- [theme 6]
- [theme 7]

---

📊 Practical Result

Key insight: [2-3 sentences summarising what this asset type's usage reveals about the organisation's manufacturing vs support footprint — qualitative only, no numbers]"""


def _format_exact_counts_footer(row_count: int, n_ops_lines: int, pre_counts: dict) -> str:
    """
    Deterministic counts. Unclear entries are distributed proportionally
    between direct and indirect so the user sees a clean two-way split.
    """
    d   = int(pre_counts.get("direct",   0))
    ind = int(pre_counts.get("indirect", 0))
    unc = int(pre_counts.get("unclear",  0))

    # Proportional redistribution of unclear entries
    known = d + ind
    if known > 0:
        d_final   = round(d   + unc * (d   / known))
        ind_final = round(ind + unc * (ind / known))
    else:
        # No signal at all — split unclear 50/50
        half = unc // 2
        d_final   = d   + half
        ind_final = ind + (unc - half)

    total = n_ops_lines  # total classified descriptions

    return (
        "\n\n---\n\n"
        "🔢 Estimated Counts\n\n"
        f"Total items (approx.): ~{total}\n"
        f"Direct manufacturing-related items: ~{d_final}\n"
        f"Non-manufacturing / indirect assets: ~{ind_final}\n"
    )


def _compact_operational_uses(unique_uses: list, all_uses: list) -> list:
    """
    Reduce prompt size to avoid Groq free-tier TPM/token limit errors.
    Keeps most frequent items with counts and bounds final payload length.
    """
    # Frequency over all raw rows (not unique) gives model weighting signal.
    freq = Counter([u.strip() for u in all_uses if u and u.strip()])

    # Keep most common entries first; include count in each line.
    ranked = [f"{text} [count={count}]" for text, count in freq.most_common(140)]

    # Hard cap by characters to stay well under request token limits.
    max_chars = 9000
    output = []
    running = 0
    for item in ranked:
        add_len = len(item) + 1
        if running + add_len > max_chars:
            break
        output.append(item)
        running += add_len

    # Fallback: at least a small sample if everything was too long.
    if not output:
        output = unique_uses[:40]
    return output


def _keyword_preclassify(all_uses: list, total_count: int):
    """
    Lightweight deterministic pre-classification so AI can produce clearer
    business-style summaries instead of echoing raw asset lines.
    """
    direct = 0
    indirect = 0
    unclear = 0
    direct_examples = []
    indirect_examples = []

    for text in all_uses:
        raw = (text or "").strip()
        if not raw:
            continue
        lower = raw.lower()
        is_direct = any(k in lower for k in DIRECT_KEYWORDS)
        is_indirect = any(k in lower for k in INDIRECT_KEYWORDS)

        if is_direct and not is_indirect:
            direct += 1
            if len(direct_examples) < 20:
                direct_examples.append(raw)
        elif is_indirect and not is_direct:
            indirect += 1
            if len(indirect_examples) < 20:
                indirect_examples.append(raw)
        else:
            unclear += 1

    # If classifier can't confidently detect enough direct rows, assume part of
    # unclear pool belongs to direct operations in manufacturing datasets.
    if total_count > 0 and direct < max(5, int(total_count * 0.08)):
        shift = int(unclear * 0.25)
        direct += shift
        unclear -= shift

    return {
        "direct": direct,
        "indirect": indirect,
        "unclear": unclear,
    }, direct_examples, indirect_examples


def _resolve_analysis_doc(analysis_id: str, user_id: str):
    """Return (doc, canonical_analysis_id_str) or (None, None)."""
    doc = None
    try:
        doc = get_db()["analyses"].find_one({
            "_id": ObjectId(analysis_id),
            "user_id": user_id,
        })
    except Exception:
        pass
    if not doc:
        doc = get_db()["analyses"].find_one({
            "upload_id": analysis_id,
            "user_id": user_id,
            "type": "fixed_assets",
        })
    if not doc:
        return None, None
    return doc, str(doc["_id"])


def _build_disaster_impact_prompt(event: dict, working_days_year: int) -> str:
    """
    Ask Groq to estimate disrupted working days for a single disaster event.
    The model must return compact JSON only.
    """
    compact_event = {
        "event_id": event.get("event_id"),
        "source_event_id": event.get("source_event_id"),
        "event_name": event.get("event_name"),
        "event_type": event.get("event_type"),
        "proximity_severity_level": event.get("proximity_severity_level"),
        "default_alert_levels": event.get("default_alert_levels"),
        "date": event.get("date"),
        "estimated_end_date": event.get("estimated_end_date"),
        "lat": event.get("lat"),
        "lng": event.get("lng"),
    }
    return (
        "Estimate business disruption from this Ambee disaster event.\n\n"
        f"Event JSON:\n{json.dumps(compact_event, ensure_ascii=True)}\n\n"
        f"Working days in year: {working_days_year}\n\n"
        "Rules:\n"
        "1) Use event_type + proximity_severity_level as primary drivers.\n"
        "2) Use event duration (date -> estimated_end_date) if available.\n"
        "3) Output integer impacted_days in [0, working_days_year].\n"
        "4) If uncertain, be conservative.\n"
        "5) Respond JSON ONLY with this exact schema:\n"
        "{\n"
        '  "impacted_days": <integer>,\n'
        '  "reason": "<max 180 chars>"\n'
        "}"
    )


def _parse_loose_datetime(val: Any):
    """Parse mixed datetime formats from upstream APIs."""
    if not val:
        return None
    text = str(val).strip()
    if not text:
        return None
    # Common variants: "YYYY-MM-DD HH:MM:SS", ISO with Z, ISO with offset.
    candidates = [
        text,
        text.replace(" ", "T"),
        text.replace("Z", "+00:00"),
        text.replace(" ", "T").replace("Z", "+00:00"),
    ]
    for c in candidates:
        try:
            dt = datetime.fromisoformat(c)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.astimezone(timezone.utc)
        except Exception:
            continue
    return None


def _severity_weight(level: str) -> float:
    v = (level or "").strip().lower()
    if "very high" in v or "extreme" in v:
        return 1.0
    if "high" in v:
        return 0.8
    if "moderate" in v or "medium" in v:
        return 0.55
    if "low" in v:
        return 0.28
    return 0.4


def _alert_weight(level: str) -> float:
    v = (level or "").strip().lower()
    if "red" in v:
        return 0.95
    if "orange" in v:
        return 0.7
    if "yellow" in v:
        return 0.45
    if "green" in v:
        return 0.2
    return 0.35


def _event_type_weight(event_type: str) -> float:
    et = (event_type or "").strip().upper()
    weights = {
        "WF": 0.75,        # Wildfire
        "TC": 0.9,         # Tropical cyclone
        "FL": 0.78,        # Flood
        "EQ": 0.92,        # Earthquake
        "TS": 0.82,        # Tsunami
        "VO": 0.85,        # Volcano
        "DR": 0.55,        # Drought
        "ST": 0.68,        # Storm/severe weather
        "MISC": 0.35,
    }
    return float(weights.get(et, 0.45))


def _derive_window_risk_baseline(events: list[dict]):
    """
    Deterministic baseline probability from event frequency, severity,
    event types, and recency.
    """
    now = datetime.now(timezone.utc)
    if not events:
        return {
            "risk_probability_pct": 3,
            "confidence_pct": 35,
            "metrics": {
                "event_count": 0,
                "aggregate_signal": 0.0,
                "frequency_signal": 0.0,
            },
        }

    weighted_sum = 0.0
    for ev in events:
        sev_w = _severity_weight(ev.get("proximity_severity_level"))
        alert_w = _alert_weight(ev.get("default_alert_levels"))
        type_w = _event_type_weight(ev.get("event_type"))

        raw_signal = (0.45 * sev_w) + (0.2 * alert_w) + (0.35 * type_w)

        ev_time = _parse_loose_datetime(ev.get("date") or ev.get("created_time"))
        if ev_time is None:
            recency = 0.65
        else:
            age_days = max(0.0, (now - ev_time).total_seconds() / 86400.0)
            if age_days <= 7:
                recency = 1.0
            elif age_days <= 30:
                recency = 0.82
            elif age_days <= 90:
                recency = 0.65
            elif age_days <= 180:
                recency = 0.5
            else:
                recency = 0.35

        weighted_sum += raw_signal * recency

    aggregate_signal = weighted_sum / float(len(events))
    # Saturate around 30 events so bursts don't push to 100 too quickly.
    frequency_signal = min(1.0, len(events) / 30.0)

    baseline = ((aggregate_signal * 0.62) + (frequency_signal * 0.38)) * 100.0
    baseline_pct = int(round(max(0.0, min(100.0, baseline))))
    confidence_pct = int(round(min(90.0, 38.0 + (len(events) * 1.8))))

    return {
        "risk_probability_pct": baseline_pct,
        "confidence_pct": confidence_pct,
        "metrics": {
            "event_count": len(events),
            "aggregate_signal": round(aggregate_signal, 4),
            "frequency_signal": round(frequency_signal, 4),
        },
    }


def _build_disaster_probability_prompt(
    geocode: dict,
    from_utc: str,
    to_utc: str,
    events: list[dict],
    baseline_pct: int,
):
    # Keep payload compact for faster/cheaper inference.
    compact_events = []
    for ev in events[:60]:
        compact_events.append({
            "event_type": ev.get("event_type"),
            "severity": ev.get("proximity_severity_level"),
            "alert": ev.get("default_alert_levels"),
            "date": ev.get("date") or ev.get("created_time"),
            "event_name": ev.get("event_name"),
        })

    context = {
        "location": {
            "name": geocode.get("name"),
            "state": geocode.get("state"),
            "country": geocode.get("country"),
            "lat": geocode.get("lat"),
            "lng": geocode.get("lng"),
        },
        "window_utc": {"from": from_utc, "to": to_utc},
        "event_count": len(events),
        "baseline_probability_pct": baseline_pct,
        "events_sample": compact_events,
    }
    return (
        "Estimate the probability (%) of a meaningful disaster-related operational risk "
        "for this location in the near term, using event history context below.\n\n"
        f"Context JSON:\n{json.dumps(context, ensure_ascii=True)}\n\n"
        "Rules:\n"
        "1) Return JSON only.\n"
        "2) risk_probability_pct must be integer 0..100.\n"
        "3) confidence_pct must be integer 0..100.\n"
        "4) risk_level must be one of: Low, Medium, High, Very High.\n"
        "5) top_drivers: 2-4 short strings.\n"
        "6) rationale: max 220 chars.\n\n"
        "Output schema:\n"
        "{\n"
        '  "risk_probability_pct": <integer>,\n'
        '  "confidence_pct": <integer>,\n'
        '  "risk_level": "<Low|Medium|High|Very High>",\n'
        '  "top_drivers": ["...", "..."],\n'
        '  "rationale": "..."\n'
        "}"
    )


def _risk_level_from_pct(pct: int) -> str:
    if pct >= 75:
        return "Very High"
    if pct >= 55:
        return "High"
    if pct >= 30:
        return "Medium"
    return "Low"


# ---------------------------------------------------------------------------
# POST /api/ai/analyses/<analysis_id>/categorise-type
# Body: { "asset_type": "..." } — only operational usage for that type is sent to AI.
# ---------------------------------------------------------------------------
@ai_bp.post("/analyses/<analysis_id>/categorise-type")
@jwt_required()
def ai_categorise_one_type(analysis_id):
    user_id = get_jwt_identity()
    body = request.get_json(silent=True) or {}
    asset_type = (body.get("asset_type") or "").strip()
    if not asset_type:
        return jsonify({"message": "asset_type is required in JSON body."}), 400

    doc, resolved_id = _resolve_analysis_doc(analysis_id, user_id)
    if not doc:
        return jsonify({"message": "Analysis not found."}), 404

    table = doc.get("table", []) or []
    row = None
    for r in table:
        if str(r.get("type") or "").strip() == asset_type:
            row = r
            break
    if row is None:
        return jsonify({"message": "Asset type not found in this analysis."}), 404

    ops = row.get("operational_uses") or []
    all_uses = [u.strip() for u in ops if u and str(u).strip()]
    seen = set()
    unique_uses = []
    for u in all_uses:
        if u not in seen:
            seen.add(u)
            unique_uses.append(u)

    if not unique_uses:
        return jsonify({
            "message": "No operational usage text for this asset type.",
        }), 422

    row_count = int(row.get("row_count") or 0)
    compact_uses = _compact_operational_uses(unique_uses, all_uses)
    pre_counts, direct_examples, indirect_examples = _keyword_preclassify(
        all_uses, max(row_count, len(all_uses))
    )

    try:
        client = _get_groq_client()
    except ValueError as e:
        return jsonify({"message": str(e)}), 503

    try:
        chat = client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are an expert sustainability and operations analyst for a manufacturing company. "
                        "When categorising fixed asset operational usage: "
                        "ALWAYS group entries into descriptive themes (e.g. 'Factory floor repairs', 'Office partitions') — "
                        "NEVER echo raw database codes, reference numbers, or PO numbers. "
                        "Be concise, business-readable, and follow the exact response format given."
                    ),
                },
                {
                    "role": "user",
                    "content": _build_prompt_operational_only(
                        asset_type,
                        compact_uses,
                        len(unique_uses),
                        pre_counts,
                        direct_examples,
                        indirect_examples,
                    ),
                },
            ],
            temperature=0.3,
            max_tokens=900,
        )
        ai_text = chat.choices[0].message.content
    except Exception as e:
        return jsonify({"message": f"AI request failed: {str(e)}"}), 502

    n_ops_lines = len(all_uses)
    d_raw   = int(pre_counts["direct"])
    ind_raw = int(pre_counts["indirect"])
    unc_raw = int(pre_counts["unclear"])
    known   = d_raw + ind_raw
    if known > 0:
        d_dist   = round(d_raw   + unc_raw * (d_raw   / known))
        ind_dist = round(ind_raw + unc_raw * (ind_raw / known))
    else:
        half     = unc_raw // 2
        d_dist   = d_raw   + half
        ind_dist = ind_raw + (unc_raw - half)

    count_breakdown = {
        "register_rows": row_count,
        "total": n_ops_lines,
        "direct": d_dist,
        "indirect": ind_dist,
    }
    ai_text = ai_text + _format_exact_counts_footer(row_count, n_ops_lines, pre_counts)

    now = datetime.now(timezone.utc)
    model_name = "llama-3.1-8b-instant"
    summary_entry = {
        "type": asset_type,
        "ai_response": ai_text,
        "model": model_name,
        "unique_uses_sent": len(compact_uses),
        "total_unique_uses": len(unique_uses),
        "count_breakdown": count_breakdown,
        "created_at": now,
    }

    coll = get_db()["ai_results"]
    existing = coll.find_one({"analysis_id": resolved_id, "user_id": user_id})
    summaries = []
    if existing and existing.get("per_type_summaries"):
        summaries = [s for s in existing["per_type_summaries"] if s.get("type") != asset_type]
    summaries.append(summary_entry)

    coll.update_one(
        {"analysis_id": resolved_id},
        {
            "$set": {
                "user_id": user_id,
                "analysis_id": resolved_id,
                "filename": doc.get("filename"),
                "per_type_summaries": summaries,
                "updated_at": now,
            },
        },
        upsert=True,
    )

    return jsonify({
        "type": asset_type,
        "ai_response": ai_text,
        "unique_uses_sent": len(compact_uses),
        "total_unique_uses": len(unique_uses),
        "count_breakdown": count_breakdown,
        "model": model_name,
    }), 200


# ---------------------------------------------------------------------------
# GET /api/ai/analyses/<analysis_id>/categorise  –  fetch saved AI result
# ---------------------------------------------------------------------------
@ai_bp.get("/analyses/<analysis_id>/categorise")
@jwt_required()
def get_ai_result(analysis_id):
    user_id = get_jwt_identity()

    doc = get_db()["ai_results"].find_one({
        "analysis_id": analysis_id,
        "user_id":     user_id,
    })

    if not doc:
        return jsonify({"message": "No AI result saved for this analysis yet."}), 404

    out = {
        "model": doc.get("model"),
    }
    if "created_at" in doc and doc["created_at"]:
        out["created_at"] = doc["created_at"].isoformat()
    if "updated_at" in doc and doc.get("updated_at"):
        out["updated_at"] = doc["updated_at"].isoformat()
    if "ai_response" in doc:
        out["ai_response"] = doc["ai_response"]
    if "unique_uses_sent" in doc:
        out["unique_uses_sent"] = doc["unique_uses_sent"]
    if "total_entries" in doc:
        out["total_entries"] = doc["total_entries"]
    if "per_asset_type" in doc:
        out["per_asset_type"] = doc["per_asset_type"]
    if "asset_types_analysed" in doc:
        out["asset_types_analysed"] = doc["asset_types_analysed"]
    if "total_unique_uses" in doc:
        out["total_unique_uses"] = doc["total_unique_uses"]
    if "per_type_summaries" in doc:
        serialised = []
        for s in doc["per_type_summaries"]:
            entry = dict(s)
            ca = entry.get("created_at")
            if ca is not None and hasattr(ca, "isoformat"):
                entry["created_at"] = ca.isoformat()
            serialised.append(entry)
        out["per_type_summaries"] = serialised
    return jsonify(out), 200


# ---------------------------------------------------------------------------
# POST /api/ai/disasters/estimate-impact-days
# Body: { event: {...}, working_days_year?: 260 }
# ---------------------------------------------------------------------------
@ai_bp.post("/disasters/estimate-impact-days")
@jwt_required()
def estimate_disaster_impact_days():
    body = request.get_json(silent=True) or {}
    event = body.get("event")
    if not isinstance(event, dict):
        return jsonify({"message": "event (object) is required in JSON body."}), 400

    working_days_year_raw = body.get("working_days_year", 260)
    try:
        working_days_year = int(working_days_year_raw)
    except Exception:
        return jsonify({"message": "working_days_year must be an integer."}), 400
    if working_days_year < 1 or working_days_year > 366:
        return jsonify({"message": "working_days_year must be between 1 and 366."}), 400

    try:
        client = _get_groq_client()
    except ValueError as e:
        return jsonify({"message": str(e)}), 503

    prompt = _build_disaster_impact_prompt(event, working_days_year)
    model_name = "llama-3.1-8b-instant"
    try:
        chat = client.chat.completions.create(
            model=model_name,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You estimate operational disruption days from disaster events. "
                        "Return strict JSON only. No markdown, no prose."
                    ),
                },
                {"role": "user", "content": prompt},
            ],
            temperature=0.1,
            max_tokens=220,
        )
        raw = (chat.choices[0].message.content or "").strip()
    except Exception as e:
        return jsonify({"message": f"AI request failed: {str(e)}"}), 502

    start = raw.find("{")
    end = raw.rfind("}")
    if start == -1 or end == -1 or end <= start:
        return jsonify({"message": "AI response was not valid JSON.", "raw": raw}), 502

    try:
        parsed = json.loads(raw[start:end + 1])
    except Exception:
        return jsonify({"message": "AI response JSON parse failed.", "raw": raw}), 502

    try:
        impacted_days = int(round(float(parsed.get("impacted_days", 0))))
    except Exception:
        impacted_days = 0
    impacted_days = max(0, min(working_days_year, impacted_days))

    ratio = impacted_days / float(working_days_year)
    reason = str(parsed.get("reason") or "").strip()

    return jsonify({
        "model": model_name,
        "event": {
            "event_id": event.get("event_id"),
            "source_event_id": event.get("source_event_id"),
            "event_name": event.get("event_name"),
            "event_type": event.get("event_type"),
            "proximity_severity_level": event.get("proximity_severity_level"),
            "default_alert_levels": event.get("default_alert_levels"),
        },
        "estimate": {
            "impacted_days": impacted_days,
            "working_days_year": working_days_year,
            "impact_ratio": round(ratio, 4),
            "impact_ratio_percent": round(ratio * 100, 2),
            "reason": reason,
        },
    }), 200


# ---------------------------------------------------------------------------
# POST /api/ai/disasters/estimate-risk-probability
# Body: { events: [...], geocode?: {...}, from?: "...", to?: "..." }
# ---------------------------------------------------------------------------
@ai_bp.post("/disasters/estimate-risk-probability")
@jwt_required()
def estimate_disaster_risk_probability():
    body = request.get_json(silent=True) or {}
    events = body.get("events")
    if not isinstance(events, list):
        return jsonify({"message": "events (array) is required in JSON body."}), 400

    geocode = body.get("geocode") if isinstance(body.get("geocode"), dict) else {}
    from_utc = str(body.get("from") or "").strip()
    to_utc = str(body.get("to") or "").strip()

    # Keep only event-like dict rows.
    clean_events = [ev for ev in events if isinstance(ev, dict)]
    baseline = _derive_window_risk_baseline(clean_events)
    baseline_pct = int(baseline["risk_probability_pct"])
    baseline_conf = int(baseline["confidence_pct"])

    # If no events, deterministic baseline is enough.
    if not clean_events:
        return jsonify({
            "model": None,
            "method": "baseline_only",
            "location": {
                "name": geocode.get("name"),
                "state": geocode.get("state"),
                "country": geocode.get("country"),
                "lat": geocode.get("lat"),
                "lng": geocode.get("lng"),
            },
            "window_utc": {"from": from_utc or None, "to": to_utc or None},
            "estimate": {
                "risk_probability_pct": baseline_pct,
                "confidence_pct": baseline_conf,
                "risk_level": _risk_level_from_pct(baseline_pct),
                "top_drivers": ["No qualifying disaster history rows in selected window."],
                "rationale": "Probability is baseline-only due to missing events.",
                "event_count": 0,
            },
            "baseline": baseline,
        }), 200

    try:
        client = _get_groq_client()
    except ValueError as e:
        return jsonify({"message": str(e)}), 503

    model_name = "llama-3.1-8b-instant"
    ai_raw = ""
    ai_parsed = None
    try:
        prompt = _build_disaster_probability_prompt(
            geocode=geocode,
            from_utc=from_utc,
            to_utc=to_utc,
            events=clean_events,
            baseline_pct=baseline_pct,
        )
        chat = client.chat.completions.create(
            model=model_name,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a disaster risk analyst. "
                        "Return strict JSON only. No markdown."
                    ),
                },
                {"role": "user", "content": prompt},
            ],
            temperature=0.15,
            max_tokens=300,
        )
        ai_raw = (chat.choices[0].message.content or "").strip()
        start = ai_raw.find("{")
        end = ai_raw.rfind("}")
        if start != -1 and end != -1 and end > start:
            ai_parsed = json.loads(ai_raw[start:end + 1])
    except Exception:
        ai_parsed = None

    if isinstance(ai_parsed, dict):
        try:
            ai_pct = int(round(float(ai_parsed.get("risk_probability_pct", baseline_pct))))
        except Exception:
            ai_pct = baseline_pct
        ai_pct = max(0, min(100, ai_pct))

        try:
            ai_conf = int(round(float(ai_parsed.get("confidence_pct", baseline_conf))))
        except Exception:
            ai_conf = baseline_conf
        ai_conf = max(0, min(100, ai_conf))

        # Blend deterministic baseline and AI judgement for stability.
        final_pct = int(round((baseline_pct * 0.6) + (ai_pct * 0.4)))
        final_conf = int(round((baseline_conf * 0.55) + (ai_conf * 0.45)))
        risk_level = str(ai_parsed.get("risk_level") or "").strip() or _risk_level_from_pct(final_pct)
        if risk_level not in {"Low", "Medium", "High", "Very High"}:
            risk_level = _risk_level_from_pct(final_pct)

        drivers = ai_parsed.get("top_drivers")
        if not isinstance(drivers, list):
            drivers = []
        drivers = [str(x).strip() for x in drivers if str(x).strip()][:4]

        rationale = str(ai_parsed.get("rationale") or "").strip()[:220]
        if not rationale:
            rationale = "Combined baseline and AI judgement from event frequency, severity, and recency."
    else:
        final_pct = baseline_pct
        final_conf = baseline_conf
        risk_level = _risk_level_from_pct(final_pct)
        drivers = ["AI parse fallback: used deterministic baseline only."]
        rationale = "Model output was not usable JSON; baseline estimate returned."

    return jsonify({
        "model": model_name,
        "method": "baseline_plus_ai" if isinstance(ai_parsed, dict) else "baseline_only_fallback",
        "location": {
            "name": geocode.get("name"),
            "state": geocode.get("state"),
            "country": geocode.get("country"),
            "lat": geocode.get("lat"),
            "lng": geocode.get("lng"),
        },
        "window_utc": {"from": from_utc or None, "to": to_utc or None},
        "estimate": {
            "risk_probability_pct": final_pct,
            "confidence_pct": final_conf,
            "risk_level": risk_level,
            "top_drivers": drivers,
            "rationale": rationale,
            "event_count": len(clean_events),
        },
        "baseline": baseline,
    }), 200
