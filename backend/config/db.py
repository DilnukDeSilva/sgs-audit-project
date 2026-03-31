import os
from pymongo import MongoClient
from pymongo.errors import ConnectionFailure

_client = None
_db = None


def connect_db(app):
    global _client, _db

    mongo_uri = os.getenv("MONGODB_URI", "mongodb://localhost:27017")
    db_name = os.getenv("DB_NAME", "sgs_audit")

    _client = MongoClient(mongo_uri)
    _client.admin.command("ping")

    _db = _client[db_name]

    _db["users"].create_index("email", unique=True)
    _db["users"].create_index("username", unique=True)
    _db["risks"].create_index("user_id", unique=True)

    app.logger.info(f"Connected to MongoDB database: {db_name}")
    return _db


def get_db():
    if _db is None:
        raise RuntimeError("Database not initialised. Call connect_db(app) first.")
    return _db
