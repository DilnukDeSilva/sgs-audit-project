import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useNavigate } from 'react-router-dom'

const BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000'

export default function DashboardPage() {
  const { user, logout, token } = useAuth()
  const navigate = useNavigate()
  const [sessionsLoading, setSessionsLoading] = useState(true)
  const [sessionsError, setSessionsError] = useState('')
  const [sessions, setSessions] = useState([])
  const [deleteConfirmId, setDeleteConfirmId] = useState(null)
  const [deletingId, setDeletingId] = useState(null)

  function handleLogout() {
    logout()
    navigate('/login', { replace: true })
  }

  const initials = user?.username
    ? user.username.slice(0, 2).toUpperCase()
    : '??'

  const memberSince = user?.created_at
    ? new Date(user.created_at).toLocaleDateString('en-US', {
        month: 'long',
        year: 'numeric',
      })
    : '—'

  useEffect(() => {
    let cancelled = false
    async function loadSessions() {
      if (!token) {
        setSessions([])
        setSessionsLoading(false)
        setSessionsError('')
        return
      }
      setSessionsLoading(true)
      setSessionsError('')
      try {
        const ctrl = new AbortController()
        const opts = {
          headers: { Authorization: `Bearer ${token}` },
          signal: ctrl.signal,
        }
        const [uploadsRes, analysesRes] = await Promise.all([
          fetch(`${BASE_URL}/api/data/uploads`, opts),
          fetch(`${BASE_URL}/api/data/analyses`, opts),
        ])
        const uploadsData = await uploadsRes.json().catch(() => ({}))
        const analysesData = await analysesRes.json().catch(() => ({}))
        if (!uploadsRes.ok) throw new Error(uploadsData.message || 'Failed to load upload sessions.')
        if (!analysesRes.ok) throw new Error(analysesData.message || 'Failed to load analyses.')

        const analysisByUploadId = new Map(
          (analysesData.analyses || []).map((a) => [a.upload_id, a])
        )
        const merged = (uploadsData.uploads || []).map((u) => ({
          ...u,
          analysis: analysisByUploadId.get(u.id) || null,
        }))
        if (!cancelled) setSessions(merged)
      } catch (err) {
        const msg = err?.message || 'Failed to load sessions.'
        if (!cancelled) {
          setSessionsError(
            msg === 'Failed to fetch'
              ? `Could not reach the backend at ${BASE_URL}. Make sure the Flask server is running and CORS/URL are correct.`
              : msg
          )
        }
      } finally {
        if (!cancelled) setSessionsLoading(false)
      }
    }
    loadSessions()
    return () => {
      cancelled = true
    }
  }, [token])

  const stats = useMemo(() => {
    const total = sessions.length
    const completed = sessions.filter((s) => s.analysis).length
    const inProgress = total - completed
    return [
      { label: 'Total Sessions', value: String(total), icon: '📋' },
      { label: 'In Progress', value: String(inProgress), icon: '🔄' },
      { label: 'Completed', value: String(completed), icon: '✅' },
      { label: 'Pending Review', value: '0', icon: '🕐' },
    ]
  }, [sessions])

  async function handleDeleteSession(uploadId) {
    setDeletingId(uploadId)
    setSessionsError('')
    try {
      const res = await fetch(`${BASE_URL}/api/data/uploads/${uploadId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.message || 'Failed to delete session.')

      setSessions((prev) => prev.filter((s) => s.id !== uploadId))
      if (deleteConfirmId === uploadId) setDeleteConfirmId(null)
    } catch (err) {
      setSessionsError(err?.message || 'Failed to delete session.')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="dashboard">
      {/* Top nav */}
      <header className="dash-header">
        <div className="dash-brand">
          <span className="badge">SGS</span>
          <span className="dash-brand-name">Audit Platform</span>
        </div>
        <div className="dash-user">
          <div className="dash-avatar">{initials}</div>
          <span className="dash-username">{user?.username}</span>
          <button className="btn-logout" onClick={handleLogout}>
            Sign out
          </button>
        </div>
      </header>

      {/* Main content */}
      <main className="dash-main">
        {/* Welcome */}
        <section className="dash-welcome">
          <div className="dash-welcome-row">
            <div>
              <h2 className="dash-welcome-title">
                Welcome back, <span className="accent">{user?.username}</span> 👋
              </h2>
              <p className="dash-welcome-sub">
                Here&apos;s an overview of your audit activity.
              </p>
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {/* <button className="btn-enter-data" onClick={() => navigate('/enter-data')}>
                + Enter Data
              </button> */}
              <button className="btn-ed btn-ed-primary" onClick={() => navigate('/enter-data')}>
                Continue last session
              </button>
              <button
                className="btn-ed btn-ed-outline"
                onClick={() => {
                  sessionStorage.removeItem('sgs_enter_data_state')
                  navigate('/enter-data')
                }}
              >
                Start new
              </button>
            </div>
          </div>
        </section>

        {/* Stats grid */}
        <div className="stats-grid">
          {stats.map((s) => (
            <div className="stat-card" key={s.label}>
              <span className="stat-icon">{s.icon}</span>
              <span className="stat-value">{s.value}</span>
              <span className="stat-label">{s.label}</span>
            </div>
          ))}
        </div>

        <div className="profile-card">
          <h3 className="profile-card-title">Enter Data Sessions</h3>
          {sessionsLoading && (
            <p className="dash-welcome-sub" style={{ margin: 0 }}>Loading sessions…</p>
          )}
          {sessionsError && <div className="form-alert">{sessionsError}</div>}
          {!sessionsLoading && !sessionsError && sessions.length === 0 && (
            <p className="dash-welcome-sub" style={{ margin: 0 }}>
              No sessions yet. Click <strong>Enter Data</strong> to upload your first file.
            </p>
          )}
          {!sessionsLoading && !sessionsError && sessions.length > 0 && (
            <div className="sessions-list">
              {sessions.map((s) => {
                const uploadedAt = s.uploaded_at
                  ? new Date(s.uploaded_at).toLocaleString()
                  : '—'
                const analysedAt = s.analysis?.analysed_at
                  ? new Date(s.analysis.analysed_at).toLocaleString()
                  : null
                return (
                  <div className="session-row" key={s.id}>
                    <div className="session-main">
                      <div className="session-file">{s.filename}</div>
                      <div className="session-meta">
                        Uploaded: {uploadedAt}
                        {analysedAt ? ` • Analysed: ${analysedAt}` : ' • Not analysed yet'}
                      </div>
                    </div>
                    <div className="session-actions">
                      <button
                        className="btn-ed btn-ed-outline"
                        onClick={() =>
                          navigate('/enter-data', {
                            state: {
                              sessionUploadId: s.id,
                              sessionAnalysisId: s.analysis?.id || null,
                            },
                          })
                        }
                      >
                        Open Session
                      </button>
                      {deleteConfirmId !== s.id ? (
                        <button
                          className="btn-ed btn-ed-outline"
                          onClick={() => setDeleteConfirmId(s.id)}
                          disabled={deletingId === s.id}
                        >
                          Delete
                        </button>
                      ) : (
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button
                            className="btn-ed btn-ed-primary"
                            onClick={() => handleDeleteSession(s.id)}
                            disabled={deletingId === s.id}
                          >
                            {deletingId === s.id ? 'Deleting...' : 'Yes'}
                          </button>
                          <button
                            className="btn-ed btn-ed-outline"
                            onClick={() => setDeleteConfirmId(null)}
                            disabled={deletingId === s.id}
                          >
                            No
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Profile card */}
        <div className="profile-card">
          <div className="dash-welcome-row" style={{ marginBottom: 8 }}>
            <h3 className="profile-card-title" style={{ margin: 0 }}>Account details</h3>
            <button
              className="btn-ed btn-ed-outline"
              onClick={() => navigate('/risk-table')}
            >
              Risk Table
            </button>
          </div>
          <div className="profile-rows">
            <div className="profile-row">
              <span className="profile-key">Username</span>
              <span className="profile-val">{user?.username}</span>
            </div>
            <div className="profile-row">
              <span className="profile-key">Email</span>
              <span className="profile-val">{user?.email}</span>
            </div>
            <div className="profile-row">
              <span className="profile-key">Member since</span>
              <span className="profile-val">{memberSince}</span>
            </div>
            <div className="profile-row">
              <span className="profile-key">User ID</span>
              <span className="profile-val profile-mono">{user?.id}</span>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
