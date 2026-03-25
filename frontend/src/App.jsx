import { useEffect, useState } from 'react'
import './App.css'

function App() {
  const [apiStatus, setApiStatus] = useState('Checking backend...')

  useEffect(() => {
    const checkBackend = async () => {
      try {
        const baseUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000'
        const response = await fetch(`${baseUrl}/api/health`)

        if (!response.ok) {
          throw new Error('Health check failed')
        }

        const data = await response.json()
        setApiStatus(`Backend: ${data.status}`)
      } catch {
        setApiStatus('Backend: unreachable')
      }
    }

    checkBackend()
  }, [])

  return (
    <main className="app-shell">
      <section className="hero-card">
        <p className="badge">SGS</p>
        <h1>sgs-audit-project</h1>
        <p className="subtitle">Frontend: React + Vite | Backend: Flask</p>

        <div className="status-row">
          <span className="status-label">System status</span>
          <span className="status-value">{apiStatus}</span>
        </div>

        <div className="actions">
          <a href="http://localhost:5000/api/health" target="_blank" rel="noreferrer">
            Open API health
          </a>
          <a href="http://localhost:5000" target="_blank" rel="noreferrer">
            Open backend root
          </a>
        </div>
      </section>
    </main>
  )
}

export default App
