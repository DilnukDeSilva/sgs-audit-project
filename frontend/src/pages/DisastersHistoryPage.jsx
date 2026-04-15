import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { ambeeEventTypeLabel } from '../utils/ambeeEventTypes'

const BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000'
const GEO_COUNTRY_QS = (import.meta.env.VITE_DEFAULT_GEO_COUNTRY || '').trim()
  ? `&country=${encodeURIComponent(import.meta.env.VITE_DEFAULT_GEO_COUNTRY.trim())}`
  : ''

function pad2(n) {
  return String(n).padStart(2, '0')
}

/** Value for <input type="datetime-local" /> from a Date (browser local). */
function toDatetimeLocalValue(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

/**
 * Ambee history expects wall time in YYYY-MM-DD HH:mm:ss; the API compares `to` to UTC "now".
 * Send UTC to avoid local strings being interpreted as future vs server clock.
 */
function dateToAmbeeUtcString(d) {
  const x = new Date(d.getTime())
  return (
    `${x.getUTCFullYear()}-${pad2(x.getUTCMonth() + 1)}-${pad2(x.getUTCDate())} ` +
    `${pad2(x.getUTCHours())}:${pad2(x.getUTCMinutes())}:${pad2(x.getUTCSeconds())}`
  )
}

/** Parse datetime-local string to instant. */
function parseDatetimeLocal(s) {
  if (!s) return null
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d
}

function defaultDateRange() {
  const to = new Date()
  const from = new Date()
  from.setDate(from.getDate() - 90)
  return { from: toDatetimeLocalValue(from), to: toDatetimeLocalValue(to) }
}

/**
 * Clamp `to` to now; ensure `from` <= `to`. Returns UTC strings for Ambee + user-facing notes.
 */
function buildAmbeeUtcWindow(fromLocalStr, toLocalStr) {
  const notes = []
  let fromD = parseDatetimeLocal(fromLocalStr)
  let toD = parseDatetimeLocal(toLocalStr)
  const now = new Date()
  if (!fromD || !toD) {
    return { fromUtc: '', toUtc: '', notes }
  }
  if (toD > now) {
    toD = new Date(now.getTime())
    notes.push('End time was limited to the current moment (Ambee does not allow a future end time).')
  }
  if (fromD > toD) {
    fromD = new Date(toD.getTime())
    notes.push('Start time was adjusted so it is not after the end time.')
  }
  return {
    fromUtc: dateToAmbeeUtcString(fromD),
    toUtc: dateToAmbeeUtcString(toD),
    notes,
  }
}

export default function DisastersHistoryPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { token, logout, user } = useAuth()
  const q = (searchParams.get('q') || '').trim()
  const assetLabel = (searchParams.get('asset') || '').trim()
  const latParam = (searchParams.get('lat') || '').trim()
  const lngParam = (searchParams.get('lng') || '').trim()
  const hasCoords = latParam !== '' && lngParam !== ''

  const initialRange = useMemo(() => defaultDateRange(), [])
  const [fromLocal, setFromLocal] = useState(initialRange.from)
  const [toLocal, setToLocal] = useState(initialRange.to)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [payload, setPayload] = useState(null)
  const [windowNotes, setWindowNotes] = useState([])
  const [previewGeo, setPreviewGeo] = useState(null)
  const [estimatingKey, setEstimatingKey] = useState('')
  const [estimateByKey, setEstimateByKey] = useState({})
  const [estimateErrorByKey, setEstimateErrorByKey] = useState({})
  const [riskLoading, setRiskLoading] = useState(false)
  const [riskEstimate, setRiskEstimate] = useState(null)
  const [riskError, setRiskError] = useState('')

  const canRequest = (hasCoords || q) && token
  const maxDatetimeLocal = toDatetimeLocalValue(new Date())

  useEffect(() => {
    if (!token || !q || hasCoords) {
      if (hasCoords) setPreviewGeo(null)
      return
    }
    let cancelled = false
    setPreviewGeo('loading')
    ;(async () => {
      try {
        const res = await fetch(
          `${BASE_URL}/api/weather/geocode?q=${encodeURIComponent(q)}${GEO_COUNTRY_QS}`,
          { headers: { Authorization: `Bearer ${token}` } }
        )
        const data = await res.json().catch(() => ({}))
        if (cancelled) return
        if (!res.ok) {
          setPreviewGeo({ error: data.message || 'Geocode preview failed.' })
          return
        }
        setPreviewGeo({
          lat: data.lat,
          lng: data.lon ?? data.lng,
          name: data.name,
          state: data.state,
          country: data.country,
        })
      } catch {
        if (!cancelled) setPreviewGeo({ error: 'Geocode preview failed.' })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [token, q, hasCoords])

  const displayLat = hasCoords ? latParam : previewGeo?.lat
  const displayLng = hasCoords ? lngParam : previewGeo?.lng

  const loadHistory = useCallback(async () => {
    if (!token || (!hasCoords && !q)) {
      setError('No location or coordinates. Go back from a location row.')
      return
    }
    const { fromUtc, toUtc, notes } = buildAmbeeUtcWindow(fromLocal, toLocal)
    if (!fromUtc || !toUtc) {
      setError('Please set both From and To date & time.')
      return
    }
    setWindowNotes(notes)
    setLoading(true)
    setError('')
    setPayload(null)
    setEstimateByKey({})
    setEstimateErrorByKey({})
    setEstimatingKey('')
    setRiskEstimate(null)
    setRiskError('')
    setRiskLoading(false)
    try {
      let url = `${BASE_URL}/api/disasters/history-by-location?limit=20&page=1`
      url += `&from=${encodeURIComponent(fromUtc)}&to=${encodeURIComponent(toUtc)}`
      if (hasCoords) {
        url += `&lat=${encodeURIComponent(latParam)}&lng=${encodeURIComponent(lngParam)}`
      } else {
        url += `&q=${encodeURIComponent(q)}${GEO_COUNTRY_QS}`
      }
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.message || 'History request failed.')
      setPayload(data)
    } catch (e) {
      setError(e.message || 'Failed to load history.')
    } finally {
      setLoading(false)
    }
  }, [token, hasCoords, q, latParam, lngParam, fromLocal, toLocal])

  function handleLogout() {
    logout()
    navigate('/login', { replace: true })
  }

  function handleToChange(v) {
    if (v > maxDatetimeLocal) {
      setToLocal(maxDatetimeLocal)
      return
    }
    setToLocal(v)
  }

  const geo = payload?.geocode
  const ambee = payload?.ambee
  const rows = Array.isArray(ambee?.result) ? ambee.result : []

  function eventRowKey(ev) {
    return (
      ev.event_id ||
      ev.source_event_id ||
      `${ev.event_type || 'ev'}-${ev.date || ev.created_time || 'na'}-${ev.lat || 'x'}-${ev.lng || 'y'}`
    )
  }

  async function handleEstimateDays(ev) {
    const rowKey = eventRowKey(ev)
    setEstimatingKey(rowKey)
    setEstimateErrorByKey((prev) => ({ ...prev, [rowKey]: '' }))
    try {
      const res = await fetch(`${BASE_URL}/api/ai/disasters/estimate-impact-days`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ event: ev, working_days_year: 260 }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.message || 'Failed to estimate impacted days.')
      setEstimateByKey((prev) => ({ ...prev, [rowKey]: data.estimate }))
    } catch (e) {
      setEstimateErrorByKey((prev) => ({ ...prev, [rowKey]: e.message || 'Estimate failed.' }))
    } finally {
      setEstimatingKey('')
    }
  }

  async function handleEstimateRiskProbability() {
    if (!token || !payload) return
    const events = Array.isArray(payload?.ambee?.result) ? payload.ambee.result : []
    if (!events.length) {
      setRiskError('No events available in the current history response.')
      return
    }
    setRiskLoading(true)
    setRiskError('')
    try {
      const res = await fetch(`${BASE_URL}/api/ai/disasters/estimate-risk-probability`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          events,
          geocode: payload.geocode || {},
          from: payload.from,
          to: payload.to,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.message || 'Failed to estimate risk probability.')
      setRiskEstimate(data)
    } catch (e) {
      setRiskError(e.message || 'Risk probability estimate failed.')
    } finally {
      setRiskLoading(false)
    }
  }

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
            <h2 className="dash-welcome-title">Ambee — disaster history</h2>
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
            </p>
          </div>
          <button type="button" className="btn-ed btn-ed-outline" onClick={() => navigate(-1)}>
            ← Back
          </button>
        </div>

        <section className="profile-card weather-section disasters-history-controls">
          <h3 className="profile-card-title">Coordinates &amp; time range</h3>
          <div className="disasters-coords-banner">
            <div className="disasters-coords-row">
              <span className="weather-k">Latitude</span>
              <span className="disasters-coords-val">
                {hasCoords
                  ? Number(latParam).toFixed(5)
                  : previewGeo === 'loading'
                    ? '…'
                    : previewGeo?.error
                      ? '—'
                      : displayLat != null
                        ? Number(displayLat).toFixed(5)
                        : '—'}
              </span>
            </div>
            <div className="disasters-coords-row">
              <span className="weather-k">Longitude</span>
              <span className="disasters-coords-val">
                {hasCoords
                  ? Number(lngParam).toFixed(5)
                  : previewGeo === 'loading'
                    ? '…'
                    : previewGeo?.error
                      ? '—'
                      : displayLng != null
                        ? Number(displayLng).toFixed(5)
                        : '—'}
              </span>
            </div>
            {!hasCoords && previewGeo && typeof previewGeo === 'object' && !previewGeo.error && (previewGeo.name || previewGeo.country) && (
              <p className="dash-welcome-sub disasters-coords-place">
                {[previewGeo.name, previewGeo.state, previewGeo.country].filter(Boolean).join(', ')}
              </p>
            )}
            {!hasCoords && previewGeo?.error && (
              <p className="dash-welcome-sub disasters-coords-warn">{previewGeo.error}</p>
            )}
            <p className="dash-welcome-sub disasters-history-hint">
              Times below are your <strong>local</strong> selection; the API receives <strong>UTC</strong> in{' '}
              <code>YYYY-MM-DD HH:mm:ss</code> (required by Ambee). The end time cannot be after now.
            </p>
          </div>

          <div className="disasters-history-form">
            <label className="disasters-history-label">
              <span>From (local)</span>
              <input
                type="datetime-local"
                className="disasters-history-input"
                value={fromLocal}
                max={maxDatetimeLocal}
                onChange={(e) => setFromLocal(e.target.value)}
                disabled={loading}
              />
            </label>
            <label className="disasters-history-label">
              <span>To (local)</span>
              <input
                type="datetime-local"
                className="disasters-history-input"
                value={toLocal}
                max={maxDatetimeLocal}
                onChange={(e) => handleToChange(e.target.value)}
                disabled={loading}
              />
            </label>
            <button
              type="button"
              className="btn-ed btn-ed-primary disasters-history-submit"
              onClick={() => void loadHistory()}
              disabled={loading || !canRequest}
            >
              {loading ? 'Loading…' : 'Load history'}
            </button>
          </div>
          {windowNotes.length > 0 && (
            <ul className="disasters-window-notes">
              {windowNotes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
        </section>

        {error && <div className="form-alert">{error}</div>}

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
                      <span className="weather-k">Source</span> Coordinates from Geocode
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
              <h3 className="profile-card-title">Ambee — history</h3>
              {(payload.from || payload.to) && (
                <p className="dash-welcome-sub disasters-api-meta">
                  Sent to API (UTC): <strong>{payload.from}</strong> → <strong>{payload.to}</strong>
                </p>
              )}
              {ambee?.message && (
                <p className="dash-welcome-sub disasters-api-meta">
                  API: <strong>{ambee.message}</strong>
                  {ambee.limit != null && ` · Limit ${ambee.limit}`}
                  {ambee.page != null && ` · Page ${ambee.page}`}
                  {ambee.hasNextPage ? ' · More pages available' : ''}
                </p>
              )}
              {rows.length > 0 && (
                <div className="disasters-probability-box">
                  <button
                    type="button"
                    className="btn-ed btn-ed-outline disasters-estimate-prob-btn"
                    onClick={() => void handleEstimateRiskProbability()}
                    disabled={riskLoading}
                  >
                    {riskLoading ? 'Estimating risk…' : 'Estimate risk probability'}
                  </button>
                  {riskEstimate?.estimate && (
                    <div className="disasters-probability-result">
                      <div>
                        Probability: <strong>{riskEstimate.estimate.risk_probability_pct}%</strong>
                        {' · '}
                        Level: <strong>{riskEstimate.estimate.risk_level}</strong>
                        {' · '}
                        Confidence: <strong>{riskEstimate.estimate.confidence_pct}%</strong>
                      </div>
                      {Array.isArray(riskEstimate.estimate.top_drivers) && riskEstimate.estimate.top_drivers.length > 0 && (
                        <ul className="disasters-probability-drivers">
                          {riskEstimate.estimate.top_drivers.map((d) => (
                            <li key={d}>{d}</li>
                          ))}
                        </ul>
                      )}
                      {riskEstimate.estimate.rationale && (
                        <div className="disasters-probability-rationale">{riskEstimate.estimate.rationale}</div>
                      )}
                    </div>
                  )}
                  {riskError && <div className="field-error">{riskError}</div>}
                </div>
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
                        <th>Impact estimate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((ev) => {
                        const rowKey = eventRowKey(ev)
                        const estimate = estimateByKey[rowKey]
                        const err = estimateErrorByKey[rowKey]
                        const isBusy = estimatingKey === rowKey
                        return (
                        <tr key={rowKey}>
                          <td className="disasters-col-event">{ev.event_name || '—'}</td>
                          <td title={ev.event_type ? `Ambee code: ${ev.event_type}` : undefined}>
                            {ambeeEventTypeLabel(ev.event_type)}
                          </td>
                          <td>
                            <span className="disasters-severity">{ev.proximity_severity_level || '—'}</span>
                          </td>
                          <td>{ev.default_alert_levels || '—'}</td>
                          <td className="disasters-col-date">{ev.date || ev.created_time || '—'}</td>
                          <td className="fa-num">{ev.lat != null ? Number(ev.lat).toFixed(4) : '—'}</td>
                          <td className="fa-num">{ev.lng != null ? Number(ev.lng).toFixed(4) : '—'}</td>
                          <td className="disasters-impact-col">
                            <button
                              type="button"
                              className="btn-ed btn-ed-outline disasters-estimate-btn"
                              onClick={() => void handleEstimateDays(ev)}
                              disabled={isBusy}
                            >
                              {isBusy ? 'Estimating…' : 'Estimate days'}
                            </button>
                            {estimate && (
                              <div className="disasters-impact-result">
                                {estimate.impacted_days} / {estimate.working_days_year} days
                                {' '}
                                ({estimate.impact_ratio_percent}%)
                              </div>
                            )}
                            {estimate?.reason && (
                              <div className="disasters-impact-reason">{estimate.reason}</div>
                            )}
                            {err && <div className="field-error">{err}</div>}
                          </td>
                        </tr>
                        )
                      })}
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
