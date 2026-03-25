import { createContext, useContext, useState, useCallback } from 'react'

const AuthContext = createContext(null)
const STORAGE_KEY = 'sgs_auth'

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
