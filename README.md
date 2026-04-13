# sgs-audit-project

Full-stack audit workflow application:

- **Frontend:** React + Vite (`frontend/`)
- **Backend:** Flask + MongoDB (`backend/`)

## Key features

- User authentication (register, login, refresh token, protected routes)
- **Dashboard:** session history (open/delete), **Risk Table** shortcut next to **Start new**
- Upload Excel/CSV files and extract sheet data
- **Fixed assets** analysis table grouped by asset type
- **Locations:** geocode (OpenWeather), Ambee **Disasters** / **History**, weather links; geocode cached in `sessionStorage` for the session
- **Location “Done”** tracking per site line, persisted in MongoDB per fixed-assets analysis
- **Risk Table** CRUD page (editable grid, save to DB)
- **Ambee natural disasters:** latest-by-location and history-by-location (requires `AMBEE_API_KEY`)
- **Ambee History — impact estimate:** per-event button calls **Groq** to estimate impacted working days vs a yearly working-day baseline (default 260)
- Per-asset **AI summaries** (Groq, triggered row-by-row)
- Enter Data view state persisted when navigating (session storage); some keys cleared on back to dashboard / sign-out per app rules

## Project structure (high level)

| Area | Path |
|------|------|
| Dashboard, sessions | `frontend/src/pages/DashboardPage.jsx` |
| Enter Data, fixed assets table, Done, geocode cache | `frontend/src/pages/EnterDataPage.jsx` |
| Risk table UI | `frontend/src/pages/RiskTablePage.jsx` |
| Ambee latest disasters | `frontend/src/pages/DisastersLocationPage.jsx` |
| Ambee history + Groq estimate buttons | `frontend/src/pages/DisastersHistoryPage.jsx` |
| Weather | `frontend/src/pages/WeatherLocationPage.jsx` |
| Ambee event type labels | `frontend/src/utils/ambeeEventTypes.js` |
| Global theme (light palette) | `frontend/src/index.css` |
| App styles | `frontend/src/App.css` |
| Auth context (session cleanup on logout) | `frontend/src/context/AuthContext.jsx` |
| Data / uploads / analyses / location Done API | `backend/routes/data.py` |
| AI (Groq: fixed asset categorise, disaster impact days) | `backend/routes/ai.py` |
| Ambee proxy routes | `backend/routes/disasters.py` |
| Weather / geocode | `backend/routes/weather.py` |
| App entry, blueprints | `backend/app.py` |

## Environment

### Frontend

- Default dev URL: `http://localhost:5173`
- Create `frontend/.env` (or export):

```env
VITE_API_BASE_URL=http://localhost:5000
# Optional: default country hint for geocode (matches backend OPENWEATHER_GEO_COUNTRY)
# VITE_DEFAULT_GEO_COUNTRY=LK
```

### Backend

- Default API URL: `http://localhost:5000`
- Copy `backend/.env` from a secure template; **do not commit real secrets.**

| Variable | Purpose |
|----------|---------|
| `FRONTEND_URL` | CORS origin for `/api/*` |
| `MONGODB_URI` | MongoDB connection string |
| `DB_NAME` | Database name |
| `JWT_SECRET_KEY` | JWT signing |
| `JWT_ACCESS_EXPIRES_MINUTES` | Access token lifetime |
| `JWT_REFRESH_EXPIRES_DAYS` | Refresh token lifetime |
| `GROQ_API_KEY` | Groq API (AI categorisation, disaster impact estimates) |
| `OPENWEATHER_API_KEY` | Geocoding + weather |
| `OPENWEATHER_GEO_COUNTRY` | Optional ISO country hint for geocoding |
| `AMBEE_API_KEY` | Ambee Natural Disasters API (`x-api-key`) |

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
- `GET /api/data/analyses/<analysis_id>` — includes `location_done` when present
- `GET /api/data/analyses/<analysis_id>/location-done`
- `PUT /api/data/analyses/<analysis_id>/location-done` — body: `{ "location_done": { "<typeKey>-<index>": true, ... } }`
- `DELETE /api/data/uploads/<upload_id>` (deletes upload and related analyses)

### AI (Groq)

- `GET /api/ai/analyses/<analysis_id>/categorise`
- `POST /api/ai/analyses/<analysis_id>/categorise-type`
- `POST /api/ai/disasters/estimate-impact-days` — body: `{ "event": { ... }, "working_days_year": 260 }`  
  Returns estimated `impacted_days`, ratio vs working days, and a short `reason`.

### Disasters (Ambee)

- `GET /api/disasters/latest-by-location` — query params: `q`, optional `lat`/`lng`, pagination
- `GET /api/disasters/history-by-location` — required `from` / `to` (UTC `YYYY-MM-DD HH:mm:ss`), optional `q` or `lat`/`lng`

### Weather

- See `backend/routes/weather.py` for geocode and forecast routes used by the weather page.

### Risks

- `GET /api/risks/table`
- `PUT /api/risks/table`

## Run locally

### 1) Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python3 app.py
```

### 2) Frontend

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

- **Dashboard or API calls fail with 401**

  - Ensure the backend is running and the access token is still valid (refresh or log in again).

- **Groq or Ambee errors**

  - Confirm `GROQ_API_KEY` and `AMBEE_API_KEY` are set in `backend/.env` and the process was restarted after changes.

## Frontend README

See `frontend/README.md` for Vite/React template notes.

## Backend README

See `backend/README.md` for a minimal backend run summary.
