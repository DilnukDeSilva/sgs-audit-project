# sgs-audit-project

Full-stack audit workflow application:
- Frontend: React + Vite (`frontend/`)
- Backend: Flask + MongoDB (`backend/`)

## Key features

- User authentication (register, login, refresh token, protected routes)
- Upload Excel/CSV files and extract sheet data
- Fixed assets analysis table grouped by asset type
- Per-asset AI summaries (triggered row-by-row)
- Dashboard session history (view/open previous sessions)
- Session deletion from Dashboard (removes upload + related analysis in DB)
- Enter Data page state persistence between Dashboard <-> Enter Data navigation

## Project structure

- `frontend/src/pages/DashboardPage.jsx`: session listing, open/delete actions
- `frontend/src/pages/EnterDataPage.jsx`: upload, analysis, per-type AI summary, persisted view state
- `backend/routes/data.py`: upload, list, analysis, download, delete session APIs
- `backend/routes/ai.py`: AI categorization endpoints
- `backend/routes/auth.py`: auth endpoints
- `backend/app.py`: Flask app setup, CORS, JWT, blueprint registration

## Environment

### Frontend
- Runs on `http://localhost:5173`
- Reads backend URL from `frontend/.env`:

```env
VITE_API_BASE_URL=http://localhost:5000
```

### Backend
- Runs on `http://localhost:5000`
- Uses Flask, JWT auth, and MongoDB
- Default access-token expiry is 15 minutes (`JWT_ACCESS_EXPIRES_MINUTES`)

## Main API endpoints

### Health
- `GET /`
- `GET /api/health`

### Auth
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/refresh`
- `GET /api/auth/me`

### Data + sessions
- `POST /api/data/upload`
- `GET /api/data/uploads`
- `GET /api/data/uploads/<upload_id>/text`
- `GET /api/data/uploads/<upload_id>/analyse/fixed-assets`
- `GET /api/data/analyses`
- `GET /api/data/analyses/<analysis_id>`
- `DELETE /api/data/uploads/<upload_id>` (deletes upload and related analyses)

### AI
- `GET /api/ai/analyses/<analysis_id>/categorise`
- `POST /api/ai/analyses/<analysis_id>/categorise-type`

## Run locally

### 1) Start backend
```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python3 app.py
```

### 2) Start frontend
```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`.

## Troubleshooting

- **Port 5000 already in use**
  ```bash
  lsof -nP -iTCP:5000 -sTCP:LISTEN
  kill <PID>
  ```

- **Dashboard sessions fail to load**
  - Ensure backend is running on `http://localhost:5000`
  - Ensure valid JWT access token is present (expired tokens return 401)
