import * as Dialog from '@radix-ui/react-dialog'
import { Copy, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useShallow } from 'zustand/react/shallow'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { client } from '@/api/client'
import type { LocalContent, MessageEventContent, RoomID, UserID } from '@/api/types'
import { cn } from '@/lib/cn'
import { formatDay, formatFull, formatTime, isSameDay } from '@/lib/format'
import { selectOwnUserID, useChat } from '@/store/chat'
import { displayNameOf, normalizeEvent, originalEvent, type TimelineEvent } from '@/store/events'
import { useMember } from '@/store/hooks'
import { loadReactionDetails, reactionSignature, useReactionDetails } from '@/store/reactions'
import { openProfile, showToast, useUI, type MessageDialog } from '@/store/ui'
import { sanitizeHTML } from '@/ui/html'
import { Avatar, Spinner } from '@/ui/primitives'

const closeDialog = () => useUI.setState({ dialog: null })
const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err))

const DIALOG_WIDTH: Record<MessageDialog['type'], string> = {
  source: 'w-[min(720px,calc(100vw-32px))]',
  original: 'w-[min(640px,calc(100vw-32px))]',
  edits: 'w-[min(640px,calc(100vw-32px))]',
  reactions: 'w-[min(460px,calc(100vw-32px))]',
  receipts: 'w-[min(460px,calc(100vw-32px))]',
  delete: 'w-[min(480px,calc(100vw-32px))]',
}

/** Message dialogs (source, original, edit history, reactions, delete), rendered once for the whole app. */
export function MessageDialogs() {
  const dialog = useUI(s => s.dialog)
  const evt = useChat(s => (dialog ? s.events[dialog.rowid] : undefined))
  const open = !!dialog && !!evt

  return (
    <Dialog.Root open={open} onOpenChange={next => !next && closeDialog()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[2px]" />
        <Dialog.Content
          aria-describedby={undefined}
          className={cn(
            'message-dialog fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-border bg-surface text-fg shadow-2xl outline-none',
            dialog && DIALOG_WIDTH[dialog.type],
          )}
        >
          {dialog?.type === 'source' && evt && <SourceView evt={evt} />}
          {dialog?.type === 'original' && evt && <OriginalView evt={evt} />}
          {dialog?.type === 'edits' && evt && <EditHistoryView evt={evt} />}
          {dialog?.type === 'reactions' && evt && <ReactionsView evt={evt} />}
          {dialog?.type === 'receipts' && evt && <ReceiptsView evt={evt} userIDs={dialog.userIDs ?? []} />}
          {dialog?.type === 'delete' && evt && <DeleteConfirm evt={evt} />}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export function DialogHeader({ title, actions }: { title: string; actions?: ReactNode }) {
  return (
    <header className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3">
      <Dialog.Title className="text-sm font-semibold">{title}</Dialog.Title>
      <span className="ml-auto flex items-center gap-1">
        {actions}
        <Dialog.Close aria-label="Close" className="rounded-md p-1 text-muted hover:bg-hover hover:text-fg">
          <X size={16} />
        </Dialog.Close>
      </span>
    </header>
  )
}

export function CopyJSONButton({ value }: { value: unknown }) {
  const copy = () =>
    navigator.clipboard.writeText(JSON.stringify(value, null, 2)).then(
      () => showToast('Copied to clipboard'),
      () => showToast("Couldn't copy"),
    )
  return (
    <button type="button" onClick={() => void copy()} className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted hover:bg-hover hover:text-fg">
      <Copy size={12} /> Copy
    </button>
  )
}

const WRAP_STORAGE_KEY = 'othermuks-json-wrap'

/** Whether JSON views wrap long lines; remembered on this device. */
export function useJSONWrap(): [boolean, (wrap: boolean) => void] {
  const [wrap, setWrap] = useState(() => {
    try {
      return localStorage.getItem(WRAP_STORAGE_KEY) === '1'
    } catch {
      return false
    }
  })
  const update = (next: boolean) => {
    setWrap(next)
    try {
      localStorage.setItem(WRAP_STORAGE_KEY, next ? '1' : '0')
    } catch {
      // Storage unavailable: the choice just isn't remembered.
    }
  }
  return [wrap, update]
}

export function WrapSwitch({ wrap, onChange }: { wrap: boolean; onChange: (wrap: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={wrap}
      onClick={() => onChange(!wrap)}
      className="flex items-center gap-2 rounded-md px-2 py-1 text-xs text-muted hover:bg-hover hover:text-fg"
    >
      <span className={cn('relative h-4 w-7 shrink-0 rounded-full transition-colors', wrap ? 'bg-accent' : 'bg-surface-2 ring-1 ring-border')}>
        <span
          className={cn(
            'absolute left-0 top-0.5 size-3 rounded-full bg-white shadow transition-transform',
            wrap ? 'translate-x-3.5' : 'translate-x-0.5',
          )}
        />
      </span>
      Wrap lines
    </button>
  )
}

export function JSONBlock({ value, wrap }: { value: unknown; wrap: boolean }) {
  const text = useMemo(() => JSON.stringify(value, null, 2), [value])
  return (
    <pre
      className={cn(
        'overflow-auto rounded-lg border border-border bg-[var(--code-bg)] p-3 font-mono text-xs leading-relaxed',
        wrap ? 'whitespace-pre-wrap break-all' : 'whitespace-pre',
      )}
    >
      {text}
    </pre>
  )
}

/** Renders message content (formatted text, or a short label for media) without the timeline chrome. */
function ContentPreview({ content, localContent }: { content: MessageEventContent; localContent?: LocalContent }) {
  const isMedia = ['m.image', 'm.video', 'm.audio', 'm.file', 'm.sticker'].includes(content.msgtype)
  if (isMedia) {
    return (
      <p className="text-sm text-muted">
        [{content.msgtype.replace('m.', '')}] {content.filename ?? content.body}
      </p>
    )
  }
  const html = localContent?.sanitized_html
  return html ? (
    <div className="message-body text-sm" dangerouslySetInnerHTML={{ __html: sanitizeHTML(html) }} />
  ) : (
    <p className="message-body whitespace-pre-wrap text-sm">{typeof content.body === 'string' ? content.body : ''}</p>
  )
}

function SourceView({ evt }: { evt: TimelineEvent }) {
  const source = useMemo(() => originalEvent(evt), [evt])
  const [wrap, setWrap] = useJSONWrap()
  return (
    <>
      <DialogHeader
        title="Event source"
        actions={
          <>
            <WrapSwitch wrap={wrap} onChange={setWrap} />
            <CopyJSONButton value={source} />
          </>
        }
      />
      <div className="flex min-h-0 flex-col gap-2 overflow-auto p-4">
        <p className="text-xs text-muted">
          The event as delivered by gomuks{evt.original ? ', with the decrypted content in decrypted and decrypted_type' : ''}.
        </p>
        <JSONBlock value={source} wrap={wrap} />
      </div>
    </>
  )
}

type Loadable<T> = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ok'; value: T }

function OriginalView({ evt }: { evt: TimelineEvent }) {
  const [state, setState] = useState<Loadable<TimelineEvent>>({ status: 'loading' })
  const [wrap, setWrap] = useJSONWrap()

  useEffect(() => {
    let cancelled = false
    client.getEvent(evt.room_id, evt.event_id, true).then(
      raw => !cancelled && setState({ status: 'ok', value: normalizeEvent(raw) }),
      err => !cancelled && setState({ status: 'error', message: errorText(err) }),
    )
    return () => {
      cancelled = true
    }
  }, [evt.room_id, evt.event_id])

  return (
    <>
      <DialogHeader
        title="Original message"
        actions={
          state.status === 'ok' && (
            <>
              <WrapSwitch wrap={wrap} onChange={setWrap} />
              <CopyJSONButton value={originalEvent(state.value)} />
            </>
          )
        }
      />
      <div className="flex min-h-0 flex-col gap-3 overflow-auto p-4">
        {state.status === 'loading' && (
          <div className="flex justify-center py-8 text-muted">
            <Spinner />
          </div>
        )}
        {state.status === 'error' && (
          <div className="flex flex-col gap-1.5 text-sm">
            <p>The homeserver didn't return the original content.</p>
            <p className="text-xs text-muted">
              Deleted messages can usually only be viewed by room moderators, and only if the homeserver supports it.
            </p>
            <p className="font-mono text-xs text-muted">{state.message}</p>
          </div>
        )}
        {state.status === 'ok' && (
          <>
            <div className="rounded-lg border border-border bg-bg/60 p-3">
              <p className="mb-1.5 text-xs text-muted">Sent {formatFull(state.value.timestamp)}</p>
              <ContentPreview content={state.value.content as unknown as MessageEventContent} localContent={state.value.local_content} />
            </div>
            <details>
              <summary className="cursor-pointer text-xs font-medium text-muted hover:text-fg">Event JSON</summary>
              <div className="mt-2">
                <JSONBlock value={originalEvent(state.value)} wrap={wrap} />
              </div>
            </details>
          </>
        )}
      </div>
    </>
  )
}

interface Version {
  label: string
  timestamp: number
  content: MessageEventContent
  localContent?: LocalContent
}

function EditHistoryView({ evt }: { evt: TimelineEvent }) {
  const [state, setState] = useState<Loadable<Version[]>>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    client.getRelatedEvents(evt.room_id, evt.event_id, 'm.replace').then(
      related => {
        if (cancelled) return
        // Only the original sender's edits count.
        const edits = related
          .map(normalizeEvent)
          .filter(edit => edit.sender === evt.sender && !edit.redacted_by)
          .sort((a, b) => a.timestamp - b.timestamp)
        setState({
          status: 'ok',
          value: [
            { label: 'Original', timestamp: evt.timestamp, content: evt.content as unknown as MessageEventContent, localContent: evt.local_content },
            ...edits.map((edit, i) => ({
              label: `Edit ${i + 1}`,
              timestamp: edit.timestamp,
              content: (edit.content['m.new_content'] ?? edit.content) as unknown as MessageEventContent,
              localContent: edit.local_content,
            })),
          ],
        })
      },
      err => !cancelled && setState({ status: 'error', message: errorText(err) }),
    )
    return () => {
      cancelled = true
    }
  }, [evt])

  return (
    <>
      <DialogHeader title="Edit history" />
      <div className="flex min-h-0 flex-col gap-2 overflow-auto p-4">
        {state.status === 'loading' && (
          <div className="flex justify-center py-8 text-muted">
            <Spinner />
          </div>
        )}
        {state.status === 'error' && <p className="text-sm text-danger">Couldn't load the edit history: {state.message}</p>}
        {state.status === 'ok' &&
          state.value.map((version, i) => {
            const current = i === state.value.length - 1
            return (
              <div key={`${version.label}-${version.timestamp}`} className={cn('rounded-lg border p-3', current ? 'border-accent/60 bg-accent/5' : 'border-border')}>
                <div className="mb-1.5 flex items-center gap-2 text-xs">
                  <span className="font-semibold">{version.label}</span>
                  {current && <span className="rounded-full bg-accent px-1.5 py-px text-[10px] font-medium text-accent-fg">Current</span>}
                  <time className="ml-auto text-muted" title={formatFull(version.timestamp)}>
                    {formatFull(version.timestamp)}
                  </time>
                </div>
                <ContentPreview content={version.content} localContent={version.localContent} />
              </div>
            )
          })}
      </div>
    </>
  )
}

interface UserRowProps {
  roomID: RoomID
  userID: UserID
  emoji?: string
  timestamp: number
  /** Shown at the right of the row, e.g. when the user read the message. */
  trailing?: ReactNode
}

function ReactorRow({ roomID, userID, emoji, timestamp, trailing }: UserRowProps) {
  const member = useMember(roomID, userID)
  const name = displayNameOf(userID, member)
  return (
    <li>
      <button
        type="button"
        onClick={() => {
          closeDialog()
          openProfile(userID)
        }}
        title={formatFull(timestamp)}
        className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-hover"
      >
        <Avatar mxc={member?.avatar_url} id={userID} name={name} size={32} />
        <span className="min-w-0 flex-1 leading-snug">
          <span className="block truncate text-sm font-medium">{name}</span>
          <span className="block truncate text-xs text-muted">{userID}</span>
        </span>
        {emoji && <span className="shrink-0 text-lg">{emoji}</span>}
        {trailing}
      </button>
    </li>
  )
}

/** Time of day for today, otherwise the day as well. */
function readTime(ts: number) {
  return isSameDay(ts, Date.now()) ? formatTime(ts) : `${formatDay(ts)}, ${formatTime(ts)}`
}

/** Who has read up to this message (their receipt is on it, or on a hidden event right after it), newest first. */
function ReceiptsView({ evt, userIDs }: { evt: TimelineEvent; userIDs: UserID[] }) {
  // Timestamps come live from the store, so a receipt that moves on while the dialog is open updates.
  const timestamps = useChat(useShallow(s => userIDs.map(userID => s.rooms[evt.room_id]?.receipts[userID]?.timestamp ?? 0)))
  const rows = userIDs.map((userID, i) => ({ userID, timestamp: timestamps[i] })).sort((a, b) => b.timestamp - a.timestamp)

  return (
    <>
      <DialogHeader title={`Read by ${userIDs.length} ${userIDs.length === 1 ? 'person' : 'people'}`} />
      <div className="min-h-0 overflow-auto p-2">
        {rows.length === 0 && <p className="p-4 text-center text-sm text-muted">Nobody has read this yet.</p>}
        <ul>
          {rows.map(row => (
            <ReactorRow
              key={row.userID}
              roomID={evt.room_id}
              userID={row.userID}
              timestamp={row.timestamp}
              trailing={
                row.timestamp > 0 && (
                  <span className="shrink-0 text-right text-xs tabular-nums text-muted">
                    <span className="block text-[10px] uppercase tracking-wide">Read</span>
                    {readTime(row.timestamp)}
                  </span>
                )
              }
            />
          ))}
        </ul>
      </div>
    </>
  )
}

function ReactionsView({ evt }: { evt: TimelineEvent }) {
  const details = useReactionDetails(s => s.entries[evt.event_id])
  const [tab, setTab] = useState<string>('all')
  const signature = reactionSignature(evt)
  const byKey = details?.signature === signature ? details.byKey : undefined

  useEffect(() => {
    loadReactionDetails(evt.room_id, evt).catch(() => {})
  }, [evt])

  const keys = byKey ? Object.keys(byKey).sort((a, b) => byKey[b].length - byKey[a].length) : []
  const rows = byKey
    ? tab === 'all'
      ? keys.flatMap(key => byKey[key].map(reactor => ({ ...reactor, key }))).sort((a, b) => a.timestamp - b.timestamp)
      : (byKey[tab] ?? []).map(reactor => ({ ...reactor, key: tab }))
    : []
  const total = keys.reduce((sum, key) => sum + (byKey?.[key].length ?? 0), 0)

  const tabClass = (active: boolean) =>
    cn('flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs transition-colors', active ? 'bg-accent text-accent-fg' : 'bg-surface-2 text-muted hover:text-fg')

  return (
    <>
      <DialogHeader title="Reactions" />
      {byKey && (
        <div className="flex shrink-0 gap-1.5 overflow-x-auto border-b border-border px-4 py-2.5">
          <button type="button" className={tabClass(tab === 'all')} onClick={() => setTab('all')}>
            All <span className="tabular-nums">{total}</span>
          </button>
          {keys.map(key => (
            <button key={key} type="button" className={tabClass(tab === key)} onClick={() => setTab(key)}>
              <span className="text-sm leading-none">{key}</span> <span className="tabular-nums">{byKey[key].length}</span>
            </button>
          ))}
        </div>
      )}
      <div className="min-h-0 overflow-auto p-2">
        {!byKey && !details?.error && (
          <div className="flex justify-center py-8 text-muted">
            <Spinner />
          </div>
        )}
        {details?.error && !byKey && <p className="p-2 text-sm text-danger">Couldn't load reactions: {details.error}</p>}
        <ul>
          {rows.map(row => (
            <ReactorRow key={row.eventID} roomID={evt.room_id} userID={row.userID} emoji={tab === 'all' ? row.key : undefined} timestamp={row.timestamp} />
          ))}
        </ul>
      </div>
    </>
  )
}

function DeleteConfirm({ evt }: { evt: TimelineEvent }) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const ownUserID = useChat(selectOwnUserID)
  const sender = useMember(evt.room_id, evt.sender)
  const othersMessage = evt.sender !== ownUserID

  async function confirm() {
    setBusy(true)
    try {
      await client.redactEvent(evt.room_id, evt.event_id, reason.trim())
      closeDialog()
    } catch (err) {
      showToast(`Couldn't delete: ${errorText(err)}`)
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4 p-5">
      <Dialog.Title className="text-base font-semibold">
        {othersMessage ? `Delete ${displayNameOf(evt.sender, sender)}'s message?` : 'Delete message?'}
      </Dialog.Title>
      <p className="text-sm text-muted">
        {othersMessage
          ? "You're removing another person's message as a moderator. It's removed for everyone in the room and can't be undone."
          : "This removes the message for everyone in the room. It can't be undone."}
      </p>
      <input
        value={reason}
        onChange={e => setReason(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && void confirm()}
        placeholder="Reason (optional)"
        autoFocus
        className="h-10 rounded-lg border border-border bg-bg px-3 text-sm outline-none placeholder:text-muted focus:border-accent"
      />
      <div className="flex justify-end gap-2">
        <Dialog.Close className="rounded-lg px-3 py-2 text-sm hover:bg-hover">Cancel</Dialog.Close>
        <button
          type="button"
          onClick={() => void confirm()}
          disabled={busy}
          className="flex items-center gap-2 rounded-lg bg-danger px-3 py-2 text-sm font-medium text-white transition hover:brightness-110 disabled:opacity-60"
        >
          {busy && <Spinner size={14} />}
          Delete
        </button>
      </div>
    </div>
  )
}

const TOAST_DURATION = 2500

export function Toaster() {
  const toast = useUI(s => s.toast)
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => useUI.setState(s => (s.toast?.id === toast.id ? { toast: null } : {})), TOAST_DURATION)
    return () => clearTimeout(timer)
  }, [toast])

  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center">
      <AnimatePresence>
        {toast && (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.15 }}
            className="toast rounded-lg border border-border bg-surface-2 px-4 py-2 text-sm text-fg shadow-xl"
          >
            {toast.message}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
