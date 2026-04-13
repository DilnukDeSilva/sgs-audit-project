import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'
import DashboardPage from './pages/DashboardPage'
import EnterDataPage from './pages/EnterDataPage'
import RiskTablePage from './pages/RiskTablePage'
import WeatherLocationPage from './pages/WeatherLocationPage'
import DisastersLocationPage from './pages/DisastersLocationPage'
import DisastersHistoryPage from './pages/DisastersHistoryPage'
import './App.css'

function ProtectedRoute({ children }) {
  const { isAuthenticated } = useAuth()
  return isAuthenticated ? children : <Navigate to="/login" replace />
}

function PublicRoute({ children }) {
  const { isAuthenticated } = useAuth()
  return isAuthenticated ? <Navigate to="/dashboard" replace /> : children
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Navigate to="/login" replace />} />
          <Route
            path="/login"
            element={<PublicRoute><LoginPage /></PublicRoute>}
          />
          <Route
            path="/register"
            element={<PublicRoute><RegisterPage /></PublicRoute>}
          />
          <Route
            path="/dashboard"
            element={<ProtectedRoute><DashboardPage /></ProtectedRoute>}
          />
          <Route
            path="/enter-data"
            element={<ProtectedRoute><EnterDataPage /></ProtectedRoute>}
          />
          <Route
            path="/risk-table"
            element={<ProtectedRoute><RiskTablePage /></ProtectedRoute>}
          />
          <Route
            path="/weather"
            element={<ProtectedRoute><WeatherLocationPage /></ProtectedRoute>}
          />
          <Route
            path="/disasters"
            element={<ProtectedRoute><DisastersLocationPage /></ProtectedRoute>}
          />
          <Route
            path="/disasters-history"
            element={<ProtectedRoute><DisastersHistoryPage /></ProtectedRoute>}
          />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
