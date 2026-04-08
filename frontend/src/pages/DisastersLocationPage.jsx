import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000'
const GEO_COUNTRY_QS = (import.meta.env.VITE_DEFAULT_GEO_COUNTRY || '').trim()
  ? `&country=${encodeURIComponent(import.meta.env.VITE_DEFAULT_GEO_COUNTRY.trim())}`
  : ''

export default function DisastersLocationPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { token, logout, user } = useAuth()
  const q = (searchParams.get('q') || '').trim()
  const assetLabel = (searchParams.get('asset') || '').trim()
  const latParam = (searchParams.get('lat') || '').trim()
  const lngParam = (searchParams.get('lng') || '').trim()
  const hasCoords = latParam !== '' && lngParam !== ''

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [payload, setPayload] = useState(null)

  useEffect(() => {
    if (!hasCoords && !q) {
      setError('No location provided. Go back and open Disasters from a location row.')
      return
    }
    if (!token) return
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError('')
      setPayload(null)
      try {
        let url = `${BASE_URL}/api/disasters/latest-by-location?limit=20&page=1`
        if (hasCoords) {
          url += `&lat=${encodeURIComponent(latParam)}&lng=${encodeURIComponent(lngParam)}`
        } else {
          url += `&q=${encodeURIComponent(q)}${GEO_COUNTRY_QS}`
        }
        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.message || 'Disasters request failed.')
        if (!cancelled) setPayload(data)
      } catch (e) {
        if (!cancelled) setError(e.message || 'Failed to load disaster data.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [q, latParam, lngParam, hasCoords, token])

  function handleLogout() {
    logout()
    navigate('/login', { replace: true })
  }

  const geo = payload?.geocode
  const ambee = payload?.ambee
  const rows = Array.isArray(ambee?.result) ? ambee.result : []

  return (
    <div className="dashboard">
      <header className="dash-header">
        <div className="dash-brand">
          <span className="badge">SGS</span>
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
            <h2 className="dash-welcome-title">Natural disasters (Ambee)</h2>
            <p className="dash-welcome-sub">
              {assetLabel ? (
                <>
                  Asset type: <strong>{assetLabel}</strong>
                  {' · '}
                </>
              ) : null}
              {q ? (
                <>
                  Location: <strong>{q}</strong>
                </>
              ) : null}
              {hasCoords && (
                <>
                  {q ? ' · ' : null}
                  Coordinates:{' '}
                  <strong>
                    {Number(latParam).toFixed(5)}, {Number(lngParam).toFixed(5)}
                  </strong>
                </>
              )}
            </p>
          </div>
          <button type="button" className="btn-ed btn-ed-outline" onClick={() => navigate(-1)}>
            ← Back
          </button>
        </div>

        {error && <div className="form-alert">{error}</div>}
        {loading && (
          <p className="dash-welcome-sub">Loading geocode and Ambee disaster data…</p>
        )}

        {payload && !loading && (
          <>
            <section className="profile-card weather-section">
              <h3 className="profile-card-title">Geocoding (used for Ambee)</h3>
              {geo ? (
                <div className="weather-kv">
                  {geo.source === 'openweather' && (
                    <>
                      <div>
                        <span className="weather-k">Place</span>{' '}
                        {[geo.name, geo.state, geo.country].filter(Boolean).join(', ') || '—'}
                      </div>
                      <div>
                        <span className="weather-k">Query</span> {geo.geocode_query || '—'}
                      </div>
                    </>
                  )}
                  {geo.source === 'coordinates' && (
                    <div>
                      <span className="weather-k">Source</span> Coordinates from Geocode (no new geocode)
                    </div>
                  )}
                  <div>
                    <span className="weather-k">Lat / Lng</span>{' '}
                    {geo.lat != null && geo.lng != null
                      ? `${Number(geo.lat).toFixed(5)}, ${Number(geo.lng).toFixed(5)}`
                      : '—'}
                  </div>
                </div>
              ) : (
                <p className="dash-welcome-sub">No geocode metadata.</p>
              )}
            </section>

            <section className="profile-card weather-section">
              <h3 className="profile-card-title">Ambee — latest near this point</h3>
              {ambee?.message && (
                <p className="dash-welcome-sub disasters-api-meta">
                  API: <strong>{ambee.message}</strong>
                  {ambee.limit != null && ` · Limit ${ambee.limit}`}
                  {ambee.page != null && ` · Page ${ambee.page}`}
                  {ambee.hasNextPage ? ' · More pages available' : ''}
                </p>
              )}
              {rows.length ? (
                <div className="fa-table-wrap disasters-table-wrap">
                  <table className="fa-table disasters-events-table">
                    <thead>
                      <tr>
                        <th>Event</th>
                        <th>Type</th>
                        <th>Severity</th>
                        <th>Alert</th>
                        <th>Date</th>
                        <th className="fa-num">Lat</th>
                        <th className="fa-num">Lng</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((ev) => (
                        <tr key={ev.event_id || ev.source_event_id}>
                          <td className="disasters-col-event">{ev.event_name || '—'}</td>
                          <td>{ev.event_type || '—'}</td>
                          <td>
                            <span className="disasters-severity">{ev.proximity_severity_level || '—'}</span>
                          </td>
                          <td>{ev.default_alert_levels || '—'}</td>
                          <td className="disasters-col-date">{ev.date || ev.created_time || '—'}</td>
                          <td className="fa-num">{ev.lat != null ? Number(ev.lat).toFixed(4) : '—'}</td>
                          <td className="fa-num">{ev.lng != null ? Number(ev.lng).toFixed(4) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="dash-welcome-sub">No disaster records in this response.</p>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  )
}
