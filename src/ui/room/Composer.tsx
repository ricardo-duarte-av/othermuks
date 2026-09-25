import { File as FileIcon, Paperclip, Pencil, Reply, SendHorizontal, Smile, Sticker, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { client } from '@/api/client'
import type { EventID, EventRowID, RoomID } from '@/api/types'
import { cn } from '@/lib/cn'
import { formatBytes } from '@/lib/format'
import { attachmentKey, clearAttachments, removeAttachment, stageAttachments, useStagedFiles } from '@/store/attachments'
import { findLastOwnEditable, sendText, uploadAndSend, useChat } from '@/store/chat'
import { runCommand } from '@/store/commandRunner'
import { AVATAR_COMMANDS, resolveInput, suggestCommands, type CommandSuggestion, type ResolvedInput } from '@/store/commands'
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
import { CommandHint, CommandSuggestions, useRoomCommands } from './CommandSuggestions'
import { mentionMarkdown, MentionSuggestions, useMemberSuggestions, type MemberSuggestion } from './MentionSuggestions'

/** A staged file: images and videos show themselves, anything else shows its name. */
function AttachmentPreview({ file, onRemove }: { file: File; onRemove: () => void }) {
  const [url, setUrl] = useState<string | null>(null)
  const visual = file.type.startsWith('image/') || file.type.startsWith('video/')

  useEffect(() => {
    if (!visual) return
    const objectURL = URL.createObjectURL(file)
    setUrl(objectURL)
    return () => {
      URL.revokeObjectURL(objectURL)
      setUrl(null)
    }
  }, [file, visual])

  return (
    <div className="composer-attachment group relative shrink-0" title={`${file.name} (${formatBytes(file.size)})`}>
      {visual && url ? (
        file.type.startsWith('image/') ? (
          <img src={url} alt={file.name} className="size-16 rounded-lg border border-border object-cover" />
        ) : (
          <video src={url} muted className="size-16 rounded-lg border border-border object-cover" />
        )
      ) : (
        <div className="flex h-16 w-36 flex-col justify-center gap-0.5 rounded-lg border border-border bg-bg px-2">
          <span className="flex items-center gap-1.5 truncate text-xs font-medium">
            <FileIcon size={13} className="shrink-0 text-muted" />
            <span className="truncate">{file.name}</span>
          </span>
          <span className="pl-[19px] text-[11px] text-muted">{formatBytes(file.size)}</span>
        </div>
      )}
      <button
        type="button"
        aria-label={`Remove ${file.name}`}
        onClick={onRemove}
        className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full border border-border bg-surface text-muted shadow transition-colors hover:bg-danger hover:text-white"
      >
        <X size={12} />
      </button>
    </div>
  )
}

const TYPING_TIMEOUT = 10_000
const TYPING_RESEND = 4_000
/** `:name` right before the caret, at the start or after whitespace or "(". */
const SUGGEST_PATTERN = /(?:^|[\s(])(:[a-zA-Z0-9_+-]{2,})$/
/** `@query` right before the caret (a bare "@" lists members too); not inside words like e-mail addresses. */
const MENTION_PATTERN = /(?:^|[\s(])(@[^\s@()[\]]{0,48})$/
const drafts = new Map<string, string>()

const NOT_A_COMMAND: ResolvedInput = { kind: 'none' }

/** Where a command's arguments start in the text, or null while its name is still being typed. */
function argsStart(text: string, resolved: ResolvedInput): number | null {
  if (resolved.kind !== 'command' && resolved.kind !== 'format') return null
  const name = resolved.kind === 'command' ? resolved.name : resolved.spec.command
  let at = 1 + name.length
  if (text[at] === '@') at += resolved.spec.source.length
  return /\s/.test(text[at] ?? '') ? at + 1 : null
}

/** Why a typed command can't be sent as it is, or null if it can. */
function commandProblem(resolved: ResolvedInput, editing: boolean): string | null {
  switch (resolved.kind) {
    case 'unknown':
      return `Unknown command /${resolved.name}. Start with // to send a message beginning with a slash.`
    case 'ambiguous':
      return `Several bots have /${resolved.name}: pick one with ${resolved.sources.map(source => `/${resolved.name}${source}`).join(' or ')}.`
    case 'command':
      if (editing) return "Commands can't be used while editing a message."
      if (resolved.missing.length) return `/${resolved.name} needs ${resolved.missing.map(key => `{${key}}`).join(', ')}.`
      return null
    default:
      return null
  }
}

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

  const attachKey = attachmentKey(roomID, threadRoot)
  const attachments = useStagedFiles(attachKey)
  const [text, setText] = useState(() => drafts.get(draftKey) ?? '')
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(0)
  // Typing @room only pings the room once this stays checked, so a quoted or accidental @room is harmless.
  const [mentionRoom, setMentionRoom] = useState(true)
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [stickersOpen, setStickersOpen] = useState(false)
  const [suggest, setSuggest] = useState<{ kind: 'emoji' | 'mention'; start: number; end: number; query: string } | null>(null)
  const [suggestIndex, setSuggestIndex] = useState(0)
  const dismissedAt = useRef(-1)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const typingSentAt = useRef(0)

  // Slash commands: suggestions while the name is typed, then a hint for its arguments.
  const commandMode = text.startsWith('/') && !text.startsWith('//')
  const commands = useRoomCommands(roomID, commandMode)
  const resolved = useMemo(() => (commandMode ? resolveInput(text.trim(), commands, roomID) : NOT_A_COMMAND), [commandMode, text, commands, roomID])
  // Once whitespace follows a complete command name, its arguments are being typed.
  const commandArgsAt = argsStart(text, resolved)
  const typingArgs = commandArgsAt !== null
  const [commandDismissed, setCommandDismissed] = useState<string | null>(null)
  const commandSuggestions = useMemo(
    () => (commandMode && !typingArgs && !text.includes('\n') && commandDismissed !== text ? suggestCommands(text.slice(1), commands) : []),
    [commandMode, typingArgs, text, commands, commandDismissed],
  )
  const [commandIndex, setCommandIndex] = useState(0)
  const [focused, setFocused] = useState(false)
  const commandSuggesting = focused && commandSuggestions.length > 0 && !suggest

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

  useEffect(() => {
    setCommandIndex(0)
  }, [text])

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
    // Attachments can go out with no caption at all; text alone still needs something to send.
    if (!body && !attachments.length) return
    const command = body.startsWith('/') && !body.startsWith('//') ? resolveInput(body, commands, roomID) : NOT_A_COMMAND
    const problem = commandProblem(command, !!editing)
    if (problem) {
      setError(problem)
      return
    }
    if (command.kind === 'command') {
      await submitCommand(body, command)
      return
    }
    const opts = { replyTo, edit: editing, threadRoot, mentionRoom }
    setText('')
    setMentionRoom(true)
    setError(null)
    setSuggest(null)
    if (replyTo || editing) useUI.setState({ replyTo: null, editing: null })
    stopTyping()
    // Sending from the room composer returns to the present if an older context view is open.
    if (!threadRoot && useEventContext.getState().view?.roomID === roomID) closeEventContext()

    if (attachments.length && !editing) {
      const files = attachments
      clearAttachments(attachKey)
      setUploading(n => n + files.length)
      try {
        await uploadAndSend(roomID, files, { replyTo, threadRoot, caption: body || undefined, mentionRoom })
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
        // Nothing was sent, or only some of it was: hand the files and the caption back.
        stageAttachments(attachKey, files)
        setText(body)
      } finally {
        setUploading(n => n - files.length)
      }
      return
    }

    try {
      await sendText(roomID, body, opts)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setText(body)
    }
  }

  async function submitCommand(body: string, command: Extract<ResolvedInput, { kind: 'command' }>) {
    const needsImage = AVATAR_COMMANDS.has(command.spec.command)
    const image = attachments.find(file => file.type.startsWith('image/'))
    if (needsImage && !image) {
      setError(`Attach an image to use /${command.name}.`)
      return
    }
    if (!needsImage && attachments.length) {
      setError("Files can't be sent with a command. Remove them or send them separately.")
      return
    }
    setText('')
    setError(null)
    setSuggest(null)
    if (replyTo || editing) useUI.setState({ replyTo: null, editing: null })
    stopTyping()
    if (!threadRoot && useEventContext.getState().view?.roomID === roomID) closeEventContext()
    const files = attachments
    if (files.length) {
      clearAttachments(attachKey)
      setUploading(n => n + 1)
    }
    try {
      await runCommand(command.spec, command.args, { roomID, body, replyTo, threadRoot, attachment: needsImage ? image : undefined })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setText(body)
      if (files.length) stageAttachments(attachKey, files)
    } finally {
      if (files.length) setUploading(n => n - 1)
    }
  }

  /** Puts the picked command in the input, ready for its arguments; picking what's already typed sends it. */
  function pickCommand(item: CommandSuggestion) {
    const insertion = `/${item.name}${item.needsSource ? item.spec.source : ''}`
    if (text.trim() === insertion && !item.spec.parameters.length) {
      void submit()
      return
    }
    replaceRange(0, text.length, `${insertion} `)
  }

  function attach(files: File[]) {
    if (!files.length) return
    if (editing) {
      setError('Finish or cancel the edit before attaching files.')
      return
    }
    setError(null)
    stageAttachments(attachKey, files)
    inputRef.current?.focus()
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
    if (commandSuggesting) {
      const count = commandSuggestions.length
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        setCommandIndex(i => (i + (e.key === 'ArrowDown' ? 1 : -1) + count) % count)
        return
      }
      if ((e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) || e.key === 'Tab') {
        e.preventDefault()
        pickCommand(commandSuggestions[Math.min(commandIndex, count - 1)])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setCommandDismissed(text)
        return
      }
    }
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
    } else if (e.key === 'Escape' && attachments.length) {
      e.preventDefault()
      clearAttachments(attachKey)
    } else if (mod && ctrlArrowReply && !editing && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      if (stepReply(e.key === 'ArrowUp' ? -1 : 1)) e.preventDefault()
    } else if (e.key === 'ArrowUp' && !mod && !text && !editing && !attachments.length) {
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

  // Same literal the server's push rule looks for, so the offer shows exactly when a ping is possible.
  const showRoomPing = text.includes('@room')

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
      {commandSuggesting && (
        <CommandSuggestions
          roomID={roomID}
          items={commandSuggestions}
          active={Math.min(commandIndex, commandSuggestions.length - 1)}
          onHover={setCommandIndex}
          onPick={pickCommand}
        />
      )}
      {focused && !suggesting && (resolved.kind === 'command' || resolved.kind === 'format') && commandArgsAt !== null && (
        <CommandHint
          roomID={roomID}
          spec={resolved.spec}
          name={resolved.kind === 'command' ? resolved.name : resolved.spec.command}
          argsText={text.slice(commandArgsAt)}
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
      {attachments.length > 0 && (
        <div
          className={cn(
            'composer-attachments flex gap-2 overflow-x-auto border border-b-0 border-border bg-surface-2/40 px-3 py-2',
            context ? '' : 'rounded-t-xl',
          )}
        >
          {attachments.map((file, index) => (
            <AttachmentPreview
              key={`${file.name}:${file.size}:${file.lastModified}:${index}`}
              file={file}
              onRemove={() => removeAttachment(attachKey, index)}
            />
          ))}
        </div>
      )}
      {showRoomPing && (
        <label
          className={cn(
            'composer-room-ping flex cursor-pointer items-center gap-2 border border-b-0 border-border bg-surface-2/40 px-3 py-1.5 text-xs text-muted',
            context || attachments.length ? '' : 'rounded-t-xl',
          )}
        >
          <input type="checkbox" checked={mentionRoom} onChange={e => setMentionRoom(e.target.checked)} className="accent-accent" />
          Notify the whole room
        </label>
      )}
      <div
        className={cn(
          'composer flex items-end gap-1 border border-border px-1.5 py-1.5 shadow-sm transition-colors focus-within:border-accent/60',
          context || attachments.length || showRoomPing ? 'rounded-b-xl' : 'rounded-xl',
        )}
      >
        <IconButton label="Attach files" onClick={() => fileRef.current?.click()} disabled={uploading > 0 || !!editing}>
          <Paperclip size={17} />
        </IconButton>
        <textarea
          id={threadRoot ? undefined : 'composer-input'}
          ref={inputRef}
          rows={1}
          value={text}
          autoFocus
          placeholder={attachments.length ? 'Add a caption…' : threadRoot ? 'Reply in thread…' : 'Send a message…'}
          aria-label={threadRoot ? 'Reply in thread' : roomName ? `Message ${roomName}` : 'Message'}
          aria-autocomplete="list"
          aria-expanded={suggesting || commandSuggesting}
          onChange={e => {
            onChange(e.target.value)
            updateSuggest(e.target.value, e.target.selectionStart)
          }}
          onSelect={e => updateSuggest(e.currentTarget.value, e.currentTarget.selectionStart)}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false)
            setSuggest(null)
          }}
          onKeyDown={onKeyDown}
          onPaste={e => {
            const files = Array.from(e.clipboardData.files)
            if (files.length) {
              e.preventDefault()
              attach(files)
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
          disabled={(!text.trim() && !attachments.length) || uploading > 0}
          className="enabled:text-accent"
        >
          {uploading > 0 ? <Spinner size={17} /> : <SendHorizontal size={17} />}
        </IconButton>
        <input
          ref={fileRef}
          type="file"
          multiple
          hidden
          onChange={e => {
            attach(Array.from(e.target.files ?? []))
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
