import { Paperclip, Pencil, Reply, SendHorizontal, X } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { client } from '@/api/client'
import type { EventID, EventRowID, RoomID } from '@/api/types'
import { cn } from '@/lib/cn'
import { findLastOwnEditable, sendText, uploadAndSend, useChat } from '@/store/chat'
import { displayContent, isMessageLike, isPendingEvent, isRenderable } from '@/store/events'
import { usePreference } from '@/store/preferences'
import { useDisplayName } from '@/store/hooks'
import { closeEventContext, useEventContext } from '@/store/navigation'
import { useUI } from '@/store/ui'
import { IconButton, Spinner } from '@/ui/primitives'

const TYPING_TIMEOUT = 10_000
const TYPING_RESEND = 4_000
const drafts = new Map<string, string>()

interface ComposerProps {
  roomID: RoomID
  /** Send into this thread instead of the main timeline. */
  threadRoot?: EventID
}

export function Composer({ roomID, threadRoot }: ComposerProps) {
  // Reply/edit state is global; each composer only acts on the state aimed at its own scope.
  const scope = threadRoot ?? null
  const draftKey = threadRoot ? `${roomID}|${threadRoot}` : roomID
  const replyToRowID = useUI(s => (s.composerScope === scope ? s.replyTo : null))
  const editingRowID = useUI(s => (s.composerScope === scope ? s.editing : null))
  const replyTo = useChat(s => (replyToRowID == null ? undefined : s.events[replyToRowID]))
  const editing = useChat(s => (editingRowID == null ? undefined : s.events[editingRowID]))
  const roomName = useChat(s => s.rooms[roomID]?.meta.name)
  const replyName = useDisplayName(roomID, replyTo?.sender)

  const sendTyping = usePreference('send_typing_notifications', roomID)
  const ctrlEnterSend = usePreference('ctrl_enter_send', roomID)
  const ctrlArrowReply = usePreference('ctrl_arrow_reply', roomID)
  const refocusAfterSend = usePreference('refocus_input_after_send', roomID)

  const [text, setText] = useState(() => drafts.get(draftKey) ?? '')
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(0)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const typingSentAt = useRef(0)

  useEffect(() => {
    drafts.set(draftKey, text)
  }, [draftKey, text])

  // Load the message source into the input when editing starts.
  useEffect(() => {
    if (editingRowID == null) return
    const { events } = useChat.getState()
    const evt = events[editingRowID]
    if (!evt) return
    const { content, localContent } = displayContent(evt, evt.last_edit_rowid ? events[evt.last_edit_rowid] : undefined)
    setText(localContent?.edit_source ?? content.body ?? '')
    requestAnimationFrame(() => {
      const input = inputRef.current
      input?.focus()
      input?.setSelectionRange(input.value.length, input.value.length)
    })
  }, [editingRowID])

  useEffect(() => {
    if (replyToRowID != null) inputRef.current?.focus()
  }, [replyToRowID])

  const stopTyping = () => {
    if (!typingSentAt.current) return
    typingSentAt.current = 0
    client.setTyping(roomID, 0).catch(() => {})
  }

  useEffect(() => stopTyping, [roomID])

  const cancelContext = () => {
    if (editing) setText('')
    useUI.setState({ replyTo: null, editing: null })
  }

  async function submit() {
    const body = text.trim()
    if (!body) return
    const opts = { replyTo, edit: editing, threadRoot }
    setText('')
    setError(null)
    if (replyTo || editing) useUI.setState({ replyTo: null, editing: null })
    stopTyping()
    // Sending from the room composer returns to the present if an older context view is open.
    if (!threadRoot && useEventContext.getState().view?.roomID === roomID) closeEventContext()
    try {
      await sendText(roomID, body, opts)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setText(body)
    }
  }

  async function upload(files: File[]) {
    if (!files.length) return
    setUploading(n => n + files.length)
    setError(null)
    try {
      await uploadAndSend(roomID, files, threadRoot)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setUploading(n => n - files.length)
    }
  }

  /** Ctrl+↑/↓ moves the reply target through the timeline (↓ past the newest message clears it). */
  function stepReply(delta: -1 | 1): boolean {
    const { rooms, events } = useChat.getState()
    const candidates: EventRowID[] = []
    if (threadRoot) {
      for (const rowid of useChat.getState().threads[threadRoot] ?? []) candidates.push(rowid)
    } else {
      for (const tuple of rooms[roomID]?.timeline ?? []) {
        const evt = events[tuple.event_rowid]
        if (evt && isMessageLike(evt) && isRenderable(evt) && !isPendingEvent(evt)) candidates.push(evt.rowid)
      }
    }
    if (!candidates.length) return false
    const index = replyToRowID == null ? -1 : candidates.indexOf(replyToRowID)
    let next: EventRowID | null
    if (index < 0) {
      if (delta > 0) return false
      next = candidates[candidates.length - 1]
    } else if (index + delta >= candidates.length) {
      next = null
    } else {
      next = candidates[Math.max(0, index + delta)]
    }
    useUI.setState({ replyTo: next, editing: null, composerScope: scope })
    return true
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    const mod = e.ctrlKey || e.metaKey
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && (!ctrlEnterSend || mod)) {
      e.preventDefault()
      void submit()
    } else if (e.key === 'Escape' && (replyTo || editing)) {
      e.preventDefault()
      cancelContext()
    } else if (mod && ctrlArrowReply && !editing && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      if (stepReply(e.key === 'ArrowUp' ? -1 : 1)) e.preventDefault()
    } else if (e.key === 'ArrowUp' && !mod && !text && !editing) {
      const last = findLastOwnEditable(roomID, threadRoot)
      if (last) {
        e.preventDefault()
        useUI.setState({ editing: last.rowid, replyTo: null, composerScope: scope })
      }
    }
  }

  function onChange(value: string) {
    setText(value)
    if (!sendTyping) return
    if (!value) {
      stopTyping()
    } else if (Date.now() - typingSentAt.current > TYPING_RESEND) {
      typingSentAt.current = Date.now()
      client.setTyping(roomID, TYPING_TIMEOUT).catch(() => {})
    }
  }

  const context = editing
    ? { icon: <Pencil size={13} />, label: 'Editing message' }
    : replyTo
      ? { icon: <Reply size={13} />, label: `Replying to ${replyName}` }
      : null

  return (
    <div className="composer-wrap shrink-0 px-4 pb-4">
      {context && (
        <div className="composer-context flex items-center gap-2 rounded-t-xl border border-b-0 border-border bg-surface-2/60 px-3 py-1.5 text-xs text-muted">
          {context.icon}
          <span className="truncate">{context.label}</span>
          <button type="button" aria-label="Cancel" onClick={cancelContext} className="ml-auto rounded p-0.5 hover:bg-hover hover:text-fg">
            <X size={13} />
          </button>
        </div>
      )}
      <div
        className={cn(
          'composer flex items-end gap-1 border border-border px-1.5 py-1.5 shadow-sm transition-colors focus-within:border-accent/60',
          context ? 'rounded-b-xl' : 'rounded-xl',
        )}
      >
        <IconButton label="Attach files" onClick={() => fileRef.current?.click()} disabled={uploading > 0}>
          {uploading > 0 ? <Spinner size={17} /> : <Paperclip size={17} />}
        </IconButton>
        <textarea
          id={threadRoot ? undefined : 'composer-input'}
          ref={inputRef}
          rows={1}
          value={text}
          autoFocus
          placeholder={threadRoot ? 'Reply in thread…' : 'Send a message…'}
          aria-label={threadRoot ? 'Reply in thread' : roomName ? `Message ${roomName}` : 'Message'}
          onChange={e => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={e => {
            const files = Array.from(e.clipboardData.files)
            if (files.length) {
              e.preventDefault()
              void upload(files)
            }
          }}
          className="max-h-60 min-h-8 flex-1 resize-none bg-transparent px-1 py-1.5 text-[15px] leading-5 outline-none [field-sizing:content] placeholder:text-muted"
        />
        <IconButton
          label="Send"
          shortcut={ctrlEnterSend ? 'Ctrl Enter' : 'Enter'}
          onClick={() => {
            void submit()
            if (refocusAfterSend) inputRef.current?.focus()
          }}
          disabled={!text.trim()}
          className="enabled:text-accent"
        >
          <SendHorizontal size={17} />
        </IconButton>
        <input
          ref={fileRef}
          type="file"
          multiple
          hidden
          onChange={e => {
            void upload(Array.from(e.target.files ?? []))
            e.target.value = ''
          }}
        />
      </div>
      {error && (
        <p className="mt-1.5 px-1 text-xs text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
