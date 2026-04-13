import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000'

export default function WeatherLocationPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { token, logout, user } = useAuth()
  const q = (searchParams.get('q') || '').trim()
  const assetLabel = (searchParams.get('asset') || '').trim()

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [payload, setPayload] = useState(null)

  useEffect(() => {
    if (!q) {
      setError('No location provided. Go back and open weather from a location row.')
      return
    }
    if (!token) return
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError('')
      setPayload(null)
      try {
        const res = await fetch(
          `${BASE_URL}/api/weather/lookup?q=${encodeURIComponent(q)}&units=metric`,
          { headers: { Authorization: `Bearer ${token}` } }
        )
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.message || 'Weather request failed.')
        if (!cancelled) setPayload(data)
      } catch (e) {
        if (!cancelled) setError(e.message || 'Failed to load weather.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [q, token])

  function handleLogout() {
    logout()
    navigate('/login', { replace: true })
  }

  const geo = payload?.geocoding?.[0]
  const cur = payload?.current
  const fc = payload?.forecast

  return (
    <div className="dashboard">
      <header className="dash-header">
        <div className="dash-brand">
          <span className="badge">IM-PACT-A</span>
          <span className="dash-brand-name">Audit Platform</span>
        </div>
        <div className="dash-user">
          <span className="dash-username">{user?.username}</span>
          <button type="button" className="btn-logout" onClick={handleLogout}>
            Sign out
          </button>
        </div>
      </header>

      <main className="dash-main">
        <div className="dash-welcome-row">
          <div>
            <h2 className="dash-welcome-title">Location weather</h2>
            <p className="dash-welcome-sub">
              {assetLabel ? (
                <>
                  Asset type: <strong>{assetLabel}</strong>
                  {' · '}
                </>
              ) : null}
              Location: <strong>{q || '—'}</strong>
            </p>
          </div>
          <button type="button" className="btn-ed btn-ed-outline" onClick={() => navigate(-1)}>
            ← Back
          </button>
        </div>

        {error && <div className="form-alert">{error}</div>}
        {loading && <p className="dash-welcome-sub">Loading geocoding, current weather, and forecast…</p>}

        {payload && !loading && (
          <>
            <section className="profile-card weather-section">
              <h3 className="profile-card-title">Geocoding (OpenWeather)</h3>
              {(payload.place_extracted || payload.geocode_query) && (
                <p className="dash-welcome-sub weather-geocode-note">
                  {payload.place_extracted && (
                    <>
                      Place sent to API: <strong>{payload.place_extracted}</strong>
                      {payload.geocode_query ? ' · ' : ''}
                    </>
                  )}
                  {payload.geocode_query && (
                    <>
                      Query: <strong>{payload.geocode_query}</strong>
                    </>
                  )}
                </p>
              )}
              {geo ? (
                <div className="weather-kv">
                  <div><span className="weather-k">Name</span> {geo.name}{geo.state ? `, ${geo.state}` : ''}{geo.country ? ` · ${geo.country}` : ''}</div>
                  <div><span className="weather-k">Lat / Lon</span> {geo.lat?.toFixed(4)}, {geo.lon?.toFixed(4)}</div>
                </div>
              ) : (
                <p className="dash-welcome-sub">No geocoding row.</p>
              )}
              {payload.geocoding?.length > 1 && (
                <details className="weather-details">
                  <summary>Other matches ({payload.geocoding.length})</summary>
                  <ul className="weather-alt-list">
                    {payload.geocoding.map((g, i) => (
                      <li key={i}>
                        {g.name}{g.state ? `, ${g.state}` : ''} {g.country} — {g.lat?.toFixed(4)}, {g.lon?.toFixed(4)}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </section>

            <section className="profile-card weather-section">
              <h3 className="profile-card-title">Current weather</h3>
              {cur ? (
                <div className="weather-current-grid">
                  <div className="weather-big">
                    {cur.main?.temp != null && (
                      <span className="weather-temp">{Math.round(cur.main.temp)}°C</span>
                    )}
                    <span className="weather-desc">
                      {cur.weather?.[0]?.description ? cur.weather[0].description : '—'}
                    </span>
                  </div>
                  <div className="weather-kv">
                    <div><span className="weather-k">Feels like</span> {cur.main?.feels_like != null ? `${Math.round(cur.main.feels_like)}°C` : '—'}</div>
                    <div><span className="weather-k">Humidity</span> {cur.main?.humidity != null ? `${cur.main.humidity}%` : '—'}</div>
                    <div><span className="weather-k">Wind</span> {cur.wind?.speed != null ? `${cur.wind.speed} m/s` : '—'}</div>
                    <div><span className="weather-k">Pressure</span> {cur.main?.pressure != null ? `${cur.main.pressure} hPa` : '—'}</div>
                    <div><span className="weather-k">Clouds</span> {cur.clouds?.all != null ? `${cur.clouds.all}%` : '—'}</div>
                  </div>
                </div>
              ) : (
                <p className="dash-welcome-sub">No current data.</p>
              )}
            </section>

            <section className="profile-card weather-section">
              <h3 className="profile-card-title">Forecast (5-day / 3-hour)</h3>
              {fc?.list?.length ? (
                <div className="fa-table-wrap">
                  <table className="fa-table weather-fc-table">
                    <thead>
                      <tr>
                        <th>Time (UTC)</th>
                        <th className="fa-num">Temp °C</th>
                        <th>Conditions</th>
                        <th className="fa-num">Rain 3h</th>
                        <th className="fa-num">Wind m/s</th>
                      </tr>
                    </thead>
                    <tbody>
                      {fc.list.map((item) => (
                        <tr key={`${item.dt}-${item.dt_txt}`}>
                          <td>{item.dt_txt || '—'}</td>
                          <td className="fa-num">{item.main?.temp != null ? Math.round(item.main.temp) : '—'}</td>
                          <td>{item.weather?.[0]?.description || '—'}</td>
                          <td className="fa-num">
                            {item.rain?.['3h'] != null
                              ? Number(item.rain['3h']).toFixed(1)
                              : item.snow?.['3h'] != null
                                ? `snow ${Number(item.snow['3h']).toFixed(1)}`
                                : '—'}
                          </td>
                          <td className="fa-num">{item.wind?.speed != null ? item.wind.speed : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="dash-welcome-sub">No forecast data.</p>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  )
}
