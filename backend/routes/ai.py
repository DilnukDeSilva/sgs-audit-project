import os
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

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
