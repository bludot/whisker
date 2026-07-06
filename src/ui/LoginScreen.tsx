import { useState } from 'react'
import { backendUrl, setGuestMode, signIn, signUp } from '../collab/backend'

/** Email/password gate shown when a backend is configured but no one is
 *  signed in. Signup and signin against the same form; "continue as guest"
 *  keeps the configured server but uses device-only boards. */
export function LoginScreen() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const submit = async (kind: 'in' | 'up') => {
    if (!email || !password || busy) return
    setBusy(true)
    setNotice(null)
    try {
      const error = kind === 'in' ? await signIn(email, password) : await signUp(email, password)
      if (error) setNotice(error)
      else if (kind === 'up') setNotice('Account created. If nothing happens, check your email to confirm.')
      // On success onAuthStateChange re-renders App into the dashboard.
    } catch (e) {
      setNotice(String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="dashboard login-screen">
      <div className="login-card">
        <div className="login-title">
          <span className="dashboard-logo">🐈</span>
          <h1>Whisker</h1>
        </div>
        <div className="login-server">{backendUrl()}</div>
        <input
          className="login-input"
          type="email"
          placeholder="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          className="login-input"
          type="password"
          placeholder="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit('in')}
        />
        {notice && <div className="login-notice">{notice}</div>}
        <button className="new-board-btn" disabled={busy} onClick={() => submit('in')}>
          Sign in
        </button>
        <button className="login-alt" disabled={busy} onClick={() => submit('up')}>
          Create account
        </button>
        <button className="login-alt" onClick={() => setGuestMode(true)}>
          Continue as guest
        </button>
      </div>
    </div>
  )
}
