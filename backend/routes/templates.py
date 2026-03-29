import io
import os
import zipfile

from flask import Blueprint, send_file, jsonify
from flask_jwt_extended import jwt_required

templates_bp = Blueprint("templates", __name__, url_prefix="/api/templates")

TEMPLATES_DIR = os.path.join(os.path.dirname(__file__), "..", "static", "templates")


@templates_bp.get("/download")
@jwt_required()
def download_template():
    """
    If the templates folder contains exactly one file, serve it directly.
    If it contains multiple files, zip them all and serve the zip.
    If it is empty, return a 404 with a helpful message.
    """
    if not os.path.isdir(TEMPLATES_DIR):
        return jsonify({"message": "Templates directory not found."}), 404

    files = [
        f for f in os.listdir(TEMPLATES_DIR)
        if os.path.isfile(os.path.join(TEMPLATES_DIR, f))
        and not f.startswith(".")
    ]

    if not files:
        return jsonify({"message": "No template files available yet."}), 404

    if len(files) == 1:
        file_path = os.path.join(TEMPLATES_DIR, files[0])
        return send_file(
            file_path,
            as_attachment=True,
            download_name=files[0],
        )

    # Multiple files → bundle into a zip in memory
    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for filename in files:
            zf.write(os.path.join(TEMPLATES_DIR, filename), arcname=filename)
    zip_buffer.seek(0)

    return send_file(
        zip_buffer,
        as_attachment=True,
        download_name="audit_templates.zip",
        mimetype="application/zip",
    )
