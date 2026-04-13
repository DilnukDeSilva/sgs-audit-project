# Backend (Flask)

## Setup

1. Create and activate a virtual environment.
2. Install dependencies: `pip install -r requirements.txt`
3. Configure `backend/.env` (see root `README.md` for variables).
4. Run the API: `python app.py`

The server listens on `http://localhost:5000` by default (`PORT` in `.env`).

## Endpoints (summary)

- `GET /` — service info  
- `GET /api/health` — health check  

Full API list, environment variables, and feature overview: **see the repository root `README.md`**.
