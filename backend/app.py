import os
from datetime import timedelta
from pathlib import Path

from dotenv import load_dotenv
from flask import Flask, jsonify
from flask_cors import CORS
from flask_jwt_extended import JWTManager

# Load backend/.env regardless of current working directory (e.g. project root vs backend/).
_env_path = Path(__file__).resolve().parent / ".env"
load_dotenv(dotenv_path=_env_path, override=True)


def create_app():
    app = Flask(__name__)

    # ------------------------------------------------------------------
    # Configuration
    # ------------------------------------------------------------------
    app.config["JWT_SECRET_KEY"] = os.getenv("JWT_SECRET_KEY", "change-me-in-production")
    app.config["JWT_ACCESS_TOKEN_EXPIRES"] = timedelta(
        minutes=int(os.getenv("JWT_ACCESS_EXPIRES_MINUTES", "15"))
    )
    app.config["JWT_REFRESH_TOKEN_EXPIRES"] = timedelta(
        days=int(os.getenv("JWT_REFRESH_EXPIRES_DAYS", "30"))
    )

    # ------------------------------------------------------------------
    # Extensions
    # ------------------------------------------------------------------
    frontend_url = os.getenv("FRONTEND_URL", "http://localhost:5173")
    CORS(app, resources={r"/api/*": {"origins": frontend_url}})

    JWTManager(app)

    # ------------------------------------------------------------------
    # Database
    # ------------------------------------------------------------------
    from config.db import connect_db
    connect_db(app)

    # ------------------------------------------------------------------
    # Blueprints
    # ------------------------------------------------------------------
    from routes.auth import auth_bp
    from routes.templates import templates_bp
    from routes.data import data_bp
    from routes.ai import ai_bp
    from routes.risks import risks_bp
    from routes.weather import weather_bp
    from routes.disasters import disasters_bp
    app.register_blueprint(auth_bp)
    app.register_blueprint(templates_bp)
    app.register_blueprint(data_bp)
    app.register_blueprint(ai_bp)
    app.register_blueprint(risks_bp)
    app.register_blueprint(weather_bp)
    app.register_blueprint(disasters_bp)

    # ------------------------------------------------------------------
    # Core routes
    # ------------------------------------------------------------------
    @app.get("/api/health")
    def health_check():
        return jsonify({"status": "ok", "message": "Flask backend is running"}), 200

    @app.get("/")
    def home():
        return jsonify({"service": "backend", "framework": "Flask"}), 200

    return app


app = create_app()

if __name__ == "__main__":
    port = int(os.getenv("PORT", "5000"))
    debug = os.getenv("DEBUG", "true").lower() == "true"
    app.run(host="0.0.0.0", port=port, debug=debug)
