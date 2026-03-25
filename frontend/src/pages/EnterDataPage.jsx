import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function EnterDataPage() {
  const navigate = useNavigate()
  const { user, logout } = useAuth()
  const fileInputRef = useRef(null)

  const [uploadedFile, setUploadedFile] = useState(null)
  const [analysing, setAnalysing] = useState(false)
  const [analyseResult, setAnalyseResult] = useState(null)

  const initials = user?.username ? user.username.slice(0, 2).toUpperCase() : '??'

  function handleLogout() {
    logout()
    navigate('/login', { replace: true })
  }

  function handleDownloadTemplate() {
    // Placeholder: replace with a real file URL when ready
    const csvContent = 'Audit ID,Date,Category,Description,Status,Notes\n'
    const blob = new Blob([csvContent], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'audit_template.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  function handleFileChange(e) {
    const file = e.target.files[0]
    if (file) setUploadedFile(file)
  }

  async function handleAnalyse() {
    if (!uploadedFile) {
      alert('Please upload a filled document before analysing.')
      return
    }
    setAnalysing(true)
    setAnalyseResult(null)
    // Placeholder: wire up to real backend endpoint when ready
    await new Promise((r) => setTimeout(r, 1500))
    setAnalysing(false)
    setAnalyseResult({
      filename: uploadedFile.name,
      rows: '—',
      status: 'Ready for processing',
    })
  }

  return (
    <div className="dashboard">
      {/* Header */}
      <header className="dash-header">
        <div className="dash-brand">
          <span className="badge">SGS</span>
          <span className="dash-brand-name">Audit Platform</span>
        </div>
        <div className="dash-user">
          <div className="dash-avatar">{initials}</div>
          <span className="dash-username">{user?.username}</span>
          <button className="btn-logout" onClick={handleLogout}>Sign out</button>
        </div>
      </header>

      {/* Main */}
      <main className="dash-main">
        {/* Back + title */}
        <div className="ed-header">
          <button className="btn-back" onClick={() => navigate('/dashboard')}>
            ← Back to Dashboard
          </button>
          <h2 className="dash-welcome-title" style={{ margin: 0 }}>Enter Data</h2>
          <p className="dash-welcome-sub">
            Download the template, fill it in, then upload and analyse your data.
          </p>
        </div>

        {/* Action cards */}
        <div className="ed-cards">
          {/* Download Template */}
          <div className="ed-card">
            <div className="ed-card-icon">📥</div>
            <h3 className="ed-card-title">Download Template</h3>
            <p className="ed-card-desc">
              Get the standard CSV template to fill in your audit data.
            </p>
            <button className="btn-ed btn-ed-outline" onClick={handleDownloadTemplate}>
              Download Template
            </button>
          </div>

          {/* Upload */}
          <div className="ed-card">
            <div className="ed-card-icon">📤</div>
            <h3 className="ed-card-title">Upload Filled Document</h3>
            <p className="ed-card-desc">
              Upload your completed template to prepare it for analysis.
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.xlsx,.xls"
              style={{ display: 'none' }}
              onChange={handleFileChange}
            />
            <button
              className="btn-ed btn-ed-outline"
              onClick={() => fileInputRef.current.click()}
            >
              {uploadedFile ? `✓ ${uploadedFile.name}` : 'Choose File'}
            </button>
            {uploadedFile && (
              <span className="ed-file-note">
                {(uploadedFile.size / 1024).toFixed(1)} KB · {uploadedFile.type || 'file'}
              </span>
            )}
          </div>
        </div>

        {/* Analyse */}
        <div className="ed-analyse-row">
          <button
            className="btn-ed btn-ed-primary"
            onClick={handleAnalyse}
            disabled={analysing}
          >
            {analysing ? <span className="btn-spinner" /> : '🔍 Analyse'}
          </button>
        </div>

        {/* Result */}
        {analyseResult && (
          <div className="ed-result">
            <h3 className="ed-result-title">Analysis complete</h3>
            <div className="profile-rows">
              <div className="profile-row">
                <span className="profile-key">File</span>
                <span className="profile-val">{analyseResult.filename}</span>
              </div>
              <div className="profile-row">
                <span className="profile-key">Rows detected</span>
                <span className="profile-val">{analyseResult.rows}</span>
              </div>
              <div className="profile-row">
                <span className="profile-key">Status</span>
                <span className="profile-val accent">{analyseResult.status}</span>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
