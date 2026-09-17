import { Paperclip, Pencil, Reply, SendHorizontal, Smile, Sticker, X } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { client } from '@/api/client'
import type { EventID, EventRowID, RoomID } from '@/api/types'
import { cn } from '@/lib/cn'
import { findLastOwnEditable, sendText, uploadAndSend, useChat } from '@/store/chat'
import { customEmojiMarkdown, recordEmojiUse, sendSticker, type CustomEmoji } from '@/store/emoji'
import { displayContent, hasNoRenderer, isMessageLike, isPendingEvent, isRenderable } from '@/store/events'
import { useDisplayName } from '@/store/hooks'
import { closeEventContext, useEventContext } from '@/store/navigation'
import { usePreference } from '@/store/preferences'
import { useUI } from '@/store/ui'
import { EmojiSuggestions, useEmojiSuggestions } from '@/ui/emoji/EmojiAutocomplete'
import { EmojiPopover } from '@/ui/emoji/EmojiPopover'
import { withTone, type EmojiItem, type PickerSelection } from '@/ui/emoji/items'
import { readSkinTone } from '@/ui/emoji/unicode'
import { IconButton, Spinner } from '@/ui/primitives'
import { ReplyPreview } from '@/ui/timeline/TimelineRow'
import { mentionMarkdown, MentionSuggestions, useMemberSuggestions, type MemberSuggestion } from './MentionSuggestions'

const TYPING_TIMEOUT = 10_000
const TYPING_RESEND = 4_000
/** `:name` right before the caret, at the start or after whitespace or "(". */
const SUGGEST_PATTERN = /(?:^|[\s(])(:[a-zA-Z0-9_+-]{2,})$/
/** `@query` right before the caret (a bare "@" lists members too); not inside words like e-mail addresses. */
const MENTION_PATTERN = /(?:^|[\s(])(@[^\s@()[\]]{0,48})$/
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
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [stickersOpen, setStickersOpen] = useState(false)
  const [suggest, setSuggest] = useState<{ kind: 'emoji' | 'mention'; start: number; end: number; query: string } | null>(null)
  const [suggestIndex, setSuggestIndex] = useState(0)
  const dismissedAt = useRef(-1)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const typingSentAt = useRef(0)

  const suggestions = useEmojiSuggestions(suggest?.kind === 'emoji' ? suggest.query : null, roomID)
  const memberSuggestions = useMemberSuggestions(suggest?.kind === 'mention' ? suggest.query : null, roomID)
  const suggestionCount = suggest?.kind === 'mention' ? memberSuggestions.length : suggestions.length
  const suggesting = !!suggest && suggestionCount > 0

  useEffect(() => {
    drafts.set(draftKey, text)
  }, [draftKey, text])

  useEffect(() => {
    setSuggestIndex(0)
  }, [suggest?.query, suggest?.kind])

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
    setSuggest(null)
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

  async function sendStickerPick(emoji: CustomEmoji) {
    setError(null)
    if (!threadRoot && useEventContext.getState().view?.roomID === roomID) closeEventContext()
    try {
      await sendSticker(roomID, emoji, threadRoot)
    } catch (err) {
      setError(`Couldn't send the sticker: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  /** Replaces text[start, end) and puts the caret after the insertion. */
  function replaceRange(start: number, end: number, insertion: string) {
    const next = text.slice(0, start) + insertion + text.slice(end)
    onChange(next)
    const caret = start + insertion.length
    requestAnimationFrame(() => {
      const input = inputRef.current
      input?.focus()
      input?.setSelectionRange(caret, caret)
    })
  }

  function insertAtCursor(insertion: string) {
    const input = inputRef.current
    const start = input?.selectionStart ?? text.length
    const end = input?.selectionEnd ?? start
    replaceRange(start, end, insertion)
  }

  function onPickerSelect(selection: PickerSelection) {
    if (selection.kind === 'sticker') void sendStickerPick(selection.emoji)
    else insertAtCursor(selection.kind === 'custom' ? customEmojiMarkdown(selection.emoji) : selection.text)
  }

  function updateSuggest(value: string, caret: number | null) {
    const before = caret === null ? '' : value.slice(0, caret)
    const mention = caret === null ? null : MENTION_PATTERN.exec(before)
    const match = mention ?? (caret === null ? null : SUGGEST_PATTERN.exec(before))
    if (!match || caret === null) {
      dismissedAt.current = -1
      setSuggest(null)
      return
    }
    const start = caret - match[1].length
    if (start === dismissedAt.current) {
      setSuggest(null)
      return
    }
    const kind = mention ? 'mention' : 'emoji'
    const query = match[1].slice(1)
    setSuggest(prev => (prev && prev.kind === kind && prev.start === start && prev.end === caret ? prev : { kind, start, end: caret, query }))
  }

  function pickMention(member: MemberSuggestion) {
    if (!suggest) return
    replaceRange(suggest.start, suggest.end, `${mentionMarkdown(member.name, member.userID)} `)
    setSuggest(null)
  }

  function pickActiveSuggestion() {
    if (!suggest) return
    const index = Math.min(suggestIndex, suggestionCount - 1)
    if (suggest.kind === 'mention') pickMention(memberSuggestions[index])
    else pickSuggestion(suggestions[index])
  }

  function pickSuggestion(item: EmojiItem) {
    if (!suggest) return
    const insertion = item.kind === 'custom' ? customEmojiMarkdown(item.emoji) : withTone(item.emoji, readSkinTone())
    recordEmojiUse(item.kind === 'custom' ? item.emoji.key : insertion)
    replaceRange(suggest.start, suggest.end, `${insertion} `)
    setSuggest(null)
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
        // Edits are message-like and can be shown as hidden events, but they're no use to reply to.
        if (evt && isMessageLike(evt) && !hasNoRenderer(evt) && isRenderable(evt) && !isPendingEvent(evt)) {
          candidates.push(evt.rowid)
        }
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
    if (suggesting && suggest) {
      const count = suggestionCount
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        setSuggestIndex(i => (i + (e.key === 'ArrowDown' ? 1 : -1) + count) % count)
        return
      }
      if ((e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) || e.key === 'Tab') {
        e.preventDefault()
        pickActiveSuggestion()
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        dismissedAt.current = suggest.start
        setSuggest(null)
        return
      }
    }
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
    <div className="composer-wrap relative shrink-0 px-4 pb-4">
      {suggesting && suggest?.kind === 'emoji' && (
        <EmojiSuggestions
          items={suggestions}
          active={Math.min(suggestIndex, suggestions.length - 1)}
          onHover={setSuggestIndex}
          onPick={pickSuggestion}
        />
      )}
      {suggesting && suggest?.kind === 'mention' && (
        <MentionSuggestions
          items={memberSuggestions}
          active={Math.min(suggestIndex, memberSuggestions.length - 1)}
          onHover={setSuggestIndex}
          onPick={pickMention}
        />
      )}
      {context && (
        <div className="composer-context rounded-t-xl border border-b-0 border-border bg-surface-2/60 px-3 py-1.5">
          <div className="flex items-center gap-2 text-xs text-muted">
            {context.icon}
            <span className="truncate">{context.label}</span>
            <button type="button" aria-label="Cancel" onClick={cancelContext} className="ml-auto rounded p-0.5 hover:bg-hover hover:text-fg">
              <X size={13} />
            </button>
          </div>
          {/* The whole message being replied to, as it will be quoted; long ones scroll. */}
          {replyTo && !editing && (
            <div className="composer-reply-quote -mb-0.5 max-h-36 overflow-y-auto overscroll-contain">
              <ReplyPreview roomID={roomID} eventID={replyTo.event_id} />
            </div>
          )}
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
          aria-autocomplete="list"
          aria-expanded={suggesting}
          onChange={e => {
            onChange(e.target.value)
            updateSuggest(e.target.value, e.target.selectionStart)
          }}
          onSelect={e => updateSuggest(e.currentTarget.value, e.currentTarget.selectionStart)}
          onBlur={() => setSuggest(null)}
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
        <EmojiPopover
          roomID={roomID}
          open={emojiOpen}
          onOpenChange={setEmojiOpen}
          tabs={editing ? ['emoji'] : ['emoji', 'stickers']}
          initialTab="emoji"
          restoreFocus={false}
          onSelect={onPickerSelect}
        >
          <IconButton label="Emoji" data-active={emojiOpen || undefined}>
            <Smile size={17} />
          </IconButton>
        </EmojiPopover>
        <EmojiPopover
          roomID={roomID}
          open={stickersOpen}
          onOpenChange={setStickersOpen}
          tabs={['emoji', 'stickers']}
          initialTab="stickers"
          restoreFocus={false}
          onSelect={onPickerSelect}
        >
          <IconButton label={editing ? "Stickers can't be sent while editing" : 'Stickers'} disabled={!!editing} data-active={stickersOpen || undefined}>
            <Sticker size={17} />
          </IconButton>
        </EmojiPopover>
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
