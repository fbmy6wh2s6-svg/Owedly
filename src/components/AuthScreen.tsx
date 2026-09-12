import { FormEvent, useState } from 'react'
import { supabase } from '../lib/supabase'

export default function AuthScreen() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setMessage('')

    const result = mode === 'signin'
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password })

    if (result.error) setMessage(result.error.message)
    else if (mode === 'signup' && !result.data.session) {
      setMessage('Check your email to confirm your Owedly account.')
    }

    setBusy(false)
  }

  return (
    <main className="auth-page">
      <section className="auth-hero">
        <div className="logo-mark">O</div>
        <div className="brand-word">Owedly</div>
        <h1>Run your business by talking to it.</h1>
        <p>Your AI office manager for customers, jobs, estimates, invoices, payments and follow-up.</p>
        <div className="voice-example">“Create an invoice for Bob Smith for $1,450 due in 15 days.”</div>
      </section>
      <section className="auth-card">
        <div>
          <p className="eyebrow">Welcome to Owedly</p>
          <h2>{mode === 'signin' ? 'Sign in' : 'Create your account'}</h2>
        </div>
        <form onSubmit={submit}>
          <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required /></label>
          <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} minLength={8} required /></label>
          <button className="primary-button" disabled={busy}>{busy ? 'Working…' : mode === 'signin' ? 'Sign in' : 'Create account'}</button>
        </form>
        {message && <p className="form-message">{message}</p>}
        <button className="text-button" onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setMessage('') }}>
          {mode === 'signin' ? 'New to Owedly? Create an account' : 'Already have an account? Sign in'}
        </button>
      </section>
    </main>
  )
}
