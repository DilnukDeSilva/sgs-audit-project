import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { registerUser } from '../api/auth'
import { useAuth } from '../context/AuthContext'

export default function RegisterPage() {
  const navigate = useNavigate()
  const { login } = useAuth()

  const [form, setForm] = useState({ username: '', email: '', password: '' })
  const [fieldErrors, setFieldErrors] = useState({})
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  function handleChange(e) {
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }))
    setFieldErrors((fe) => ({ ...fe, [e.target.name]: '' }))
    setError('')
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    setError('')
    setFieldErrors({})
    try {
      const data = await registerUser(form)
      login(data)
      navigate('/dashboard', { replace: true })
    } catch (err) {
      if (err.errors && Object.keys(err.errors).length) {
        setFieldErrors(err.errors)
      } else {
        setError(err.message || 'Registration failed. Please try again.')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-brand">
          <span className="badge">IM-PACT-A</span>
          <h1 className="auth-title">Create an account</h1>
          <p className="auth-subtitle">Get started with IM-PACT-A Audit today</p>
        </div>

        <form className="auth-form" onSubmit={handleSubmit} noValidate>
          {error && <div className="form-alert">{error}</div>}

          <div className="form-group">
            <label className="form-label" htmlFor="username">Username</label>
            <input
              id="username"
              name="username"
              type="text"
              className={`form-input${fieldErrors.username ? ' input-error' : ''}`}
              placeholder="johndoe"
              value={form.username}
              onChange={handleChange}
              required
              autoComplete="username"
            />
            {fieldErrors.username && (
              <span className="field-error">{fieldErrors.username}</span>
            )}
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="email">Email</label>
            <input
              id="email"
              name="email"
              type="email"
              className={`form-input${fieldErrors.email ? ' input-error' : ''}`}
              placeholder="you@example.com"
              value={form.email}
              onChange={handleChange}
              required
              autoComplete="email"
            />
            {fieldErrors.email && (
              <span className="field-error">{fieldErrors.email}</span>
            )}
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="password">Password</label>
            <input
              id="password"
              name="password"
              type="password"
              className={`form-input${fieldErrors.password ? ' input-error' : ''}`}
              placeholder="Min. 8 characters"
              value={form.password}
              onChange={handleChange}
              required
              autoComplete="new-password"
            />
            {fieldErrors.password && (
              <span className="field-error">{fieldErrors.password}</span>
            )}
          </div>

          <button className="btn-primary" type="submit" disabled={loading}>
            {loading ? <span className="btn-spinner" /> : 'Create account'}
          </button>
        </form>

        <p className="auth-footer">
          Already have an account?{' '}
          <Link className="auth-link" to="/login">Sign in</Link>
        </p>
      </div>
    </div>
  )
}
