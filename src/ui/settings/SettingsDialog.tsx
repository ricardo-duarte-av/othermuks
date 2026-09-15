import * as Dialog from '@radix-ui/react-dialog'
import { Cloud, Hash, Monitor, Palette, Search, X, type LucideIcon } from 'lucide-react'
import { Fragment, useEffect, useState, type ReactNode } from 'react'
import type { RoomID } from '@/api/types'
import { cn } from '@/lib/cn'
import { useChat } from '@/store/chat'
import {
  isValidValue,
  PREFERENCES_EVENT_TYPE,
  PreferenceContext,
  preferences,
  scopeValues,
  setPreference,
  useLocalPrefs,
  type Preference,
  type PreferenceGroup,
  type PreferenceKey,
  type PreferenceValue,
} from '@/store/preferences'
import { closeSettings, showToast, useUI } from '@/store/ui'
import { pushDeviceID, useWebPush, type WebPushStatus } from '@/store/webpush'
import { Spinner } from '@/ui/primitives'

interface Column {
  context: PreferenceContext
  label: string
  hint: string
  icons: LucideIcon[]
  room: boolean
}

/** Least to most specific, left to right; a value set further right overrides the ones to its left. */
const COLUMNS: Column[] = [
  { context: PreferenceContext.Account, label: 'Account', hint: 'Synced to all your clients, gomuks web included', icons: [Cloud], room: false },
  { context: PreferenceContext.Device, label: 'This device', hint: 'Only in this browser', icons: [Monitor], room: false },
  { context: PreferenceContext.RoomAccount, label: 'Room', hint: 'Only this room, synced to all your clients', icons: [Hash, Cloud], room: true },
  { context: PreferenceContext.RoomDevice, label: 'Room · device', hint: 'Only this room, only in this browser', icons: [Hash, Monitor], room: true },
]

const GROUPS: PreferenceGroup[] = ['Privacy', 'Timeline', 'Media', 'Composer', 'Code', 'Room list', 'Widgets', 'Notifications']

const PUSH_STATUS_TEXT: Record<WebPushStatus, string> = {
  unsupported: "This browser can't receive web push here: it needs HTTPS and service worker and push support.",
  off: 'Not registered for push in this browser.',
  working: 'Updating the push registration…',
  on: 'This browser is registered with gomuks for push notifications.',
  blocked: 'Notifications are blocked for this site.',
  error: 'Push registration failed.',
}

function WebPushStatusRow({ columns }: { columns: number }) {
  const { status, detail } = useWebPush()
  return (
    <div role="row" className="contents">
      <div
        role="cell"
        className="flex items-center gap-2 border-b border-border/60 py-2 text-xs text-muted"
        style={{ gridColumn: `1 / span ${columns + 1}` }}
        title={`Push device ID for this browser: ${pushDeviceID()}`}
        data-status={status}
      >
        {status === 'working' ? (
          <Spinner size={12} />
        ) : (
          <span
            aria-hidden
            className={cn(
              'size-2 shrink-0 rounded-full',
              status === 'on' ? 'bg-success' : status === 'blocked' || status === 'error' ? 'bg-danger' : 'bg-border',
            )}
          />
        )}
        <span className={cn((status === 'blocked' || status === 'error') && 'text-danger')}>{detail ?? PUSH_STATUS_TEXT[status]}</span>
      </div>
    </div>
  )
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err))

export function SettingsDialog() {
  const settings = useUI(s => s.settings)
  return (
    <Dialog.Root open={!!settings} onOpenChange={open => !open && closeSettings()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[2px]" />
        <Dialog.Content
          aria-describedby={undefined}
          className="settings-dialog fixed left-1/2 top-1/2 z-50 flex h-[min(820px,90vh)] w-[min(1040px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-border bg-surface text-fg shadow-2xl outline-none"
        >
          {settings && <SettingsBody initialRoomID={settings.roomID} />}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function SettingsBody({ initialRoomID }: { initialRoomID: RoomID | null }) {
  const activeRoomID = useUI(s => s.activeRoomID)
  const roomChoice = initialRoomID ?? activeRoomID
  const [roomID, setRoomID] = useState<RoomID | null>(initialRoomID)
  const roomName = useChat(s => (roomChoice ? (s.rooms[roomChoice]?.meta.name ?? roomChoice) : undefined))
  const [query, setQuery] = useState('')
  const [changedOnly, setChangedOnly] = useState(false)

  // Subscriptions that re-render the table when a scope changes; values are read below.
  useChat(s => s.accountData[PREFERENCES_EVENT_TYPE])
  useChat(s => (roomID ? s.rooms[roomID]?.accountData[PREFERENCES_EVENT_TYPE] : undefined))
  const local = useLocalPrefs()
  const chat = useChat.getState()

  const columns = COLUMNS.filter(column => roomID || !column.room)
  const values = new Map(columns.map(column => [column.context, scopeValues(column.context, chat, local, roomID)]))

  const needle = query.trim().toLowerCase()
  const entries = (Object.entries(preferences) as [PreferenceKey, Preference][]).filter(([key, pref]) => {
    if (needle && ![key, pref.displayName, pref.description].some(text => text.toLowerCase().includes(needle))) return false
    if (changedOnly && !columns.some(column => values.get(column.context)?.[key] !== undefined)) return false
    return true
  })

  return (
    <>
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border px-4 py-3">
        <Dialog.Title className="text-sm font-semibold">Settings</Dialog.Title>
        {roomChoice && (
          <div role="tablist" aria-label="Scope" className="flex min-w-0 gap-1 rounded-lg bg-bg p-0.5">
            <ScopeTab selected={!roomID} onClick={() => setRoomID(null)}>
              Global
            </ScopeTab>
            <ScopeTab selected={!!roomID} onClick={() => setRoomID(roomChoice)}>
              <Hash size={12} className="shrink-0" />
              <span className="max-w-48 truncate">{roomName}</span>
            </ScopeTab>
          </div>
        )}
        <button
          type="button"
          onClick={() => {
            closeSettings()
            useUI.setState({ appearanceOpen: true })
          }}
          className="ml-auto flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted transition-colors hover:bg-hover hover:text-fg"
        >
          <Palette size={14} /> Appearance…
        </button>
        <Dialog.Close aria-label="Close" className="rounded-md p-1 text-muted hover:bg-hover hover:text-fg">
          <X size={16} />
        </Dialog.Close>
      </header>

      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-4 py-2.5">
        <label className="flex h-8 min-w-48 flex-1 items-center gap-2 rounded-lg border border-border bg-bg px-2.5 text-sm focus-within:border-accent">
          <Search size={14} className="shrink-0 text-muted" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Filter settings"
            className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted"
          />
        </label>
        <label className="flex items-center gap-2 text-xs text-muted">
          <Switch checked={changedOnly} onChange={setChangedOnly} label="Only changed settings" />
          Only changed
        </label>
      </div>

      <p className="shrink-0 px-4 pt-3 text-xs text-muted">
        The most specific value wins: {roomID ? 'room · device, then room, then ' : ''}this device, then account, then the default. Dimmed
        values are inherited; click ✕ to clear a value. Settings are shared with gomuks web.
      </p>

      <div className="min-h-0 flex-1 overflow-auto px-4 pb-4 pt-2">
        <div
          role="table"
          aria-label="Preferences"
          className="settings-table grid min-w-fit items-stretch text-sm"
          style={{ gridTemplateColumns: `minmax(220px, 1fr) repeat(${columns.length}, minmax(118px, 150px))` }}
        >
          <div role="row" className="contents">
            <div role="columnheader" className="sticky left-0 top-0 z-20 bg-surface" />
            {columns.map(column => (
              <div
                key={column.context}
                role="columnheader"
                title={column.hint}
                className="sticky top-0 z-10 flex flex-col items-center gap-0.5 border-b border-border bg-surface px-2 pb-2 pt-1 text-center"
              >
                <span className="flex items-center gap-1 text-muted">
                  {column.icons.map((Icon, i) => (
                    <Icon key={i} size={13} />
                  ))}
                </span>
                <span className="text-xs font-semibold">{column.label}</span>
                <span className="text-[10px] leading-tight text-muted">{column.hint}</span>
              </div>
            ))}
          </div>

          {GROUPS.map(group => {
            const rows = entries.filter(([, pref]) => pref.group === group)
            if (!rows.length) return null
            return (
              <Fragment key={group}>
                <div role="row" className="contents">
                  <div
                    role="rowheader"
                    className="sticky left-0 col-span-full pb-1 pt-5 text-[11px] font-semibold uppercase tracking-wide text-muted"
                  >
                    {group}
                  </div>
                </div>
                {rows.map(([key, pref]) => (
                  <PreferenceRow key={key} prefKey={key} pref={pref} columns={columns} values={values} roomID={roomID} />
                ))}
                {group === 'Notifications' && <WebPushStatusRow columns={columns.length} />}
              </Fragment>
            )
          })}
          {!entries.length && <p className="col-span-full py-10 text-center text-sm text-muted">No settings match</p>}
        </div>
      </div>
    </>
  )
}

function ScopeTab({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={onClick}
      className={cn(
        'flex min-w-0 items-center gap-1 rounded-md px-3 py-1 text-xs font-medium transition-colors',
        selected ? 'bg-surface-2 text-fg' : 'text-muted hover:text-fg',
      )}
    >
      {children}
    </button>
  )
}

interface RowProps {
  prefKey: PreferenceKey
  pref: Preference
  columns: Column[]
  values: Map<PreferenceContext, Record<string, unknown>>
  roomID: RoomID | null
}

function PreferenceRow({ prefKey, pref, columns, values, roomID }: RowProps) {
  const valid = (context: PreferenceContext) => {
    if (!pref.allowedContexts.includes(context)) return undefined
    const value = values.get(context)?.[prefKey]
    return value !== undefined && isValidValue(prefKey, value) ? value : undefined
  }
  // The column whose value is in effect: the right-most one with a value.
  const winner = [...columns].reverse().find(column => valid(column.context) !== undefined)?.context

  let inherited: PreferenceValue = pref.defaultValue
  return (
    <div role="row" className="settings-row group contents">
      <div role="rowheader" className="sticky left-0 z-[1] border-b border-border/60 bg-surface py-2.5 pr-4 group-hover:bg-hover/40">
        <div className="font-medium" title={prefKey}>
          {pref.displayName}
        </div>
        <div className="mt-0.5 text-xs leading-snug text-muted">{pref.description}</div>
      </div>
      {columns.map(column => {
        const value = valid(column.context)
        const cell = (
          <PreferenceCell
            key={column.context}
            prefKey={prefKey}
            pref={pref}
            context={column.context}
            label={column.label}
            value={value}
            inherited={inherited}
            winning={winner === column.context}
            roomID={roomID}
          />
        )
        if (value !== undefined) inherited = value
        return cell
      })}
    </div>
  )
}

interface CellProps {
  prefKey: PreferenceKey
  pref: Preference
  context: PreferenceContext
  label: string
  value: PreferenceValue | undefined
  inherited: PreferenceValue
  winning: boolean
  roomID: RoomID | null
}

function PreferenceCell({ prefKey, pref, context, label, value, inherited, winning, roomID }: CellProps) {
  const [busy, setBusy] = useState(false)
  const cellClass = 'flex items-center justify-center gap-1 border-b border-border/60 px-2 py-2 group-hover:bg-hover/40'

  if (!pref.allowedContexts.includes(context)) {
    return (
      <div role="cell" className={cn(cellClass, 'text-muted/50')} title={`${pref.displayName} can't be set per ${label.toLowerCase()}`}>
        —
      </div>
    )
  }

  const save = async (next: PreferenceValue | undefined) => {
    setBusy(true)
    try {
      await setPreference(context, prefKey, next, roomID)
    } catch (err) {
      showToast(`Couldn't save “${pref.displayName}”: ${errorText(err)}`)
    } finally {
      setBusy(false)
    }
  }

  const set = value !== undefined
  const shown = value ?? inherited
  const controlLabel = `${pref.displayName} (${label})`
  let control: ReactNode
  if (typeof pref.defaultValue === 'boolean') {
    control = <Switch checked={shown as boolean} onChange={checked => void save(checked)} label={controlLabel} dim={!set} disabled={busy} />
  } else if (pref.allowedValues) {
    control = (
      <select
        aria-label={controlLabel}
        value={String(shown)}
        disabled={busy}
        onChange={e => void save(e.target.value)}
        className={cn(
          'h-7 w-full min-w-0 rounded-md border bg-bg px-1.5 text-xs outline-none focus:border-accent',
          set ? 'border-border text-fg' : 'border-dashed border-border text-muted',
        )}
      >
        {pref.allowedValues.map((option, i) => (
          <option key={String(option)} value={String(option)}>
            {pref.valueLabels?.[i] ?? String(option)}
          </option>
        ))}
      </select>
    )
  } else if (typeof pref.defaultValue === 'number') {
    control = <NumberInput pref={pref} shown={shown as number} set={set} label={controlLabel} onCommit={n => void save(n)} disabled={busy} />
  } else if (typeof pref.defaultValue === 'string') {
    // An empty value clears the setting here, so the inherited value (or the default) applies.
    control = <TextInput shown={shown as string} set={set} label={controlLabel} onCommit={text => void save(text || undefined)} disabled={busy} />
  }

  return (
    <div role="cell" data-winning={winning || undefined} className={cn(cellClass, winning && 'bg-accent/[0.07]')}>
      {control}
      <span className="grid w-4 shrink-0 place-items-center">
        {busy ? (
          <Spinner size={12} className="text-muted" />
        ) : (
          set && (
            <button
              type="button"
              onClick={() => void save(undefined)}
              title={`Clear (inherit ${String(inherited)})`}
              aria-label={`Clear ${controlLabel}`}
              className="rounded text-muted hover:text-fg"
            >
              <X size={13} />
            </button>
          )
        )}
      </span>
    </div>
  )
}

function TextInput({
  shown,
  set,
  label,
  onCommit,
  disabled,
}: {
  shown: string
  set: boolean
  label: string
  onCommit: (value: string) => void
  disabled?: boolean
}) {
  const [draft, setDraft] = useState(shown)
  useEffect(() => setDraft(shown), [shown])

  const commit = () => {
    const value = draft.trim()
    if (value !== shown) onCommit(value)
  }

  return (
    <input
      type="text"
      aria-label={label}
      title={draft || undefined}
      value={draft}
      placeholder={set ? undefined : 'Default'}
      disabled={disabled}
      spellCheck={false}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => e.key === 'Enter' && commit()}
      className={cn(
        'h-7 w-full min-w-0 rounded-md border bg-bg px-1.5 text-xs outline-none placeholder:text-muted focus:border-accent',
        set ? 'border-border text-fg' : 'border-dashed border-border text-muted',
      )}
    />
  )
}

function NumberInput({
  pref,
  shown,
  set,
  label,
  onCommit,
  disabled,
}: {
  pref: Preference
  shown: number
  set: boolean
  label: string
  onCommit: (value: number) => void
  disabled?: boolean
}) {
  const [draft, setDraft] = useState(String(shown))
  useEffect(() => setDraft(String(shown)), [shown])

  const commit = () => {
    const parsed = Number(draft)
    if (!draft.trim() || !Number.isFinite(parsed)) {
      setDraft(String(shown))
      return
    }
    const clamped = Math.round(Math.min(Math.max(parsed, pref.minValue ?? -Infinity), pref.maxValue ?? Infinity))
    setDraft(String(clamped))
    if (clamped !== shown) onCommit(clamped)
  }

  return (
    <input
      type="number"
      aria-label={label}
      min={pref.minValue}
      max={pref.maxValue}
      value={draft}
      disabled={disabled}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => e.key === 'Enter' && commit()}
      className={cn(
        'h-7 w-20 rounded-md border bg-bg px-1.5 text-right text-xs tabular-nums outline-none focus:border-accent',
        set ? 'border-border text-fg' : 'border-dashed border-border text-muted',
      )}
    />
  )
}

function Switch({
  checked,
  onChange,
  label,
  dim,
  disabled,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  dim?: boolean
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-5 w-9 shrink-0 rounded-full outline-none transition focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60',
        checked ? 'bg-accent' : 'bg-surface-2 ring-1 ring-border',
        dim && 'opacity-45 hover:opacity-80',
      )}
    >
      <span
        className={cn(
          // left-0 anchors the knob; without it an absolute child starts at the button's centered content.
          'absolute left-0 top-0.5 size-4 rounded-full bg-white shadow transition-transform',
          checked ? 'translate-x-[18px]' : 'translate-x-0.5',
        )}
      />
    </button>
  )
}
