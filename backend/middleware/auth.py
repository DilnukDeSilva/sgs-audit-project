from functools import wraps
from flask import jsonify
from flask_jwt_extended import verify_jwt_in_request, get_jwt_identity
from bson import ObjectId

from config.db import get_db


def jwt_required_with_user(fn):
    """
    Decorator that verifies the JWT and attaches the full user document
    to the request context as ``request.current_user``.

    Usage::

        from middleware.auth import jwt_required_with_user
        from flask import request

        @some_bp.get("/protected")
        @jwt_required_with_user
        def protected():
            user = request.current_user
            ...
    """
    @wraps(fn)
    def wrapper(*args, **kwargs):
        from flask import request as flask_request

        verify_jwt_in_request()
        user_id = get_jwt_identity()

        user = get_db()["users"].find_one({"_id": ObjectId(user_id)})
        if not user:
            return jsonify({"message": "User not found."}), 404

        flask_request.current_user = user
        return fn(*args, **kwargs)

    return wrapper
