import { createContext, useContext, useState, useCallback, useEffect } from 'react'

const AuthContext = createContext(null)
const STORAGE_KEY = 'sgs_auth'
const SESSION_KEYS_TO_CLEAR_ON_LOGOUT = [
  'sgs_enter_data_state',
  'sgs_fixed_assets_geocode_cache',
  'sgs_fixed_assets_geocode_selected',
]

function loadAuth() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function AuthProvider({ children }) {
  const [auth, setAuth] = useState(loadAuth)

  useEffect(() => {
    if (auth?.accessToken) return
    for (const key of SESSION_KEYS_TO_CLEAR_ON_LOGOUT) {
      sessionStorage.removeItem(key)
    }
  }, [auth?.accessToken])

  const login = useCallback((data) => {
    const payload = {
      user: data.user,
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
    setAuth(payload)
  }, [])

  const logout = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY)
    setAuth(null)
  }, [])

  return (
    <AuthContext.Provider
      value={{
        user: auth?.user ?? null,
        token: auth?.accessToken ?? null,
        isAuthenticated: !!auth?.accessToken,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
