import os

from dotenv import load_dotenv
from flask import Flask, jsonify
from flask_cors import CORS

load_dotenv()

app = Flask(__name__)

frontend_url = os.getenv("FRONTEND_URL", "http://localhost:5173")
CORS(app, resources={r"/api/*": {"origins": frontend_url}})


@app.get("/api/health")
def health_check():
    return jsonify({"status": "ok", "message": "Flask backend is running"}), 200


@app.get("/")
def home():
    return jsonify({"service": "backend", "framework": "Flask"}), 200


if __name__ == "__main__":
    port = int(os.getenv("PORT", "5000"))
    debug = os.getenv("DEBUG", "true").lower() == "true"
    app.run(host="0.0.0.0", port=port, debug=debug)
