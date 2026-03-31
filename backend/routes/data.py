import io
import os
import re
from collections import defaultdict
from typing import Optional

import pandas as pd
from bson import ObjectId
from flask import Blueprint, request, jsonify, send_file
from flask_jwt_extended import jwt_required, get_jwt_identity
from pymongo import ReturnDocument
from pymongo.errors import OperationFailure

from config.db import get_db
from models.upload import build_upload, public_upload

data_bp = Blueprint("data", __name__, url_prefix="/api/data")

ALLOWED_EXTENSIONS = {".xlsx", ".xls", ".csv"}
MAX_FILE_SIZE_MB = 10


def _allowed(filename: str) -> bool:
    return os.path.splitext(filename.lower())[1] in ALLOWED_EXTENSIONS


def _excel_to_text_and_sheets(file_bytes: bytes, filename: str):
    """
    Read every sheet from an Excel/CSV file.
    Returns:
        extracted_text  – clean plain-text representation of all sheets
        sheets          – list of dicts with name, headers, rows, row_count
    """
    ext = os.path.splitext(filename.lower())[1]
    text_parts = []
    sheets_data = []

    if ext == ".csv":
        df = pd.read_csv(io.BytesIO(file_bytes), dtype=str).fillna("")
        sheet_block, sheet_dict = _process_sheet("Sheet1", df)
        text_parts.append(sheet_block)
        sheets_data.append(sheet_dict)
    else:
        xl = pd.ExcelFile(io.BytesIO(file_bytes), engine="openpyxl")
        for sheet_name in xl.sheet_names:
            df = xl.parse(sheet_name, dtype=str).fillna("")
            # Drop completely empty rows and columns
            df = df.dropna(how="all").loc[:, (df != "").any()]
            if df.empty:
                continue
            sheet_block, sheet_dict = _process_sheet(sheet_name, df)
            text_parts.append(sheet_block)
            sheets_data.append(sheet_dict)

    extracted_text = "\n\n".join(text_parts)
    return extracted_text, sheets_data


def _process_sheet(name: str, df: pd.DataFrame):
    headers = [str(c) for c in df.columns.tolist()]
    rows = df.values.tolist()
    rows = [[str(cell) for cell in row] for row in rows]

    # Build plain text block
    lines = [f"=== {name} ==="]
    lines.append(" | ".join(headers))
    lines.append("-" * max(len(" | ".join(headers)), 40))
    for row in rows:
        lines.append(" | ".join(row))

    sheet_dict = {
        "name": name,
        "headers": headers,
        "rows": rows,
        "row_count": len(rows),
    }
    return "\n".join(lines), sheet_dict


# ---------------------------------------------------------------------------
# POST /api/data/upload
# ---------------------------------------------------------------------------
@data_bp.post("/upload")
@jwt_required()
def upload_file():
    user_id = get_jwt_identity()

    if "file" not in request.files:
        return jsonify({"message": "No file provided."}), 400

    file = request.files["file"]

    if not file.filename:
        return jsonify({"message": "No file selected."}), 400

    if not _allowed(file.filename):
        return jsonify({"message": "Only .xlsx, .xls, and .csv files are allowed."}), 422

    file_bytes = file.read()
    if len(file_bytes) > MAX_FILE_SIZE_MB * 1024 * 1024:
        return jsonify({"message": f"File exceeds {MAX_FILE_SIZE_MB} MB limit."}), 413

    try:
        extracted_text, sheets = _excel_to_text_and_sheets(file_bytes, file.filename)
    except Exception as exc:
        return jsonify({"message": f"Could not read file: {str(exc)}"}), 422

    if not sheets:
        return jsonify({"message": "The file appears to be empty."}), 422

    doc = build_upload(user_id, file.filename, sheets, extracted_text)
    result = get_db()["uploads"].insert_one(doc)
    doc["_id"] = result.inserted_id

    return jsonify({
        "message": "File uploaded and processed successfully.",
        "upload": public_upload(doc, full=True),
    }), 201


# ---------------------------------------------------------------------------
# GET /api/data/uploads  –  list current user's uploads
# ---------------------------------------------------------------------------
@data_bp.get("/uploads")
@jwt_required()
def list_uploads():
    user_id = get_jwt_identity()
    try:
        docs = list(
            get_db()["uploads"]
            .find({"user_id": user_id}, {"extracted_text": 0, "sheets.rows": 0})
            .sort("uploaded_at", -1)
            .allow_disk_use(True)
            .limit(20)
        )
    except OperationFailure as exc:
        # Fallback for environments where find+sort disk use is not honored.
        if getattr(exc, "code", None) == 292:
            docs = list(
                get_db()["uploads"]
                .find({"user_id": user_id}, {"extracted_text": 0, "sheets.rows": 0})
                .sort("_id", -1)
                .limit(20)
            )
        else:
            return jsonify({"message": f"Failed to list uploads: {str(exc)}"}), 500
    except Exception as exc:
        return jsonify({"message": f"Failed to list uploads: {str(exc)}"}), 500
    return jsonify({"uploads": [public_upload(d) for d in docs]}), 200


# ---------------------------------------------------------------------------
# GET /api/data/uploads/<upload_id>/text  –  download extracted .txt file
# ---------------------------------------------------------------------------
@data_bp.get("/uploads/<upload_id>/text")
@jwt_required()
def download_text(upload_id):
    user_id = get_jwt_identity()
    try:
        doc = get_db()["uploads"].find_one({
            "_id": ObjectId(upload_id),
            "user_id": user_id,
        })
    except Exception:
        return jsonify({"message": "Invalid upload ID."}), 400

    if not doc:
        return jsonify({"message": "Upload not found."}), 404

    txt_bytes = doc["extracted_text"].encode("utf-8")
    buffer = io.BytesIO(txt_bytes)
    base_name = os.path.splitext(doc["filename"])[0]

    return send_file(
        buffer,
        as_attachment=True,
        download_name=f"{base_name}_extracted.txt",
        mimetype="text/plain",
    )


# ---------------------------------------------------------------------------
# DELETE /api/data/uploads/<upload_id>  –  delete one upload + related analyses
# ---------------------------------------------------------------------------
@data_bp.delete("/uploads/<upload_id>")
@jwt_required()
def delete_upload(upload_id):
    user_id = get_jwt_identity()
    try:
        oid = ObjectId(upload_id)
    except Exception:
        return jsonify({"message": "Invalid upload ID."}), 400

    upload_result = get_db()["uploads"].delete_one({
        "_id": oid,
        "user_id": user_id,
    })
    if upload_result.deleted_count == 0:
        return jsonify({"message": "Upload not found."}), 404

    analyses_result = get_db()["analyses"].delete_many({
        "user_id": user_id,
        "upload_id": upload_id,
    })

    return jsonify({
        "message": "Session deleted successfully.",
        "deleted_uploads": upload_result.deleted_count,
        "deleted_analyses": analyses_result.deleted_count,
    }), 200


# ---------------------------------------------------------------------------
# Helpers for Fixed Assets analysis
# ---------------------------------------------------------------------------

def _parse_numeric(val: str) -> float:
    """
    Parse asset values including accounting notation.
    Handles: '( 12,575.20)' → 12575.20  |  '12,575.20' → 12575.20
    Parentheses in fixed-asset registers denote the cost figure formatting,
    so we always return the absolute value.
    """
    val = str(val).strip()
    cleaned = re.sub(r"[^\d.]", "", val)
    try:
        return abs(float(cleaned))
    except (ValueError, TypeError):
        return 0.0


def _find_col(headers: list, keywords: list) -> Optional[int]:
    """Return the index of the first header that contains any keyword (case-insensitive)."""
    for i, h in enumerate(headers):
        h_lower = h.lower()
        if any(kw in h_lower for kw in keywords):
            return i
    return None


def _find_col_best(headers: list, keywords: list) -> Optional[int]:
    """
    Like _find_col, but when several headers match (e.g. 'Location' vs
    'Location of Asset'), prefer the most specific label — longer headers
    usually carry the full field name from the template.
    """
    matches: list[tuple[int, str]] = []
    for i, h in enumerate(headers):
        h_lower = h.lower()
        if any(kw in h_lower for kw in keywords):
            matches.append((i, h))
    if not matches:
        return None
    if len(matches) == 1:
        return matches[0][0]
    matches.sort(key=lambda x: len(x[1].strip()), reverse=True)
    return matches[0][0]


def _resolve_headers_and_rows(sheet: dict):
    """
    Handle two Excel layouts:
      1. Filled file  – pandas read real column names directly.
                        headers = ['Type of Fixed Asset', 'Value of Asset', ...]
                        rows    = [actual data rows ...]
      2. Template     – merged/blank top row causes pandas to use 'Unnamed: X'.
                        headers = ['Unnamed: 1', 'Unnamed: 2', ...]
                        rows[0] = ['Type of Asset', 'Value of Asset', ...]
                        rows[1+]= actual data rows
    Returns (col_headers, data_rows).
    """
    raw_headers = sheet["headers"]
    rows = sheet["rows"]

    unnamed_count = sum(1 for h in raw_headers if "unnamed" in h.lower())
    mostly_unnamed = unnamed_count >= len(raw_headers) / 2

    if mostly_unnamed and rows:
        # First data row holds the real column names
        return [c.strip() for c in rows[0]], rows[1:]
    else:
        return [h.strip() for h in raw_headers], rows


# ---------------------------------------------------------------------------
# GET /api/data/uploads/<upload_id>/analyse/fixed-assets
# ---------------------------------------------------------------------------
@data_bp.get("/uploads/<upload_id>/analyse/fixed-assets")
@jwt_required()
def analyse_fixed_assets(upload_id):
    user_id = get_jwt_identity()

    try:
        doc = get_db()["uploads"].find_one({
            "_id": ObjectId(upload_id),
            "user_id": user_id,
        })
    except Exception:
        return jsonify({"message": "Invalid upload ID."}), 400

    if not doc:
        return jsonify({"message": "Upload not found."}), 404

    # Find the Fixed Assets sheet
    fa_sheet = next(
        (s for s in doc["sheets"] if "asset" in s["name"].lower()),
        None,
    )
    if not fa_sheet:
        return jsonify({"message": "No Fixed Assets sheet found in this upload."}), 404

    if not fa_sheet["rows"]:
        return jsonify({"message": "Fixed Assets sheet is empty.", "table": [], "summary": {}}), 200

    real_headers, data_rows = _resolve_headers_and_rows(fa_sheet)

    # Locate columns by keyword
    type_col    = _find_col(real_headers, ["type"])
    value_col   = _find_col(real_headers, ["value"])
    ops_col     = _find_col(real_headers, ["operational", "operation", "purpose", "use"])
    loc_col     = _find_col_best(real_headers, ["location"])
    method_col  = _find_col(real_headers, ["valuation", "method"])

    groups: dict = defaultdict(lambda: {
        "total_value": 0.0,
        "operational_uses": set(),
        "locations": set(),
        "valuation_methods": set(),
        "row_count": 0,
    })

    grand_total = 0.0

    for row in data_rows:
        # Skip blank rows
        if all(c.strip() == "" for c in row):
            continue

        def cell(idx):
            return row[idx].strip() if idx is not None and idx < len(row) else ""

        asset_type = cell(type_col) or "Uncategorised"
        value      = _parse_numeric(cell(value_col))
        ops        = cell(ops_col)
        location   = cell(loc_col)
        method     = cell(method_col)

        g = groups[asset_type]
        g["total_value"] += value
        g["row_count"]   += 1
        grand_total      += value
        if ops:      g["operational_uses"].add(ops)
        if location: g["locations"].add(location)
        if method:   g["valuation_methods"].add(method)

    table = [
        {
            "type": asset_type,
            "total_value": round(data["total_value"], 2),
            "operational_uses":  sorted(data["operational_uses"]),
            "locations":         sorted(data["locations"]),
            "valuation_methods": sorted(data["valuation_methods"]),
            "row_count":         data["row_count"],
        }
        for asset_type, data in groups.items()
    ]

    # Sort by total value descending
    table.sort(key=lambda r: r["total_value"], reverse=True)

    summary = {
        "total_rows":    sum(r["row_count"] for r in table),
        "total_value":   round(grand_total, 2),
        "unique_types":  len(table),
        "sheet_name":    fa_sheet["name"],
        "columns_found": {
            "type":             real_headers[type_col]   if type_col   is not None else None,
            "value":            real_headers[value_col]  if value_col  is not None else None,
            "operational_use":  real_headers[ops_col]    if ops_col    is not None else None,
            "location":         real_headers[loc_col]    if loc_col    is not None else None,
            "valuation_method": real_headers[method_col] if method_col is not None else None,
        },
    }

    # ── Persist the analysis result to MongoDB ──────────────────────────────
    from datetime import datetime, timezone
    analysis_doc = {
        "user_id":    user_id,
        "upload_id":  upload_id,
        "filename":   doc["filename"],
        "type":       "fixed_assets",
        "table":      table,
        "summary":    summary,
        "analysed_at": datetime.now(timezone.utc),
    }

    # Upsert: replace any existing analysis for this upload so we don't
    # accumulate duplicates when the user re-runs analysis on the same file.
    analysis = get_db()["analyses"].find_one_and_update(
        {"upload_id": upload_id, "type": "fixed_assets"},
        {"$set": analysis_doc},
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )

    return jsonify({
        "analysis_id": str(analysis["_id"]),
        "table": table,
        "summary": summary,
    }), 200


# ---------------------------------------------------------------------------
# GET /api/data/analyses  –  list all saved analyses for the current user
# ---------------------------------------------------------------------------
@data_bp.get("/analyses")
@jwt_required()
def list_analyses():
    user_id = get_jwt_identity()
    try:
        docs = list(
            get_db()["analyses"]
            .find({"user_id": user_id}, {"table": 0})
            .sort("analysed_at", -1)
            .allow_disk_use(True)
            .limit(50)
        )
    except OperationFailure as exc:
        # Fallback to indexed order if uploaded_at/analysed_at sort exceeds memory.
        if getattr(exc, "code", None) == 292:
            docs = list(
                get_db()["analyses"]
                .find({"user_id": user_id}, {"table": 0})
                .sort("_id", -1)
                .limit(50)
            )
        else:
            return jsonify({"message": f"Failed to list analyses: {str(exc)}"}), 500
    except Exception as exc:
        return jsonify({"message": f"Failed to list analyses: {str(exc)}"}), 500
    results = [
        {
            "id":          str(d["_id"]),
            "upload_id":   d["upload_id"],
            "filename":    d["filename"],
            "type":        d["type"],
            "summary":     d["summary"],
            "analysed_at": d["analysed_at"].isoformat(),
        }
        for d in docs
    ]
    return jsonify({"analyses": results}), 200


# ---------------------------------------------------------------------------
# GET /api/data/analyses/<analysis_id>  –  retrieve one full saved analysis
# ---------------------------------------------------------------------------
@data_bp.get("/analyses/<analysis_id>")
@jwt_required()
def get_analysis(analysis_id):
    user_id = get_jwt_identity()
    try:
        doc = get_db()["analyses"].find_one({
            "_id": ObjectId(analysis_id),
            "user_id": user_id,
        })
    except Exception:
        return jsonify({"message": "Invalid analysis ID."}), 400

    if not doc:
        return jsonify({"message": "Analysis not found."}), 404

    return jsonify({
        "id":          str(doc["_id"]),
        "upload_id":   doc["upload_id"],
        "filename":    doc["filename"],
        "type":        doc["type"],
        "table":       doc["table"],
        "summary":     doc["summary"],
        "analysed_at": doc["analysed_at"].isoformat(),
    }), 200
