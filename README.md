# sgs-audit-project

Small full-stack project with:
- Frontend: React + Vite
- Backend: Python Flask

## How it works

### Frontend
The frontend lives in `frontend/` and runs on `http://localhost:5173`.

- Main UI entry: `frontend/src/App.jsx`
- The app reads `VITE_API_BASE_URL` from `frontend/.env`
- It calls the backend health endpoint: `GET /api/health`

### Backend
The backend lives in `backend/` and runs on `http://localhost:5000`.

- App entry: `backend/app.py`
- Uses Flask + CORS + dotenv
- Exposes:
  - `GET /` (basic service info)
  - `GET /api/health` (health check)

## Run locally

### 1) Start backend
```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

### 2) Start frontend
```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`.
