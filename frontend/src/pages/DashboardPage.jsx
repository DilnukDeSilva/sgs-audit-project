import { useAuth } from '../context/AuthContext'
import { useNavigate } from 'react-router-dom'

const STATS = [
  { label: 'Total Audits', value: '0', icon: '📋' },
  { label: 'In Progress', value: '0', icon: '🔄' },
  { label: 'Completed', value: '0', icon: '✅' },
  { label: 'Pending Review', value: '0', icon: '🕐' },
]

export default function DashboardPage() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

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
            <button className="btn-enter-data" onClick={() => navigate('/enter-data')}>
              + Enter Data
            </button>
          </div>
        </section>

        {/* Stats grid */}
        <div className="stats-grid">
          {STATS.map((s) => (
            <div className="stat-card" key={s.label}>
              <span className="stat-icon">{s.icon}</span>
              <span className="stat-value">{s.value}</span>
              <span className="stat-label">{s.label}</span>
            </div>
          ))}
        </div>

        {/* Profile card */}
        <div className="profile-card">
          <h3 className="profile-card-title">Account details</h3>
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
