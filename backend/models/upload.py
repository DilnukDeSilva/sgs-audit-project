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


def public_upload(doc: dict) -> dict:
    return {
        "id": str(doc["_id"]),
        "filename": doc["filename"],
        "sheets": doc["sheets"],
        "extracted_text": doc["extracted_text"],
        "uploaded_at": doc["uploaded_at"].isoformat(),
        "status": doc["status"],
    }
