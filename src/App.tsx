import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import { getCurrentBusiness, type CurrentBusiness } from './lib/business'
import AuthScreen from './components/AuthScreen'
import BusinessOnboarding from './components/BusinessOnboarding'
import AppShell from './components/AppShell'

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [business, setBusiness] = useState<CurrentBusiness | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true

    async function hydrate(nextSession: Session | null) {
      if (!active) return
      setSession(nextSession)
      setError('')
      if (!nextSession) {
        setBusiness(null)
        setLoading(false)
        return
      }
      try {
        setBusiness(await getCurrentBusiness())
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unable to load your Owedly workspace')
      } finally {
        if (active) setLoading(false)
      }
    }

    supabase.auth.getSession().then(({ data }) => hydrate(data.session))
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => hydrate(nextSession))

    return () => {
      active = false
      data.subscription.unsubscribe()
    }
  }, [])

  if (loading) return <main className="loading-page"><div className="logo-mark">O</div><p>Opening Owedly…</p></main>
  if (!session) return <AuthScreen />
  if (error) return <main className="loading-page"><div className="logo-mark">O</div><h2>We couldn’t open your workspace.</h2><p>{error}</p><button className="secondary-button" onClick={() => location.reload()}>Try again</button></main>
  if (!business) return <BusinessOnboarding onCreated={setBusiness} />
  return <AppShell business={business} />
}
