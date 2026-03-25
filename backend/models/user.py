from datetime import datetime, timezone


def build_user(email: str, username: str, password_hash: str) -> dict:
    now = datetime.now(timezone.utc)
    return {
        "email": email.lower().strip(),
        "username": username.strip(),
        "password": password_hash,
        "created_at": now,
        "updated_at": now,
    }


def public_user(user: dict) -> dict:
    """Return a user document safe to send in API responses (no password)."""
    return {
        "id": str(user["_id"]),
        "email": user["email"],
        "username": user["username"],
        "created_at": user["created_at"].isoformat(),
    }
