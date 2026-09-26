import { useState } from 'react'
import { api } from './api.js'

export default function Login({ onSignedIn }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      onSignedIn(await api('/api/login', { method: 'POST', body: JSON.stringify({ email, password }) }))
    } catch (err) {
      setError(err.message || 'could not sign in')
      setPassword('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login">
      <form onSubmit={submit}>
        <div className="icon">✅</div>
        <h1>Weekly Checklist</h1>
        <p className="intro">Private. Two accounts only.</p>

        <label htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoFocus
        />

        <label htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        <button type="submit" disabled={busy || !email || !password}>
          {busy ? 'Checking…' : 'Sign in'}
        </button>
        <p className="hint">You stay signed in on this device until you sign out.</p>
      </form>
    </div>
  )
}
