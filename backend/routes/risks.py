from datetime import datetime, timezone

from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required

from config.db import get_db

risks_bp = Blueprint("risks", __name__, url_prefix="/api/risks")


def _seed_rows():
    # Seeded from "My Risk PDF - Sheet1.pdf"
    return [
        {
            "risk": "Risk 1",
            "category": "Acute",
            "description": "High winds, cyclones, and storms can disrupt transportation and reduce shopper footfall, causing downtime in shopping and delivery operations.",
            "impact": "Reduced revenue, increased costs, reduced asset value",
            "rcp_2_6": "Y",
            "rcp_8_5": "Y",
            "komar_impact": "Indirect, slower market",
            "when_to_apply": "Buildings, leasehold improvements, vehicles, machinery, current stocks, office fixtures, transportation of raw materials and finished goods",
        },
        {
            "risk": "Risk 2",
            "category": "Acute",
            "description": "Heavy precipitation and flooding can damage infrastructure, warehousing, shop fronts, transportation, and goods in transit, while increasing delays, write-offs, and insurance costs.",
            "impact": "Reduced revenue, increased costs, reduced asset value, new costs",
            "rcp_2_6": "Y",
            "rcp_8_5": "Y",
            "komar_impact": "Indirect, additional costs and damaged goods",
            "when_to_apply": "Buildings, leasehold improvements, vehicles, machinery, current stocks, office fixtures, transportation of raw materials and finished goods",
        },
        {
            "risk": "Risk 3",
            "category": "Chronic",
            "description": "Heatwaves and wildfires can reduce footfall, force closure of retail operations, and increase structural and fire risks. Rising temperatures also raise cooling and transport energy demand.",
            "impact": "Increased costs, reduced asset value",
            "rcp_2_6": "Y",
            "rcp_8_5": "",
            "komar_impact": "Limited in USA now, expected to increase by 2035",
            "when_to_apply": "Buildings, leasehold improvements, vehicles, machinery, current stocks, office fixtures, transportation of raw materials and finished goods",
        },
        {
            "risk": "Risk 4",
            "category": "Chronic / Market",
            "description": "Rising sea levels can disrupt shipping and port operations and reduce demand in coastal regions due to relocation and tourism loss.",
            "impact": "Reduced revenue",
            "rcp_2_6": "Y",
            "rcp_8_5": "Y",
            "komar_impact": "Direct, regional market impact",
            "when_to_apply": "Supply chain, manufacturing locations, warehousing, upstream/downstream transportation, sea transport",
        },
        {
            "risk": "Risk 5",
            "category": "Market / Reputation",
            "description": "Negative public sentiment on sustainability and climate issues can reduce demand while increasing preference for reuse, recycle, upcycle, and durable fashion.",
            "impact": "Reduced revenues",
            "rcp_2_6": "Y",
            "rcp_8_5": "",
            "komar_impact": "Indirect impact to market demand",
            "when_to_apply": "Brand image, warehousing charges due to low stock turnover",
        },
        {
            "risk": "Risk 6",
            "category": "Policy",
            "description": "Carbon pricing exposure may increase direct or indirect costs from 2028 onward due to non-renewable energy use in 2025-2028 operations.",
            "impact": "Increased costs",
            "rcp_2_6": "Y",
            "rcp_8_5": "Y",
            "komar_impact": "Direct impact of carbon pricing",
            "when_to_apply": "Legal costs, assets, warehousing, transportation, machinery, vehicle fleet",
        },
        {
            "risk": "Risk 7",
            "category": "Technology",
            "description": "Capital investment may be required to improve manufacturing energy efficiency.",
            "impact": "Increased costs (capital expenditure)",
            "rcp_2_6": "Y",
            "rcp_8_5": "",
            "komar_impact": "Direct impact on energy costs",
            "when_to_apply": "Machinery, buildings, vehicle fleet",
        },
        {
            "risk": "Risk 8",
            "category": "Technology",
            "description": "R&D investment may be needed for alternative materials, design, and production techniques to reduce emission intensity.",
            "impact": "Increased costs (R&D)",
            "rcp_2_6": "Y",
            "rcp_8_5": "Y",
            "komar_impact": "Direct, innovation impact",
            "when_to_apply": "Brand image, cashflow, product viability, innovation and product development costs",
        },
        {
            "risk": "Risk 9",
            "category": "Technology",
            "description": "Asset values may decline for outdated machinery and transportation vehicles with poor energy efficiency.",
            "impact": "Reduced asset value",
            "rcp_2_6": "Y",
            "rcp_8_5": "Y",
            "komar_impact": "Property and transport asset valuation and procurement impacts",
            "when_to_apply": "Buildings, leasehold improvements, vehicles, machinery, current stocks, office fixtures, transportation of raw materials and finished goods",
        },
    ]


@risks_bp.get("/table")
@jwt_required()
def get_risk_table():
    user_id = get_jwt_identity()
    db = get_db()
    doc = db["risks"].find_one({"user_id": user_id})
    if not doc:
        rows = _seed_rows()
        now = datetime.now(timezone.utc)
        db["risks"].insert_one({
            "user_id": user_id,
            "rows": rows,
            "created_at": now,
            "updated_at": now,
        })
        return jsonify({"rows": rows}), 200
    return jsonify({"rows": doc.get("rows", [])}), 200


@risks_bp.put("/table")
@jwt_required()
def save_risk_table():
    user_id = get_jwt_identity()
    payload = request.get_json(silent=True) or {}
    rows = payload.get("rows")
    if not isinstance(rows, list):
        return jsonify({"message": "rows must be an array"}), 400

    cleaned = []
    allowed_keys = {
        "risk",
        "category",
        "description",
        "impact",
        "rcp_2_6",
        "rcp_8_5",
        "komar_impact",
        "when_to_apply",
    }
    for row in rows:
        if not isinstance(row, dict):
            continue
        cleaned.append({k: str(row.get(k, "")) for k in allowed_keys})

    db = get_db()
    now = datetime.now(timezone.utc)
    db["risks"].find_one_and_update(
        {"user_id": user_id},
        {
            "$set": {"rows": cleaned, "updated_at": now},
            "$setOnInsert": {"created_at": now},
        },
        upsert=True,
    )
    return jsonify({"message": "Risk table saved.", "rows": cleaned}), 200
