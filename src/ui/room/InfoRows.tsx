// The labelled rows the room info panel and the invite screen list a room's details in.
import { Copy } from 'lucide-react'
import type { ReactNode } from 'react'
import { showToast } from '@/store/ui'

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err))

export const JOIN_RULES: Record<string, string> = {
  public: 'Anyone can join',
  invite: 'Invite only',
  knock: 'Anyone can ask to join',
  restricted: 'Members of allowed rooms',
  knock_restricted: 'Members of allowed rooms, or ask to join',
  private: 'Private',
}

export async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text)
    showToast(`${what} copied`)
  } catch (err) {
    showToast(`Couldn't copy: ${errorText(err)}`)
  }
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">{title}</h3>
      <dl className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">{children}</dl>
    </section>
  )
}

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="px-3 py-2">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 min-w-0 break-words">{children}</dd>
    </div>
  )
}

export const None = ({ children }: { children: ReactNode }) => <span className="text-muted">{children}</span>

export const Mono = ({ children, className }: { children: ReactNode; className?: string }) => (
  <span className={`font-mono text-[13px] ${className ?? ''}`}>{children}</span>
)

/** A value shown in full (IDs are long; wrapping beats truncating something people copy), copied on click. */
export function Copyable({ value, what }: { value: string; what: string }) {
  return (
    <button
      type="button"
      onClick={() => void copy(value, what)}
      title={`Copy ${what.toLowerCase()}`}
      className="group/copy flex w-full items-start gap-1.5 text-left"
    >
      <span className="min-w-0 flex-1 break-all font-mono text-[13px]">{value}</span>
      <Copy size={13} className="mt-0.5 shrink-0 text-muted opacity-0 transition-opacity group-hover/copy:opacity-100" />
    </button>
  )
}
