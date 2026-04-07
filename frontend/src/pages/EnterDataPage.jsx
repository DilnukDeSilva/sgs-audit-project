import { Fragment, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000'
const SESSION_KEY = 'sgs_enter_data_state'

/** Normalize for matching asset type keywords from risk "when to apply" lists. */
function normalizeForMatch(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * Match comma-separated keywords in risk.when_to_apply to asset type name.
 * Returns true if any keyword matches (substring or token overlap).
 */
function keywordMatchesAssetType(keyword, assetType) {
  const kw = normalizeForMatch(keyword)
  const at = normalizeForMatch(assetType)
  if (kw.length < 2 || at.length < 2) return false
  if (at.includes(kw) || kw.includes(at)) return true
  const kwTokens = kw.split(/\s+/).filter((t) => t.length >= 3)
  for (const t of kwTokens) {
    if (at.includes(t)) return true
    if (t.length > 4 && at.includes(t.slice(0, -1))) return true
  }
  return false
}

function getApplyingRisksForAssetType(assetType, riskRows) {
  if (!Array.isArray(riskRows) || !riskRows.length) return []
  const labels = []
  for (const r of riskRows) {
    const raw = r.when_to_apply || ''
    const parts = raw.split(',').map((s) => s.trim()).filter(Boolean)
    let matched = false
    for (const part of parts) {
      if (keywordMatchesAssetType(part, assetType)) {
        matched = true
        break
      }
    }
    if (matched) labels.push(r.risk || 'Risk')
  }
  return [...new Set(labels)]
}

function normalizeLocationWhitespace(s) {
  return String(s || '').replace(/\s+/g, ' ').trim()
}

/** Merge "… - KOGGALA 2" with "… - KOGGALA" (trailing 2/3 on site name only). */
function stripTrailingDuplicateSiteSuffix(s) {
  return normalizeLocationWhitespace(s).replace(/\s+([23])\s*$/g, '')
}

/**
 * Short site codes after "Org - " (e.g. LLI, SGI, SGL) collapse to one line: org name only.
 * Real sites (city names, addresses) stay as "Org - Place".
 */
function isShortSiteCodeSegment(segment) {
  const t = segment.trim()
  if (t.length < 2 || t.length > 4) return false
  return /^[A-Za-z]+$/.test(t)
}

/**
 * Dedupe + merge redundant location lines per asset type (fewer geocoding/API calls).
 */
function collapseRedundantLocations(rawList) {
  if (!Array.isArray(rawList) || !rawList.length) return []
  const step1 = [...new Set(rawList.map(normalizeLocationWhitespace).filter(Boolean))]
    .map(stripTrailingDuplicateSiteSuffix)

  const byParent = new Map()
  const noDash = []

  for (const loc of step1) {
    const idx = loc.indexOf(' - ')
    if (idx === -1) {
      noDash.push(loc)
      continue
    }
    const parent = loc.slice(0, idx).trim()
    const child = loc.slice(idx + 3).trim()
    if (!byParent.has(parent)) byParent.set(parent, [])
    byParent.get(parent).push({ full: loc, child })
  }

  const merged = []

  for (const loc of noDash) {
    merged.push(loc)
  }

  for (const [parent, rows] of byParent) {
    const shorts = rows.filter((r) => isShortSiteCodeSegment(r.child))
    const longs = rows.filter((r) => !isShortSiteCodeSegment(r.child))
    if (shorts.length) {
      merged.push(parent)
    }
    const seenLong = new Set()
    for (const r of longs) {
      const k = r.full.toLowerCase()
      if (seenLong.has(k)) continue
      seenLong.add(k)
      merged.push(r.full)
    }
  }

  return [...new Set(merged.map(normalizeLocationWhitespace))].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: 'base' })
  )
}

function savePageState(uploadResult, analyseResult, rowAiByType) {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({
      uploadResult: uploadResult || null,
      analyseResult: analyseResult || null,
      rowAiByType: rowAiByType || {},
    }))
  } catch { /* ignore */ }
}

function loadPageState() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

export default function EnterDataPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user, logout, token } = useAuth()
  const fileInputRef = useRef(null)

  // Restore persisted state immediately — no flash of empty page
  const _saved = loadPageState()

  const [uploadedFile, setUploadedFile] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [uploadResult, setUploadResult] = useState(_saved?.uploadResult || null)
  const [uploadError, setUploadError] = useState('')
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState('')
  const [analysing, setAnalysing] = useState(false)
  const [analyseResult, setAnalyseResult] = useState(_saved?.analyseResult || null)
  const [rowAiByType, setRowAiByType] = useState(_saved?.rowAiByType || {})
  const [rowAiLoading, setRowAiLoading] = useState(null)
  const [sessionLoading, setSessionLoading] = useState(false)
  const [sessionError, setSessionError] = useState('')
  const [riskRows, setRiskRows] = useState([])

  const initials = user?.username ? user.username.slice(0, 2).toUpperCase() : '??'

  function handleLogout() {
    logout()
    navigate('/login', { replace: true })
  }

  async function handleDownloadTemplate() {
    setDownloading(true)
    setDownloadError('')
    try {
      const res = await fetch(`${BASE_URL}/api/templates/download`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.message || 'Download failed.')
      }
      // Derive filename from Content-Disposition header if present
      const disposition = res.headers.get('Content-Disposition') || ''
      const match = disposition.match(/filename[^;=\n]*=["']?([^"';\n]+)["']?/)
      const filename = match ? match[1] : 'audit_template'

      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setDownloadError(err.message)
    } finally {
      setDownloading(false)
    }
  }

  function handleFileChange(e) {
    const file = e.target.files[0]
    if (file) {
      sessionStorage.removeItem(SESSION_KEY)
      setUploadedFile(file)
      setUploadResult(null)
      setUploadError('')
      setAnalyseResult(null)
      setRowAiByType({})
    }
  }

  // Persist to sessionStorage whenever key state changes
  useEffect(() => {
    savePageState(uploadResult, analyseResult, rowAiByType)
  }, [uploadResult, analyseResult, rowAiByType])

  useEffect(() => {
    if (!token) return
    const hasTable = analyseResult?.table?.length
    if (!hasTable) {
      setRiskRows([])
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`${BASE_URL}/api/risks/table`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.message || 'Failed to load risks')
        if (!cancelled) setRiskRows(Array.isArray(data.rows) ? data.rows : [])
      } catch {
        if (!cancelled) setRiskRows([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [token, analyseResult?._analysisId, analyseResult?.table?.length])

  async function runAnalysis(uploadId) {
    setAnalysing(true)
    setAnalyseResult(null)
    setRowAiByType({})
    try {
      const res = await fetch(
        `${BASE_URL}/api/data/uploads/${uploadId}/analyse/fixed-assets`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      const data = await res.json()
      if (!res.ok) throw new Error(data.message || 'Analysis failed.')
      const analysisId = data.analysis_id || uploadId
      setAnalyseResult({
        ...data,
        _analysisId: analysisId,
        _uploadId: uploadId,
      })
    } catch (err) {
      setAnalyseResult({ error: err.message })
    } finally {
      setAnalysing(false)
    }
  }

  async function handleUpload() {
    if (!uploadedFile) return
    sessionStorage.removeItem(SESSION_KEY)
    setUploading(true)
    setUploadError('')
    setUploadResult(null)
    setAnalyseResult(null)
    setRowAiByType({})
    try {
      const formData = new FormData()
      formData.append('file', uploadedFile)
      const res = await fetch(`${BASE_URL}/api/data/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message || 'Upload failed.')
      setUploadResult(data.upload)
      // Automatically analyse right after upload
      await runAnalysis(data.upload.id)
    } catch (err) {
      setUploadError(err.message)
    } finally {
      setUploading(false)
    }
  }

  async function handleDownloadText() {
    if (!uploadResult) return
    const res = await fetch(`${BASE_URL}/api/data/uploads/${uploadResult.id}/text`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${uploadResult.filename.replace(/\.[^.]+$/, '')}_extracted.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function handleAnalyse() {
    if (!uploadResult) return
    await runAnalysis(uploadResult.id)
  }

  // When "Open Session" is clicked from Dashboard, load that specific session
  useEffect(() => {
    const sessionUploadId = location.state?.sessionUploadId
    const sessionAnalysisId = location.state?.sessionAnalysisId
    if (!sessionUploadId || !token) return

    // Skip if we already have this session loaded
    if (uploadResult?.id === sessionUploadId) return

    let cancelled = false
    ;(async () => {
      setSessionLoading(true)
      setSessionError('')
      try {
        // Fetch upload directly by listing and finding it
        const uploadsRes = await fetch(`${BASE_URL}/api/data/uploads`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        const uploadsData = await uploadsRes.json()
        if (!uploadsRes.ok) throw new Error(uploadsData.message || 'Failed to load session.')
        const selectedUpload = (uploadsData.uploads || []).find((u) => u.id === sessionUploadId)
        if (!selectedUpload) throw new Error('Session upload not found.')
        if (cancelled) return
        setUploadedFile(null)
        setUploadResult(selectedUpload)
        setUploadError('')
        setAnalyseResult(null)
        setRowAiByType({})

        if (sessionAnalysisId) {
          const analysisRes = await fetch(
            `${BASE_URL}/api/data/analyses/${sessionAnalysisId}`,
            { headers: { Authorization: `Bearer ${token}` } }
          )
          const analysisData = await analysisRes.json()
          if (!analysisRes.ok) throw new Error(analysisData.message || 'Failed to load analysis.')
          if (cancelled) return
          setAnalyseResult({
            ...analysisData,
            _analysisId: analysisData.id || sessionAnalysisId,
            _uploadId: sessionUploadId,
          })
        }
      } catch (err) {
        if (!cancelled) setSessionError(err.message || 'Failed to open session.')
      } finally {
        if (!cancelled) setSessionLoading(false)
      }
    })()

    return () => { cancelled = true }
  }, [location.state?.sessionUploadId, location.state?.sessionAnalysisId, token])

  useEffect(() => {
    const id = analyseResult?._analysisId || analyseResult?._uploadId
    if (!id || analyseResult?.error) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`${BASE_URL}/api/ai/analyses/${id}/categorise`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) return
        const data = await res.json()
        if (cancelled || !data.per_type_summaries?.length) return
        const map = {}
        for (const s of data.per_type_summaries) {
          map[s.type] = {
            ai_response: s.ai_response,
            model: s.model,
            unique_uses_sent: s.unique_uses_sent,
          }
        }
        setRowAiByType(map)
      } catch {
        /* no saved summaries */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [analyseResult?._analysisId, analyseResult?._uploadId, analyseResult?.error, token])

  async function handleAiForType(assetType) {
    const analysisId = analyseResult?._analysisId || analyseResult?._uploadId || uploadResult?.id
    if (!analysisId) return
    setRowAiLoading(assetType)
    setRowAiByType((prev) => {
      const next = { ...prev }
      if (next[assetType]) {
        next[assetType] = { ...next[assetType], error: undefined }
      }
      return next
    })
    try {
      const res = await fetch(`${BASE_URL}/api/ai/analyses/${analysisId}/categorise-type`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ asset_type: assetType }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message || 'AI request failed.')
      setRowAiByType((prev) => ({
        ...prev,
        [assetType]: {
          ai_response: data.ai_response,
          model: data.model,
          unique_uses_sent: data.unique_uses_sent,
        },
      }))
    } catch (err) {
      setRowAiByType((prev) => ({
        ...prev,
        [assetType]: {
          ...prev[assetType],
          error: err.message,
        },
      }))
    } finally {
      setRowAiLoading(null)
    }
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
        {sessionLoading && <div className="dash-welcome-sub">Opening session…</div>}
        {sessionError && <div className="form-alert">{sessionError}</div>}

        {/* Action cards */}
        <div className="ed-cards">
          {/* Download Template */}
          <div className="ed-card">
            <div className="ed-card-icon">📥</div>
            <h3 className="ed-card-title">Download Template</h3>
            <p className="ed-card-desc">
              Get the standard audit template file(s) to fill in your data.
            </p>
            <button
              className="btn-ed btn-ed-outline"
              onClick={handleDownloadTemplate}
              disabled={downloading}
            >
              {downloading ? <><span className="btn-spinner btn-spinner-accent" /> Downloading…</> : 'Download Template'}
            </button>
            {downloadError && <span className="field-error">{downloadError}</span>}
          </div>

          {/* Upload */}
          <div className="ed-card">
            <div className="ed-card-icon">📤</div>
            <h3 className="ed-card-title">Upload Filled Document</h3>
            <p className="ed-card-desc">
              Upload your completed template (.xlsx, .xls, .csv) to extract and categorise the data.
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.xlsx,.xls"
              style={{ display: 'none' }}
              onChange={handleFileChange}
            />
            <div className="ed-upload-row">
              <button
                className="btn-ed btn-ed-outline"
                onClick={() => fileInputRef.current.click()}
                disabled={uploading}
              >
                {uploadedFile ? `✓ ${uploadedFile.name}` : 'Choose File'}
              </button>
              {uploadedFile && !uploadResult && (
                <button
                  className="btn-ed btn-ed-primary"
                  onClick={handleUpload}
                  disabled={uploading || analysing}
                  style={{ padding: '10px 18px', fontSize: '14px' }}
                >
                  {uploading || analysing
                    ? <><span className="btn-spinner" /> {uploading ? 'Uploading…' : 'Analysing…'}</>
                    : 'Upload & Analyse'}
                </button>
              )}
            </div>
            {uploadedFile && (
              <span className="ed-file-note">
                {(uploadedFile.size / 1024).toFixed(1)} KB · {uploadedFile.name.split('.').pop().toUpperCase()}
              </span>
            )}
            {uploadError && <span className="field-error">{uploadError}</span>}
            {uploadResult && (
              <div className="ed-upload-success">
                <span>✅ Extracted {uploadResult.sheets.length} sheet{uploadResult.sheets.length !== 1 ? 's' : ''}</span>
                <button className="auth-link ed-txt-btn" onClick={handleDownloadText}>
                  Download .txt
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Analyse */}
        <div className="ed-analyse-row">
          <button
            className="btn-ed btn-ed-primary"
            onClick={handleAnalyse}
            disabled={analysing || !uploadResult}
            title={!uploadResult ? 'Upload a file first' : ''}
          >
            {analysing ? <span className="btn-spinner" /> : '🔍 Analyse'}
          </button>
          {!uploadResult && (
            <span className="ed-file-note" style={{ marginLeft: 12 }}>Upload a file first to enable analysis</span>
          )}
        </div>

        {/* Analysis result */}
        {analyseResult && (
          analyseResult.error
            ? <div className="form-alert">{analyseResult.error}</div>
            : <>
                <FixedAssetsTable
                  result={analyseResult}
                  riskRows={riskRows}
                  rowAiByType={rowAiByType}
                  rowAiLoading={rowAiLoading}
                  onAiForType={handleAiForType}
                />
              </>
        )}
      </main>
    </div>
  )
}

/** Remove leading section emoji markers from rendered AI text (parsing still uses raw markers). */
function stripLeadingAiIcons(line) {
  let t = String(line || '').trim()
  const prefixes = ['✅', '❌', '📊', '🔢']
  let guard = 0
  while (guard < 10) {
    guard += 1
    let hit = false
    for (const p of prefixes) {
      if (t.startsWith(p)) {
        t = t.slice(p.length).trim()
        hit = true
        break
      }
    }
    if (!hit) break
  }
  return t
}

function AiFormattedLines({ text, splitSideBySide = true }) {
  const raw = text || ''

  if (splitSideBySide && raw.includes('✅') && raw.includes('❌')) {
    const idxCheck = raw.indexOf('✅')
    const idxCross = raw.indexOf('❌')
    if (idxCross > idxCheck) {
      const before = raw.slice(0, idxCheck).trim()
      const includedBlock = raw
        .slice(idxCheck, idxCross)
        .replace(/\n?\s*---\s*$/m, '')
        .trim()
      const afterCross = raw.slice(idxCross)
      const sepIdx = afterCross.indexOf('\n---\n')
      const chartIdx = afterCross.indexOf('📊')
      const bounds = [sepIdx, chartIdx].filter((x) => x >= 0)
      const endExcl = bounds.length ? Math.min(...bounds) : afterCross.length
      const excludedBlock = afterCross.slice(0, endExcl).trim()
      const after = afterCross.slice(endExcl).replace(/^\s*---\s*/m, '').trim()
      const countsIdx = after.indexOf('🔢')
      const countsBlock = countsIdx >= 0 ? after.slice(countsIdx).trim() : ''
      const afterWithoutCounts = countsIdx >= 0 ? after.slice(0, countsIdx).trim() : after

      return (
        <>
          {before ? <AiFormattedLines text={before} splitSideBySide={false} /> : null}
          <div className={countsBlock ? 'ai-three-col' : 'ai-two-col'}>
            <div className="ai-two-col-panel">
              <AiFormattedLines text={includedBlock} splitSideBySide={false} />
            </div>
            <div className="ai-two-col-panel">
              <AiFormattedLines text={excludedBlock} splitSideBySide={false} />
            </div>
            {countsBlock ? (
              <div className="ai-two-col-panel">
                <AiFormattedLines text={countsBlock} splitSideBySide={false} />
              </div>
            ) : null}
          </div>
          {afterWithoutCounts ? <AiFormattedLines text={afterWithoutCounts} splitSideBySide={false} /> : null}
        </>
      )
    }
  }

  const lines = raw.split('\n')
  const nodes = []
  let prevBlank = false

  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim()
    if (!trimmed) {
      // Collapse multiple blank lines to avoid oversized gaps.
      if (!prevBlank) nodes.push(<div key={`gap-${i}`} className="ai-line-gap" />)
      prevBlank = true
      continue
    }

    prevBlank = false
    if (trimmed.startsWith('✅')) {
      nodes.push(<h3 key={i} className="ai-heading ai-included">{stripLeadingAiIcons(trimmed)}</h3>)
      continue
    }
    if (trimmed.startsWith('❌')) {
      nodes.push(<h3 key={i} className="ai-heading ai-excluded">{stripLeadingAiIcons(trimmed)}</h3>)
      continue
    }
    if (trimmed.startsWith('📊')) {
      nodes.push(<h3 key={i} className="ai-heading ai-summary">{stripLeadingAiIcons(trimmed)}</h3>)
      continue
    }
    if (trimmed.startsWith('🔢')) {
      nodes.push(<p key={i} className="ai-text ai-counts-heading">{stripLeadingAiIcons(trimmed)}</p>)
      continue
    }
    if (trimmed.startsWith('---')) {
      nodes.push(<hr key={i} className="ai-divider" />)
      continue
    }
    if (trimmed.startsWith('-')) {
      nodes.push(<li key={i} className="ai-list-item">{trimmed.slice(1).trim()}</li>)
      continue
    }
    nodes.push(<p key={i} className="ai-text">{trimmed}</p>)
  }

  return <>{nodes}</>
}

function FixedAssetsTable({ result, riskRows = [], rowAiByType = {}, rowAiLoading, onAiForType }) {
  const { table = [], summary = {} } = result
  const [aiPanelCollapsed, setAiPanelCollapsed] = useState({})

  function toggleAiPanel(typeKey) {
    setAiPanelCollapsed((prev) => ({
      ...prev,
      [typeKey]: !prev[typeKey],
    }))
  }

  const fmt = (n) =>
    n ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'

  const listOrDash = (arr) => (arr && arr.length ? arr.join(', ') : '—')

  /** One line per distinct site: dedupe, merge short codes (LLI/SGI/SGL → org), KOGGALA 2 → KOGGALA. */
  function normalizedLocations(arr) {
    return collapseRedundantLocations(arr)
  }

  function escapeCsv(value) {
    const str = String(value ?? '')
    if (str.includes('"') || str.includes(',') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`
    }
    return str
  }

  function handleDownloadTable() {
    if (!table.length) return
    const headers = [
      'Type of Asset',
      'Total Value',
      'Operational Usage',
      'Locations',
      'Valuation Method',
      'Rows',
      'Applying risks',
    ]
    const rows = table.map((row) => [
      row.type,
      row.total_value,
      (row.operational_uses || []).join('\n'),
      normalizedLocations(row.locations).join('\n'),
      (row.valuation_methods || []).join(' | '),
      row.row_count,
      getApplyingRisksForAssetType(row.type, riskRows).join('; '),
    ])

    const csv = [
      headers.map(escapeCsv).join(','),
      ...rows.map((r) => r.map(escapeCsv).join(',')),
    ].join('\n')

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `fixed_assets_analysis_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="ed-result">
      {/* Summary cards */}
      <div className="fa-title-row">
        <h3 className="ed-result-title">
          Fixed Assets Analysis — {summary.sheet_name}
        </h3>
        <button className="btn-ed btn-ed-outline" onClick={handleDownloadTable}>
          Download Table (CSV)
        </button>
      </div>
      <p className="dash-welcome-sub" style={{ marginTop: 8, marginBottom: 0 }}>
        Use <strong>AI summary</strong> on each row to analyse operational usage for that asset type only (one AI request per click). Operational usage is hidden in this table but still used for AI; download CSV to see it.
        {' '}
        <strong>Applying risks</strong> lists Risk Table entries whose <em>When to apply</em> keywords match this asset type (comma-separated keywords).
        {' '}
        <strong>Locations</strong> are one numbered line per distinct site: exact duplicates removed, short codes like LLI/SGI/SGL under the same company collapse to one company line, and KOGGALA / KOGGALA 2 merge — so geocoding uses fewer API calls.
      </p>
      <div className="fa-summary-row">
        <div className="fa-summary-card">
          <span className="fa-summary-value">{summary.unique_types ?? 0}</span>
          <span className="fa-summary-label">Asset Types</span>
        </div>
        <div className="fa-summary-card">
          <span className="fa-summary-value">{summary.total_rows ?? 0}</span>
          <span className="fa-summary-label">Total Assets</span>
        </div>
        <div className="fa-summary-card">
          <span className="fa-summary-value">{fmt(summary.total_value)}</span>
          <span className="fa-summary-label">Total Value</span>
        </div>
      </div>

      {/* Table */}
      {table.length === 0 ? (
        <p className="dash-welcome-sub" style={{ marginTop: 16 }}>
          No asset data rows found. Make sure the file is filled in below the header row.
        </p>
      ) : (
        <div className="fa-table-wrap">
          <table className="fa-table">
            <thead>
              <tr>
                <th>Type of Asset</th>
                <th className="fa-num">Total Value</th>
                <th className="fa-loc-col">Locations</th>
                <th>Valuation Method</th>
                <th className="fa-num">Rows</th>
                <th className="fa-risks-col">Applying risks</th>
                <th className="fa-ai-col">AI summary</th>
              </tr>
            </thead>
            <tbody>
              {table.map((row, i) => {
                const typeKey = row.type
                const hasOps = Array.isArray(row.operational_uses) && row.operational_uses.length > 0
                const aiEntry = rowAiByType[typeKey]
                const showAiRow = rowAiLoading === typeKey || aiEntry?.ai_response || aiEntry?.error
                const applyingRisks = getApplyingRisksForAssetType(typeKey, riskRows)
                const aiBusy = rowAiLoading === typeKey
                const aiExpanded = aiBusy || !aiPanelCollapsed[typeKey]
                const locs = normalizedLocations(row.locations)
                return (
                  <Fragment key={`${typeKey}-${i}`}>
                    <tr>
                      <td className="fa-type">{row.type}</td>
                      <td className="fa-num">{fmt(row.total_value)}</td>
                      <td className="fa-location-cell">
                        {locs.length ? (
                          <ol className="fa-location-list" title="One address or site per line — use for geocoding">
                            {locs.map((loc, li) => (
                              <li key={`${typeKey}-loc-${li}`}>{loc}</li>
                            ))}
                          </ol>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>{listOrDash(row.valuation_methods)}</td>
                      <td className="fa-num">{row.row_count}</td>
                      <td className="fa-risks-cell">
                        {applyingRisks.length ? (
                          <ul className="fa-risks-list">
                            {applyingRisks.map((label) => (
                              <li key={label}>{label}</li>
                            ))}
                          </ul>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="fa-ai-cell">
                        <button
                          type="button"
                          className="btn-ai-row"
                          onClick={() => onAiForType(typeKey)}
                          disabled={!hasOps || rowAiLoading === typeKey}
                          title={!hasOps ? 'Add operational usage for this asset type first' : 'Summarise operational usage with AI'}
                        >
                          {rowAiLoading === typeKey ? (
                            <><span className="btn-spinner" /> Running…</>
                          ) : (
                            'AI'
                          )}
                        </button>
                      </td>
                    </tr>
                    {showAiRow ? (
                      <tr className="fa-ai-subrow">
                        <td colSpan={7}>
                          <div className="fa-ai-panel">
                            <div className="fa-ai-panel-toolbar">
                              <span className="fa-ai-panel-title">AI summary</span>
                              <button
                                type="button"
                                className="fa-ai-toggle"
                                onClick={() => toggleAiPanel(typeKey)}
                                disabled={aiBusy}
                                title={aiBusy ? 'Wait for generation to finish' : aiExpanded ? 'Hide summary' : 'Show summary'}
                              >
                                {aiExpanded ? '▼ Collapse' : '▶ Expand'}
                              </button>
                            </div>
                            {aiExpanded ? (
                              <>
                                {aiBusy && (
                                  <p className="fa-ai-status">Generating summary from operational usage…</p>
                                )}
                                {aiEntry?.error && (
                                  <div className="form-alert" style={{ marginBottom: 8 }}>{aiEntry.error}</div>
                                )}
                                {aiEntry?.ai_response && (
                                  <>
                                    <div className="fa-ai-meta">
                                      {aiEntry.model && (
                                        <span>Model: <strong>{aiEntry.model}</strong></span>
                                      )}
                                      {aiEntry.unique_uses_sent != null && (
                                        <span>Lines sent: <strong>{aiEntry.unique_uses_sent}</strong></span>
                                      )}
                                    </div>
                                    <div className="ai-result-body">
                                      <AiFormattedLines text={aiEntry.ai_response} />
                                    </div>
                                  </>
                                )}
                              </>
                            ) : (
                              aiEntry?.error ? (
                                <div className="form-alert" style={{ margin: 0 }}>{aiEntry.error}</div>
                              ) : null
                            )}
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                )
              })}
            </tbody>
            <tfoot>
              <tr>
                <td><strong>Total</strong></td>
                <td className="fa-num"><strong>{fmt(summary.total_value)}</strong></td>
                <td colSpan={2} />
                <td className="fa-num"><strong>{summary.total_rows}</strong></td>
                <td />
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
}
