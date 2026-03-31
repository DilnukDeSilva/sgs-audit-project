from datetime import datetime, timezone


def build_upload(user_id: str, filename: str, sheets: list, extracted_text: str) -> dict:
    now = datetime.now(timezone.utc)
    return {
        "user_id": user_id,
        "filename": filename,
        "sheets": sheets,           # list of { name, headers, rows, row_count }
        "extracted_text": extracted_text,
        "uploaded_at": now,
        "status": "processed",
    }


def public_upload(doc: dict, full: bool = False) -> dict:
    """
    full=True  → include rows/extracted_text (used right after upload).
    full=False → lightweight listing (no heavy fields).
    """
    sheets = doc.get("sheets") or []
    if full:
        sheet_data = sheets
    else:
        sheet_data = [
            {"name": s.get("name", ""), "row_count": s.get("row_count", 0)}
            for s in sheets
        ]
    out = {
        "id": str(doc["_id"]),
        "filename": doc["filename"],
        "sheet_count": len(sheets),
        "sheets": sheet_data,
        "uploaded_at": doc["uploaded_at"].isoformat(),
        "status": doc.get("status", "processed"),
    }
    if full and doc.get("extracted_text") is not None:
        out["extracted_text"] = doc["extracted_text"]
    return out
