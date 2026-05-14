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
const MAX_LOCATIONS = 50
const DEFAULT_CENTER = [20, 0]
const DEFAULT_ZOOM = 2

function newId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function isNear(a, b, eps = 1e-4) {
  return Math.abs(a.lat - b.lat) < eps && Math.abs(a.lon - b.lon) < eps
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

export default function MapPage() {
  const navigate = useNavigate()
  const { user, logout, token } = useAuth()
  const [locations, setLocations] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [reverseLoading, setReverseLoading] = useState(false)
  const [error, setError] = useState('')
  const [saveMessage, setSaveMessage] = useState('')
  const [updatedAt, setUpdatedAt] = useState(null)

  const initials = user?.username ? user.username.slice(0, 2).toUpperCase() : '??'
  const atMax = locations.length >= MAX_LOCATIONS

  const loadLocations = useCallback(async () => {
    if (!token) return
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`${BASE_URL}/api/map/locations`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.message || 'Failed to load map.')
      const locs = (data.locations || []).map((l, i) => ({
        id: l.id || `loaded-${i}`,
        lat: l.lat,
        lon: l.lon,
        address: l.address,
      }))
      setLocations(locs)
      setUpdatedAt(data.updated_at || null)
    } catch (err) {
      setError(err.message || 'Failed to load map.')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    loadLocations()
  }, [loadLocations])

  function handleLogout() {
    logout()
    navigate('/login', { replace: true })
  }

  async function handleMapClick(lat, lon) {
    if (atMax || reverseLoading) return
    const candidate = { lat, lon }
    if (locations.some((l) => isNear(l, candidate))) {
      setSaveMessage('')
      setError('That spot is already in your list (too close to an existing point).')
      return
    }
    setReverseLoading(true)
    setError('')
    setSaveMessage('')
    try {
      const qs = new URLSearchParams({ lat: String(lat), lon: String(lon) })
      const res = await fetch(`${BASE_URL}/api/map/reverse?${qs}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.message || 'Could not resolve address.')
      setLocations((prev) => {
        if (prev.length >= MAX_LOCATIONS) return prev
        return [
          ...prev,
          {
            id: newId(),
            lat: data.lat,
            lon: data.lon,
            address: data.address || `${lat.toFixed(5)}, ${lon.toFixed(5)}`,
          },
        ]
      })
    } catch (err) {
      setError(err.message || 'Reverse geocode failed.')
    } finally {
      setReverseLoading(false)
    }
  }

  function removeLocation(id) {
    setLocations((prev) => prev.filter((l) => l.id !== id))
    setSaveMessage('')
  }

  async function handleSave() {
    setSaving(true)
    setError('')
    setSaveMessage('')
    try {
      const res = await fetch(`${BASE_URL}/api/map/locations`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          locations: locations.map(({ lat, lon, address }) => ({ lat, lon, address })),
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

  const boundsKey = useMemo(() => {
    if (!locations.length) return 'default'
    return locations.map((l) => `${l.lat},${l.lon}`).join('|')
  }, [locations])

  return (
    <div className="dashboard">
      <header className="dash-header">
        <div className="dash-brand">
          <span className="badge">IM-PACT-A</span>
          <span className="dash-brand-name">Location Map</span>
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
              {locations.length} / {MAX_LOCATIONS} locations
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
          Click anywhere on the map to add a point. The address is resolved automatically (max {MAX_LOCATIONS}).
          {updatedAt && (
            <span className="map-saved-at"> Last saved: {new Date(updatedAt).toLocaleString()}</span>
          )}
        </p>

        {error && <div className="form-alert">{error}</div>}
        {saveMessage && <div className="form-success">{saveMessage}</div>}
        {reverseLoading && (
          <p className="dash-welcome-sub" style={{ margin: 0 }}>Resolving address…</p>
        )}

        <div className="map-page-grid">
          <div className="map-wrap">
            {!loading && (
              <MapContainer
                key={boundsKey}
                center={locations.length ? [locations[0].lat, locations[0].lon] : DEFAULT_CENTER}
                zoom={locations.length ? 4 : DEFAULT_ZOOM}
                className="map-leaflet"
                scrollWheelZoom
                worldCopyJump
              >
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                <MapClickLayer disabled={atMax || reverseLoading} onPick={handleMapClick} />
                {locations.map((loc) => (
                  <CircleMarker
                    key={loc.id}
                    center={[loc.lat, loc.lon]}
                    radius={8}
                    pathOptions={{ color: '#7c3aed', fillColor: '#c084fc', fillOpacity: 0.85 }}
                  >
                    <Tooltip direction="top" offset={[0, -6]} opacity={1} permanent={false}>
                      {loc.address}
                    </Tooltip>
                  </CircleMarker>
                ))}
              </MapContainer>
            )}
          </div>

          <aside className="map-sidebar">
            <h3 className="map-sidebar-title">Selected locations</h3>
            {atMax && (
              <p className="field-error" style={{ marginTop: 0 }}>
                Maximum {MAX_LOCATIONS} reached. Remove one to add more.
              </p>
            )}
            <ul className="map-location-list">
              {locations.map((loc, idx) => (
                <li key={loc.id} className="map-location-item">
                  <div className="map-location-num">{idx + 1}</div>
                  <div className="map-location-body">
                    <div className="map-location-address">{loc.address}</div>
                    <div className="map-location-coords">
                      {loc.lat.toFixed(5)}, {loc.lon.toFixed(5)}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn-ed btn-ed-outline map-location-remove"
                    onClick={() => removeLocation(loc.id)}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
            {locations.length === 0 && !loading && (
              <p className="dash-welcome-sub">No locations yet. Click the map to add your first point.</p>
            )}
          </aside>
        </div>
      </main>
    </div>
  )
}
