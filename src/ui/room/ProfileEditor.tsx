// Editing one's own pronouns, status and time zone from the profile panel.
import { useId, useMemo, useState } from 'react'
import type { UserID } from '@/api/types'
import { cn } from '@/lib/cn'
import { PRONOUN_PRESETS, pronounsOf, saveOwnProfile, statusOf, timeZoneOf } from '@/store/profiles'
import { showToast } from '@/store/ui'
import { Spinner } from '@/ui/primitives'

/** MSC4426 caps status text at 256 bytes and suggests around 30 characters. */
const STATUS_TEXT_MAX_BYTES = 256
const STATUS_EMOJI_MAX_BYTES = 32
const bytes = (text: string) => new TextEncoder().encode(text).length

const splitPronouns = (value: string) =>
  value
    .split(',')
    .map(part => part.trim())
    .filter(Boolean)

const inputClass = 'w-full rounded-md border border-border bg-bg px-2 py-1.5 text-sm outline-none focus:border-accent/60'

function Field({ label, htmlFor, hint, children }: { label: string; htmlFor: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={htmlFor} className="text-xs font-medium text-muted">
        {label}
      </label>
      {children}
      {hint && <p className="text-[11px] text-muted">{hint}</p>}
    </div>
  )
}

export function ProfileEditor({ userID, profile, onDone }: { userID: UserID; profile: Record<string, unknown>; onDone: () => void }) {
  const id = useId()
  const status = statusOf(profile)
  const [pronouns, setPronouns] = useState(() => pronounsOf(profile).map(set => set.summary).join(', '))
  const [emoji, setEmoji] = useState(status?.emoji ?? '')
  const [text, setText] = useState(status?.text ?? '')
  const [timeZone, setTimeZone] = useState(timeZoneOf(profile) ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const zones = useMemo(() => Intl.supportedValuesOf('timeZone'), [])
  const deviceZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, [])
  const selected = splitPronouns(pronouns)

  const togglePreset = (summary: string) => {
    const next = selected.includes(summary) ? selected.filter(p => p !== summary) : [...selected, summary]
    setPronouns(next.join(', '))
  }

  const problem =
    bytes(text) > STATUS_TEXT_MAX_BYTES
      ? 'The status is too long.'
      : bytes(emoji) > STATUS_EMOJI_MAX_BYTES
        ? 'The status emoji is too long.'
        : timeZone.trim() && !zones.includes(timeZone.trim())
          ? `${timeZone.trim()} isn't a time zone this browser knows. Pick one from the list, e.g. Europe/Lisbon.`
          : null

  const save = async () => {
    if (problem) return
    setBusy(true)
    setError(null)
    try {
      await saveOwnProfile(userID, profile, { pronouns: selected, status: { emoji, text }, timeZone })
      showToast('Profile updated')
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      className="profile-editor flex flex-col gap-3 rounded-lg border border-border bg-surface-2/40 p-3"
      onSubmit={e => {
        e.preventDefault()
        void save()
      }}
      onKeyDown={e => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          onDone()
        }
      }}
    >
      <Field label="Pronouns" htmlFor={`${id}-pronouns`} hint="Separate several sets with commas, e.g. she/her, they/them.">
        <input id={`${id}-pronouns`} value={pronouns} onChange={e => setPronouns(e.target.value)} placeholder="None" className={inputClass} autoFocus />
        <div className="flex flex-wrap gap-1">
          {PRONOUN_PRESETS.map(preset => (
            <button
              key={preset.summary}
              type="button"
              onClick={() => togglePreset(preset.summary)}
              aria-pressed={selected.includes(preset.summary)}
              className={cn(
                'rounded-full px-2 py-0.5 text-xs transition-colors',
                selected.includes(preset.summary) ? 'bg-accent text-accent-fg' : 'bg-surface-2 text-muted hover:text-fg',
              )}
            >
              {preset.summary}
            </button>
          ))}
        </div>
      </Field>

      <Field label="Status" htmlFor={`${id}-status`} hint="Shown on your profile. Keep it short, around 30 characters.">
        <div className="flex gap-1.5">
          <input
            aria-label="Status emoji"
            value={emoji}
            onChange={e => setEmoji(e.target.value)}
            placeholder="🙂"
            className={cn(inputClass, 'w-12 shrink-0 text-center')}
          />
          <input
            id={`${id}-status`}
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="What are you up to?"
            className={inputClass}
          />
        </div>
        {(emoji || text) && (
          <button
            type="button"
            onClick={() => {
              setEmoji('')
              setText('')
            }}
            className="self-start text-xs text-muted hover:text-fg"
          >
            Clear status
          </button>
        )}
      </Field>

      <Field label="Time zone" htmlFor={`${id}-tz`} hint="Lets people see your local time.">
        <input
          id={`${id}-tz`}
          list={`${id}-zones`}
          value={timeZone}
          onChange={e => setTimeZone(e.target.value)}
          placeholder="Not shared"
          className={inputClass}
        />
        <datalist id={`${id}-zones`}>
          {zones.map(zone => (
            <option key={zone} value={zone} />
          ))}
        </datalist>
        <div className="flex gap-3">
          {deviceZone && timeZone !== deviceZone && (
            <button type="button" onClick={() => setTimeZone(deviceZone)} className="text-xs text-muted hover:text-fg">
              Use this device's ({deviceZone})
            </button>
          )}
          {timeZone && (
            <button type="button" onClick={() => setTimeZone('')} className="text-xs text-muted hover:text-fg">
              Don't share
            </button>
          )}
        </div>
      </Field>

      {(problem || error) && (
        <p className="text-xs text-danger" role="alert">
          {problem ?? `Couldn't save: ${error}`}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onDone} className="rounded-lg px-3 py-1.5 text-sm hover:bg-hover">
          Cancel
        </button>
        <button
          type="submit"
          disabled={busy || !!problem}
          className="flex items-center gap-2 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg transition hover:brightness-110 disabled:opacity-60"
        >
          {busy && <Spinner size={14} />} Save
        </button>
      </div>
    </form>
  )
}
