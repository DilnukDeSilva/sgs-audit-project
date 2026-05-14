import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Tooltip,
  useMapEvents,
} from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { useAuth } from '../context/AuthContext'

const BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000'
const MAX_REGIONS = 50
const SEARCH_DEBOUNCE_MS = 400
const DEFAULT_CENTER = [20, 0]
const DEFAULT_ZOOM = 2

function regionTypeLabel(t) {
  if (t === 'state') return 'State'
  if (t === 'district') return 'District'
  return 'Region'
}

function MapClickLayer({ disabled, onPick }) {
  useMapEvents({
    click(e) {
      if (disabled) return
      onPick(e.latlng.lat, e.latlng.lng)
    },
  })
  return null
}

export default function MapNewPage() {
  const navigate = useNavigate()
  const { user, logout, token } = useAuth()
  const [regions, setRegions] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saveMessage, setSaveMessage] = useState('')
  const [updatedAt, setUpdatedAt] = useState(null)

  const [query, setQuery] = useState('')
  const [countryCodes, setCountryCodes] = useState('')
  const [searching, setSearching] = useState(false)
  const [results, setResults] = useState([])

  const [mapPickLoading, setMapPickLoading] = useState(false)
  const [mapPick, setMapPick] = useState(null)

  const initials = user?.username ? user.username.slice(0, 2).toUpperCase() : '??'
  const atMax = regions.length >= MAX_REGIONS

  const loadRegions = useCallback(async () => {
    if (!token) return
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`${BASE_URL}/api/map/regions/locations`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.message || 'Failed to load regions.')
      const list = (data.regions || []).map((r) => ({
        place_id: String(r.place_id),
        display_name: r.display_name,
        region_type: r.region_type || 'region',
        lat: r.lat ?? null,
        lon: r.lon ?? null,
        bbox: r.bbox ?? null,
      }))
      setRegions(list)
      setUpdatedAt(data.updated_at || null)
    } catch (err) {
      setError(err.message || 'Failed to load regions.')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    loadRegions()
  }, [loadRegions])

  function handleLogout() {
    logout()
    navigate('/login', { replace: true })
  }

  const trimmedQuery = query.trim()
  const ccParam = countryCodes.trim().toLowerCase().replace(/\s/g, '')

  useEffect(() => {
    if (!token || trimmedQuery.length < 2) {
      setResults([])
      setSearching(false)
      return
    }

    const ctrl = new AbortController()
    const t = setTimeout(async () => {
      setSearching(true)
      setError('')
      try {
        const qs = new URLSearchParams({ q: trimmedQuery })
        if (ccParam && /^[a-z]{2}(,[a-z]{2})*$/.test(ccParam)) {
          qs.set('countrycodes', ccParam)
        }
        const res = await fetch(`${BASE_URL}/api/map/regions/search?${qs}`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: ctrl.signal,
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.message || 'Search failed.')
        setResults(Array.isArray(data.results) ? data.results : [])
      } catch (err) {
        if (err.name === 'AbortError') return
        setResults([])
        setError(err.message || 'Search failed.')
      } finally {
        if (!ctrl.signal.aborted) setSearching(false)
      }
    }, SEARCH_DEBOUNCE_MS)

    return () => {
      ctrl.abort()
      clearTimeout(t)
    }
  }, [token, trimmedQuery, ccParam])

  function addRegion(hit) {
    if (atMax) return
    const pid = String(hit.place_id)
    if (regions.some((r) => r.place_id === pid)) {
      setSaveMessage('')
      setError('That area is already in your list.')
      return
    }
    setError('')
    setSaveMessage('')
    setRegions((prev) => [
      ...prev,
      {
        place_id: pid,
        display_name: hit.display_name,
        region_type: hit.region_type || 'region',
        lat: hit.lat ?? null,
        lon: hit.lon ?? null,
        bbox: hit.bbox ?? null,
      },
    ])
  }

  function removeRegion(placeId) {
    setRegions((prev) => prev.filter((r) => r.place_id !== placeId))
    setSaveMessage('')
  }

  async function handleMapClick(lat, lon) {
    if (atMax || mapPickLoading || !token) return
    setMapPickLoading(true)
    setSaveMessage('')
    setError('')
    try {
      const qs = new URLSearchParams({ lat: String(lat), lon: String(lon) })
      const res = await fetch(`${BASE_URL}/api/map/regions/from-point?${qs}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.message || 'Could not resolve this area.')
      const opts = Array.isArray(data.options) ? data.options : []
      if (opts.length === 0) {
        setMapPick(null)
        setError(
          'No state or district boundary was found for this click. Try another place or use search.'
        )
      } else {
        setMapPick({
          lat: data.lat ?? lat,
          lon: data.lon ?? lon,
          summary: data.summary || '',
          options: opts,
        })
      }
    } catch (err) {
      setMapPick(null)
      setError(err.message || 'Map lookup failed.')
    } finally {
      setMapPickLoading(false)
    }
  }

  async function handleSave() {
    setSaving(true)
    setError('')
    setSaveMessage('')
    try {
      const res = await fetch(`${BASE_URL}/api/map/regions/locations`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          regions: regions.map(({ place_id, display_name, region_type, lat, lon, bbox }) => {
            const row = { place_id, display_name, region_type }
            if (lat != null && lon != null) {
              row.lat = lat
              row.lon = lon
            }
            if (Array.isArray(bbox) && bbox.length === 4) row.bbox = bbox
            return row
          }),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.message || 'Save failed.')
      setSaveMessage(data.message || 'Saved.')
      setUpdatedAt(data.updated_at || null)
    } catch (err) {
      setError(err.message || 'Save failed.')
    } finally {
      setSaving(false)
    }
  }

  const boundsHint = useMemo(() => {
    if (!regions.length) return null
    const withBbox = regions.filter((r) => Array.isArray(r.bbox) && r.bbox.length === 4)
    if (!withBbox.length) return null
    return `${withBbox.length} area(s) include a map bounding box for reference.`
  }, [regions])

  const mapCenter = useMemo(() => {
    const withCoords = regions.filter((r) => r.lat != null && r.lon != null)
    if (withCoords.length) return [withCoords[0].lat, withCoords[0].lon]
    return DEFAULT_CENTER
  }, [regions])

  const mapZoom = useMemo(() => {
    return regions.some((r) => r.lat != null && r.lon != null) ? 5 : DEFAULT_ZOOM
  }, [regions])

  const boundsKey = useMemo(() => {
    if (!regions.length) return 'default'
    return regions.map((r) => `${r.place_id}`).join('|')
  }, [regions])

  return (
    <div className="dashboard">
      <header className="dash-header">
        <div className="dash-brand">
          <span className="badge">IM-PACT-A</span>
          <span className="dash-brand-name">Map New (states & districts)</span>
        </div>
        <div className="dash-user">
          <div className="dash-avatar">{initials}</div>
          <span className="dash-username">{user?.username}</span>
          <button className="btn-logout" type="button" onClick={handleLogout}>
            Sign out
          </button>
        </div>
      </header>

      <main className="dash-main map-page-main">
        <div className="map-page-toolbar">
          <button className="btn-back" type="button" onClick={() => navigate('/dashboard')}>
            ← Back to Dashboard
          </button>
          <div className="map-page-actions">
            <span className="map-count">
              {regions.length} / {MAX_REGIONS} regions
            </span>
            <button
              className="btn-ed btn-ed-primary"
              type="button"
              onClick={handleSave}
              disabled={saving || loading}
            >
              {saving ? 'Saving…' : 'Save map'}
            </button>
          </div>
        </div>

        <p className="dash-welcome-sub map-page-hint">
          Click the map to choose a state or district for that spot, or use search below. Each choice adds
          the whole administrative area as one row (up to {MAX_REGIONS}). Optional country filter applies
          to search only (ISO codes, e.g. <code>in</code> or <code>in,lk</code>).
          {updatedAt && (
            <span className="map-saved-at"> Last saved: {new Date(updatedAt).toLocaleString()}</span>
          )}
        </p>
        {boundsHint && (
          <p className="dash-welcome-sub map-page-hint" style={{ marginTop: -8 }}>
            {boundsHint}
          </p>
        )}

        {error && <div className="form-alert">{error}</div>}
        {saveMessage && <div className="form-success">{saveMessage}</div>}
        {mapPickLoading && (
          <p className="dash-welcome-sub" style={{ margin: 0 }}>
            Looking up state / district for this point…
          </p>
        )}

        <div className="map-page-grid map-new-page-grid">
          <div className="map-new-left-col">
            <div className="map-wrap map-new-map-wrap">
              {!loading && (
                <MapContainer
                  key={boundsKey}
                  center={mapCenter}
                  zoom={mapZoom}
                  className="map-leaflet map-new-leaflet"
                  scrollWheelZoom
                  worldCopyJump
                >
                  <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  />
                  <MapClickLayer disabled={atMax || mapPickLoading} onPick={handleMapClick} />
                  {mapPick && mapPick.lat != null && mapPick.lon != null && (
                    <CircleMarker
                      center={[mapPick.lat, mapPick.lon]}
                      radius={9}
                      pathOptions={{ color: '#0369a1', fillColor: '#38bdf8', fillOpacity: 0.9 }}
                    >
                      <Tooltip direction="top" offset={[0, -6]} opacity={1}>
                        {mapPick.summary}
                      </Tooltip>
                    </CircleMarker>
                  )}
                  {regions.map((r) =>
                    r.lat != null && r.lon != null ? (
                      <CircleMarker
                        key={r.place_id}
                        center={[r.lat, r.lon]}
                        radius={6}
                        pathOptions={{ color: '#7c3aed', fillColor: '#c084fc', fillOpacity: 0.75 }}
                      >
                        <Tooltip direction="top" offset={[0, -4]} opacity={1}>
                          {r.display_name}
                        </Tooltip>
                      </CircleMarker>
                    ) : null
                  )}
                </MapContainer>
              )}
            </div>

            {mapPick && mapPick.options.length > 0 && (
              <div className="map-new-pick-panel">
                <div className="map-new-pick-head">
                  <span className="map-new-pick-title">Add from map click</span>
                  <button type="button" className="btn-ed btn-ed-outline map-new-pick-dismiss" onClick={() => setMapPick(null)}>
                    Dismiss
                  </button>
                </div>
                <p className="map-new-pick-summary">{mapPick.summary}</p>
                <ul className="map-new-pick-options">
                  {mapPick.options.map((opt) => (
                    <li key={`${opt.place_id}-${opt.region_type}`} className="map-search-result-item">
                      <div className="map-search-result-text">
                        <span className={`map-region-type map-region-type-${opt.region_type || 'region'}`}>
                          {regionTypeLabel(opt.region_type)}
                        </span>
                        <div className="map-search-result-name">{opt.display_name}</div>
                      </div>
                      <button
                        type="button"
                        className="btn-ed btn-ed-outline map-search-add"
                        disabled={atMax}
                        onClick={() => addRegion(opt)}
                      >
                        Add
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="map-wrap map-new-search-wrap">
              <div className="map-new-search-inner">
                <label className="map-new-label" htmlFor="region-search">
                  Search state or district
                </label>
                <div className="map-new-search-row">
                  <input
                    id="region-search"
                    className="map-new-input"
                    type="search"
                    autoComplete="off"
                    placeholder="e.g. Karnataka, Lahore district"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    disabled={loading}
                  />
                  <input
                    className="map-new-input map-new-input-cc"
                    type="text"
                    inputMode="text"
                    autoComplete="off"
                    placeholder="Country"
                    title="Optional ISO 3166-1 alpha-2, comma-separated"
                    value={countryCodes}
                    onChange={(e) => setCountryCodes(e.target.value)}
                    disabled={loading}
                  />
                </div>
                {trimmedQuery.length > 0 && trimmedQuery.length < 2 && (
                  <p className="dash-welcome-sub" style={{ margin: '8px 0 0' }}>
                    Type at least 2 characters to search.
                  </p>
                )}
                {searching && trimmedQuery.length >= 2 && (
                  <p className="dash-welcome-sub" style={{ margin: '10px 0 0' }}>
                    Searching…
                  </p>
                )}
                {!searching && trimmedQuery.length >= 2 && results.length === 0 && (
                  <p className="dash-welcome-sub" style={{ margin: '10px 0 0' }}>
                    No results. Try another spelling or widen the country filter.
                  </p>
                )}
                <ul className="map-search-results">
                  {results.map((hit) => (
                    <li key={String(hit.place_id)} className="map-search-result-item">
                      <div className="map-search-result-text">
                        <span className={`map-region-type map-region-type-${hit.region_type || 'region'}`}>
                          {regionTypeLabel(hit.region_type)}
                        </span>
                        <div className="map-search-result-name">{hit.display_name}</div>
                      </div>
                      <button
                        type="button"
                        className="btn-ed btn-ed-outline map-search-add"
                        disabled={atMax || loading}
                        onClick={() => addRegion(hit)}
                      >
                        Add
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>

          <aside className="map-sidebar map-new-sidebar">
            <h3 className="map-sidebar-title">Selected regions</h3>
            {atMax && (
              <p className="field-error" style={{ marginTop: 0 }}>
                Maximum {MAX_REGIONS} reached. Remove one to add more.
              </p>
            )}
            <ul className="map-location-list">
              {regions.map((r, idx) => (
                <li key={r.place_id} className="map-location-item">
                  <div className="map-location-num">{idx + 1}</div>
                  <div className="map-location-body">
                    <div className="map-location-address">{r.display_name}</div>
                    <div className="map-location-coords">
                      <span className={`map-region-type map-region-type-${r.region_type}`}>
                        {regionTypeLabel(r.region_type)}
                      </span>
                      {r.lat != null && r.lon != null && (
                        <>
                          {' '}
                          · {Number(r.lat).toFixed(4)}, {Number(r.lon).toFixed(4)}
                        </>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn-ed btn-ed-outline map-location-remove"
                    onClick={() => removeRegion(r.place_id)}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
            {regions.length === 0 && !loading && (
              <p className="dash-welcome-sub">
                No regions yet. Click the map or use search, then Add.
              </p>
            )}
          </aside>
        </div>
      </main>
    </div>
  )
}
