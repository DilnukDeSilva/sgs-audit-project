import bcrypt
from email_validator import validate_email, EmailNotValidError
from flask import Blueprint, request, jsonify
from flask_jwt_extended import create_access_token, create_refresh_token, jwt_required, get_jwt_identity
from pymongo.errors import DuplicateKeyError

from config.db import get_db
from models.user import build_user, public_user

auth_bp = Blueprint("auth", __name__, url_prefix="/api/auth")


# ---------------------------------------------------------------------------
# POST /api/auth/register
# ---------------------------------------------------------------------------
@auth_bp.post("/register")
def register():
    data = request.get_json(silent=True) or {}

    email = data.get("email", "").strip()
    username = data.get("username", "").strip()
    password = data.get("password", "")

    errors = {}

    # --- validate email ---
    try:
        valid = validate_email(email, check_deliverability=False)
        email = valid.normalized
    except EmailNotValidError as exc:
        errors["email"] = str(exc)

    # --- validate username ---
    if not username:
        errors["username"] = "Username is required."
    elif len(username) < 3 or len(username) > 30:
        errors["username"] = "Username must be between 3 and 30 characters."

    # --- validate password ---
    if not password:
        errors["password"] = "Password is required."
    elif len(password) < 8:
        errors["password"] = "Password must be at least 8 characters."

    if errors:
        return jsonify({"message": "Validation failed.", "errors": errors}), 422

    password_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()

    user_doc = build_user(email, username, password_hash)

    try:
        result = get_db()["users"].insert_one(user_doc)
    except DuplicateKeyError as exc:
        field = "email" if "email" in str(exc) else "username"
        return jsonify({"message": f"An account with that {field} already exists."}), 409

    user_doc["_id"] = result.inserted_id

    access_token = create_access_token(identity=str(result.inserted_id))
    refresh_token = create_refresh_token(identity=str(result.inserted_id))

    return jsonify({
        "message": "Account created successfully.",
        "user": public_user(user_doc),
        "access_token": access_token,
        "refresh_token": refresh_token,
    }), 201


# ---------------------------------------------------------------------------
# POST /api/auth/login
# ---------------------------------------------------------------------------
@auth_bp.post("/login")
def login():
    data = request.get_json(silent=True) or {}

    identifier = data.get("email", "").strip()
    password = data.get("password", "")

    if not identifier or not password:
        return jsonify({"message": "Email and password are required."}), 400

    db = get_db()
    user = db["users"].find_one({"email": identifier.lower()})

    if not user or not bcrypt.checkpw(password.encode(), user["password"].encode()):
        return jsonify({"message": "Invalid email or password."}), 401

    access_token = create_access_token(identity=str(user["_id"]))
    refresh_token = create_refresh_token(identity=str(user["_id"]))

    return jsonify({
        "message": "Login successful.",
        "user": public_user(user),
        "access_token": access_token,
        "refresh_token": refresh_token,
    }), 200


# ---------------------------------------------------------------------------
# POST /api/auth/refresh  –  get a new access token from a refresh token
# ---------------------------------------------------------------------------
@auth_bp.post("/refresh")
@jwt_required(refresh=True)
def refresh():
    identity = get_jwt_identity()
    access_token = create_access_token(identity=identity)
    return jsonify({"access_token": access_token}), 200


# ---------------------------------------------------------------------------
# GET /api/auth/me  –  return current user (protected)
# ---------------------------------------------------------------------------
@auth_bp.get("/me")
@jwt_required()
def me():
    user_id = get_jwt_identity()
    from bson import ObjectId

    user = get_db()["users"].find_one({"_id": ObjectId(user_id)})
    if not user:
        return jsonify({"message": "User not found."}), 404

    return jsonify({"user": public_user(user)}), 200
