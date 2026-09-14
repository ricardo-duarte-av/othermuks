import { Server } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { showBackendPicker, signIn, useSession } from '@/store/session'
import { Spinner } from './primitives'

export function BrandMark() {
  return (
    <div
      className="size-12 rounded-2xl shadow-lg"
      style={{ background: 'linear-gradient(135deg, var(--accent), var(--user-color-6))' }}
      aria-hidden
    />
  )
}

export const inputClass =
  'h-10 w-full rounded-lg border border-border bg-bg px-3 text-sm outline-none transition-colors placeholder:text-muted focus:border-accent'

export const primaryButtonClass =
  'flex h-10 items-center justify-center gap-2 rounded-lg bg-accent font-medium text-accent-fg transition hover:brightness-110 disabled:opacity-60'

export function LoginScreen() {
  const { sessionError, backendURL, rememberedUsername } = useSession(
    useShallow(s => ({ sessionError: s.error, backendURL: s.backendURL, rememberedUsername: s.rememberedUsername })),
  )
  const [username, setUsername] = useState(rememberedUsername)
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const host = backendURL ? new URL(backendURL).host : location.host

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await signIn(username, password, remember)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  const shownError = error ?? sessionError

  return (
    <div className="grid h-full place-items-center overflow-y-auto p-4">
      <form onSubmit={submit} className="login-card flex w-full max-w-sm flex-col gap-4 rounded-2xl border border-border bg-surface p-8 shadow-2xl">
        <BrandMark />
        <div>
          <h1 className="text-xl font-semibold">Sign in to gomuks</h1>
          <p className="mt-1 text-sm text-muted">Use the credentials of your gomuks backend, not your Matrix account.</p>
        </div>
        <div className="flex items-center gap-2 rounded-lg bg-bg px-3 py-2 text-sm">
          <Server size={15} className="shrink-0 text-muted" />
          <span className="min-w-0 flex-1 truncate font-medium">{host}</span>
          {!backendURL && <span className="shrink-0 text-xs text-muted">this site</span>}
          <button type="button" onClick={showBackendPicker} className="shrink-0 text-xs font-medium text-accent hover:underline">
            Change
          </button>
        </div>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Username
          <input className={inputClass} value={username} onChange={e => setUsername(e.target.value)} autoComplete="username" autoFocus={!username} required />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Password
          <input
            className={inputClass}
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            autoComplete="current-password"
            autoFocus={!!username}
            required
          />
        </label>
        {backendURL && (
          <label className="flex items-start gap-2.5 text-sm">
            <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} className="mt-0.5 size-4 accent-[var(--accent)]" />
            <span>
              Remember password on this device
              <span className="block text-xs text-muted">
                This backend is on another site, so every request is authenticated with your password. Otherwise it's kept only until you close this tab.
              </span>
            </span>
          </label>
        )}
        {shownError && (
          <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">
            {shownError}
          </p>
        )}
        <button type="submit" disabled={busy} className={primaryButtonClass}>
          {busy && <Spinner size={16} />}
          Sign in
        </button>
      </form>
    </div>
  )
}

export function Splash({ message = 'Connecting to gomuks…' }: { message?: string }) {
  return (
    <div className="grid h-full place-items-center">
      <div className="flex flex-col items-center gap-4 text-sm text-muted">
        <BrandMark />
        <span className="flex items-center gap-2">
          <Spinner size={14} /> {message}
        </span>
      </div>
    </div>
  )
}

export function ErrorScreen({ error }: { error: string | null }) {
  return (
    <div className="grid h-full place-items-center p-4">
      <div className="max-w-md rounded-2xl border border-border bg-surface p-6 text-sm">
        <h1 className="mb-2 text-lg font-semibold">Can't reach gomuks</h1>
        <p className="text-muted">{error}</p>
        <div className="mt-4 flex gap-2">
          <button className="rounded-lg bg-accent px-4 py-2 font-medium text-accent-fg" onClick={() => location.reload()}>
            Retry
          </button>
          <button className="rounded-lg px-4 py-2 font-medium hover:bg-hover" onClick={showBackendPicker}>
            Use another backend
          </button>
        </div>
      </div>
    </div>
  )
}
