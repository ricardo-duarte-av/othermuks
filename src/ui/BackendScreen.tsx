import { Copy, Server } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { CORS_SNIPPET, probeBackend, type ProbeFailure } from '@/api/backend'
import { chooseBackend, useSession, useThisSiteBackend } from '@/store/session'
import { BrandMark, inputClass, primaryButtonClass } from './LoginScreen'
import { Spinner } from './primitives'

function hostOf(baseURL?: string) {
  try {
    return baseURL ? new URL(baseURL).host : 'The backend'
  } catch {
    return 'The backend'
  }
}

function Snippet() {
  const [copied, setCopied] = useState(false)
  return (
    <div className="relative">
      <pre className="max-h-64 overflow-auto rounded-lg border border-border bg-[var(--code-bg)] p-3 font-mono text-[11px] leading-relaxed">
        {CORS_SNIPPET}
      </pre>
      <button
        type="button"
        onClick={() =>
          navigator.clipboard.writeText(CORS_SNIPPET).then(
            () => setCopied(true),
            () => setCopied(false),
          )
        }
        className="absolute right-2 top-2 flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-1 text-xs text-muted hover:text-fg"
      >
        <Copy size={12} /> {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}

function FailureExplanation({ failure }: { failure: ProbeFailure }) {
  const host = hostOf(failure.baseURL)
  switch (failure.reason) {
    case 'invalid-url':
      return <p>That doesn't look like a web address. Try something like https://gomuks.example.com.</p>
    case 'insecure':
      return <p>This page is served over HTTPS, so the browser won't connect to an http:// backend. Use its https:// address.</p>
    case 'unreachable':
      return <p>Couldn't reach {host}. Check the address and that the backend is online.</p>
    case 'not-gomuks':
      return (
        <p>
          {host} answered, but not like a gomuks backend{failure.detail ? ` (${failure.detail})` : ''}. Check the address.
        </p>
      )
    case 'cors':
    case 'preflight':
      return (
        <div className="flex flex-col gap-2">
          <p>
            {failure.reason === 'cors'
              ? `${host} is reachable, but it doesn't allow web clients hosted on other sites.`
              : `${host} allows simple requests, but rejects the browser's pre-check (OPTIONS) for signed-in requests.`}{' '}
            Whoever runs it needs to add CORS to its reverse proxy, for example with nginx:
          </p>
          <Snippet />
        </div>
      )
  }
}

export function BackendScreen() {
  const storedURL = useSession(s => s.backendURL)
  const sameOriginAvailable = useSession(s => s.sameOriginAvailable)
  const sessionError = useSession(s => s.error)
  const [address, setAddress] = useState(storedURL ?? '')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<ProbeFailure | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setFailure(null)
    const result = await probeBackend(address)
    setBusy(false)
    if (result.ok) chooseBackend(result)
    else setFailure(result)
  }

  return (
    <div className="grid h-full place-items-center overflow-y-auto p-4">
      <form onSubmit={submit} className="backend-card flex w-full max-w-lg flex-col gap-4 rounded-2xl border border-border bg-surface p-8 shadow-2xl">
        <BrandMark />
        <div>
          <h1 className="text-xl font-semibold">Connect to a gomuks backend</h1>
          <p className="mt-1 text-sm text-muted">
            Enter the address of the gomuks backend you want to use. Your browser connects to it directly.
          </p>
        </div>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Backend address
          <input
            className={inputClass}
            value={address}
            onChange={e => setAddress(e.target.value)}
            placeholder="https://gomuks.example.com"
            inputMode="url"
            autoComplete="url"
            autoFocus
            required
          />
        </label>
        {(failure || sessionError) && (
          <div className="rounded-lg bg-danger/10 px-3 py-2.5 text-sm text-fg" role="alert">
            {failure ? <FailureExplanation failure={failure} /> : sessionError}
          </div>
        )}
        <button type="submit" disabled={busy} className={primaryButtonClass}>
          {busy && <Spinner size={16} />}
          {busy ? 'Checking backend…' : 'Continue'}
        </button>
        {sameOriginAvailable && (
          <button
            type="button"
            onClick={() => void useThisSiteBackend()}
            className="flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm text-muted transition-colors hover:bg-hover hover:text-fg"
          >
            <Server size={15} /> Use this site's gomuks ({location.host})
          </button>
        )}
      </form>
    </div>
  )
}
