import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000'

const COLUMNS = [
  { key: 'risk', label: 'Risk', colClass: 'risk-col-risk' },
  { key: 'category', label: 'Category', colClass: 'risk-col-category' },
  { key: 'description', label: 'Description', colClass: 'risk-col-wide' },
  { key: 'impact', label: 'Impact', colClass: 'risk-col-impact' },
  { key: 'rcp_2_6', label: 'RCP 2.6', colClass: 'risk-col-rcp' },
  { key: 'rcp_8_5', label: 'RCP 8.5', colClass: 'risk-col-rcp' },
  // { key: 'komar_impact', label: 'Komar Impact', colClass: 'risk-col-komar' },
  { key: 'when_to_apply', label: 'When to Apply', colClass: 'risk-col-wide' },
]

const EMPTY_RISK_ROW = {
  risk: '',
  category: '',
  description: '',
  impact: '',
  rcp_2_6: '',
  rcp_8_5: '',
  komar_impact: '',
  when_to_apply: '',
}

export default function RiskTablePage() {
  const { token, logout, user } = useAuth()
  const navigate = useNavigate()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError('')
      try {
        const res = await fetch(`${BASE_URL}/api/risks/table`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.message || 'Failed to load risk table.')
        if (!cancelled) setRows(Array.isArray(data.rows) ? data.rows : [])
      } catch (err) {
        if (!cancelled) setError(err?.message || 'Failed to load risk table.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [token])

  function handleCellChange(rowIndex, key, value) {
    setRows((prev) =>
      prev.map((r, i) => (i === rowIndex ? { ...r, [key]: value } : r))
    )
    setSuccess('')
  }

  function handleAddRow() {
    setRows((prev) => [...prev, { ...EMPTY_RISK_ROW }])
    setSuccess('')
  }

  function handleDeleteRow(rowIndex) {
    setRows((prev) => prev.filter((_, i) => i !== rowIndex))
    setSuccess('')
  }

  async function handleSave() {
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      const res = await fetch(`${BASE_URL}/api/risks/table`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ rows }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.message || 'Failed to save risk table.')
      setRows(Array.isArray(data.rows) ? data.rows : rows)
      setSuccess('Risk table saved successfully.')
    } catch (err) {
      setError(err?.message || 'Failed to save risk table.')
    } finally {
      setSaving(false)
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
          <button className="btn-logout" onClick={() => { logout(); navigate('/login', { replace: true }) }}>
            Sign out
          </button>
        </div>
      </header>

      <main className="dash-main">
        <section className="dash-welcome">
          <div className="dash-welcome-row">
            <div>
              <h2 className="dash-welcome-title">Risk Table</h2>
              <p className="dash-welcome-sub">Edit any cell and click save to save changes to database. Click + Add Risk to add a new risk.</p>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn-ed btn-ed-outline" onClick={() => navigate('/dashboard')}>
                Back to Dashboard
              </button>
              <button className="btn-ed btn-ed-outline" onClick={handleAddRow} disabled={loading || saving}>
                + Add Risk
              </button>
              <button className="btn-enter-data" onClick={handleSave} disabled={saving || loading}>
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </section>

        {error && <div className="form-alert">{error}</div>}
        {success && <div className="ed-upload-success">{success}</div>}

        <div className="profile-card">
          {/* <div className="risk-helper" role="note">
            <strong>Adding a new risk:</strong> fill each column left to right. Use short labels for
            <em> Risk</em>/<em> Category</em>, clear sentence-level text for
            <em> Description</em>/<em> Impact</em>, and comma-separated keywords in
            <em> When to Apply</em>.
          </div> */}
          {loading ? (
            <p className="dash-welcome-sub" style={{ margin: 0 }}>Loading risk table...</p>
          ) : (
            <div className="fa-table-wrap risk-table-wrap">
              <table className="fa-table risk-table risk-table-clean">
                <thead>
                  <tr>
                    {COLUMNS.map((c) => (
                      <th key={c.key} className={c.colClass}>{c.label}</th>
                    ))}
                    <th className="risk-col-actions">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, rowIndex) => (
                    <tr key={`risk-row-${rowIndex}`}>
                      {COLUMNS.map((c) => {
                        const inputVariant =
                          c.colClass === 'risk-col-wide'
                            ? 'risk-input--wide'
                            : c.colClass === 'risk-col-impact' || c.colClass === 'risk-col-komar'
                              ? 'risk-input--medium'
                              : 'risk-input--compact'
                        const isCompact = inputVariant === 'risk-input--compact'
                        return (
                        <td key={`${rowIndex}-${c.key}`} className={c.colClass}>
                          {isCompact ? (
                            <input
                              className={`risk-input ${inputVariant}`}
                              value={row[c.key] || ''}
                              title={row[c.key] || ''}
                              aria-label={`Row ${rowIndex + 1} ${c.label}`}
                              spellCheck={false}
                              autoCorrect="off"
                              autoCapitalize="off"
                              data-gramm="false"
                              data-gramm_editor="false"
                              data-enable-grammarly="false"
                              onChange={(e) => handleCellChange(rowIndex, c.key, e.target.value)}
                            />
                          ) : (
                            <textarea
                              className={`risk-input ${inputVariant}`}
                              value={row[c.key] || ''}
                              title={row[c.key] || ''}
                              aria-label={`Row ${rowIndex + 1} ${c.label}`}
                              spellCheck={false}
                              autoCorrect="off"
                              autoCapitalize="off"
                              data-gramm="false"
                              data-gramm_editor="false"
                              data-enable-grammarly="false"
                              onChange={(e) => handleCellChange(rowIndex, c.key, e.target.value)}
                            />
                          )}
                        </td>
                        )
                      })}
                      <td className="risk-col-actions">
                        <button
                          className="btn-ed btn-ed-outline"
                          onClick={() => handleDeleteRow(rowIndex)}
                          disabled={saving}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
