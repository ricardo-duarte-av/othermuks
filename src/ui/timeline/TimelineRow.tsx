import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import * as Tooltip from '@radix-ui/react-tooltip'
import {
  Code,
  Copy,
  Ellipsis,
  FileText,
  History,
  Link2,
  LockKeyhole,
  MessagesSquare,
  Pencil,
  Reply,
  SmilePlus,
  Trash2,
  Undo2,
  Users,
} from 'lucide-react'
import { motion } from 'motion/react'
import { memo, useEffect, useState, type ButtonHTMLAttributes, type CSSProperties, type MouseEvent, type ReactNode } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { client } from '@/api/client'
import { mediaURL, userColorIndex } from '@/api/media'
import type { EventID, EventRowID, LocalContent, MessageEventContent, RelatesTo, RoomID, UserID } from '@/api/types'
import { cn } from '@/lib/cn'
import { parseMatrixURI } from '@/lib/matrixURI'
import { formatBytes, formatDay, formatFull, formatNames, formatTime } from '@/lib/format'
import { fetchEvent, selectOwnUserID, useChat } from '@/store/chat'
import {
  describeStateEvent,
  displayContent,
  displayNameOf,
  fallbackDisplayName,
  isFailedSend,
  isMessageLike,
  isPendingEvent,
  type TimelineEvent,
} from '@/store/events'
import { useMember } from '@/store/hooks'
import { jumpToEvent, openMatrixTarget } from '@/store/navigation'
import { loadReactionDetails, reactionSignature, useReactionDetails, type Reactor } from '@/store/reactions'
import { openLightbox, openMessageDialog, openProfile, openThread, showToast, useUI } from '@/store/ui'
import { blurhashDataURL, blurhashOf } from '@/ui/blurhash'
import { sanitizeHTML } from '@/ui/html'
import { Avatar } from '@/ui/primitives'
import { ReactionPicker } from './ReactionPicker'
import { ReadReceipts } from './ReadReceipts'

const QUICK_REACTIONS = ['👍', '❤️', '😂']
const EDITABLE_MSGTYPES = new Set(['m.text', 'm.emote', 'm.notice'])

/** A row mounting within this long after it arrived animates in; later remounts (scrolling) don't. */
export const ENTER_ANIMATION_WINDOW = 1500

interface RowProps {
  roomID: RoomID
  rowid: EventRowID
  compact: boolean
  newDay: boolean
  /** Set when the row is rendered inside a thread panel. */
  threadRoot?: EventID
  /** Other users whose read receipt is on this row (main timeline only). */
  readers?: UserID[]
  /** When the row arrived while the room was open (ms timestamp), for the entrance animation. */
  arrivedAt?: number
}

export const TimelineRow = memo(function TimelineRow({ roomID, rowid, compact, newDay, threadRoot, readers, arrivedAt }: RowProps) {
  const evt = useChat(s => s.events[rowid])
  const ownUserID = useChat(selectOwnUserID)
  if (!evt) return null
  const own = evt.sender === ownUserID
  const entering = arrivedAt !== undefined && Date.now() - arrivedAt < ENTER_ANIMATION_WINDOW

  return (
    <motion.div
      // New messages rise into place (own ones grow from the right, others from the left) instead of popping in.
      initial={entering ? { opacity: 0, y: 16, scale: 0.97, filter: 'blur(4px)' } : false}
      animate={entering ? { opacity: 1, y: 0, scale: 1, filter: 'blur(0px)', transitionEnd: { filter: 'none' } } : undefined}
      transition={{ type: 'spring', stiffness: 420, damping: 32, mass: 0.7 }}
      style={{ transformOrigin: own ? '100% 100%' : '0% 100%' }}
    >
      {newDay && <DaySeparator ts={evt.timestamp} />}
      {isMessageLike(evt) ? (
        <MessageRow roomID={roomID} evt={evt} compact={compact} own={own} threadRoot={threadRoot} />
      ) : (
        <StateRow roomID={roomID} evt={evt} />
      )}
      {readers && readers.length > 0 && (
        <div className="px-4 pb-0.5">
          <ReadReceipts roomID={roomID} readers={readers} />
        </div>
      )}
    </motion.div>
  )
})

function DaySeparator({ ts }: { ts: number }) {
  return (
    <div role="separator" className="day-separator flex items-center gap-3 px-4 pb-1 pt-5 text-xs font-medium text-muted">
      <span className="h-px flex-1 bg-border" />
      {formatDay(ts)}
      <span className="h-px flex-1 bg-border" />
    </div>
  )
}

const userColor = (userID: string) => `var(--user-color-${userColorIndex(userID)})`
const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err))

function StateRow({ roomID, evt }: { roomID: RoomID; evt: TimelineEvent }) {
  const sender = useMember(roomID, evt.sender)
  const target = useMember(roomID, evt.state_key)
  const senderName = displayNameOf(evt.sender, sender)
  const ownName = evt.type === 'm.room.member' ? (evt.content.displayname as string | undefined) : undefined
  const prevName = evt.unsigned.prev_content?.displayname as string | undefined
  const targetName =
    ownName || prevName || target?.displayname || (evt.state_key ? fallbackDisplayName(evt.state_key) : '')
  return (
    <div className="state-event group flex items-center gap-3 px-4 py-0.5 text-xs text-muted">
      <div className="w-10 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{describeStateEvent(evt, senderName, targetName)}</span>
      <time title={formatFull(evt.timestamp)} className="invisible shrink-0 tabular-nums group-hover:visible">
        {formatTime(evt.timestamp)}
      </time>
    </div>
  )
}

interface MessageRowProps {
  roomID: RoomID
  evt: TimelineEvent
  compact: boolean
  own: boolean
  threadRoot?: EventID
}

function MessageRow({ roomID, evt, compact, own, threadRoot }: MessageRowProps) {
  const member = useMember(roomID, evt.sender)
  const lastEdit = useChat(s => (evt.last_edit_rowid ? s.events[evt.last_edit_rowid] : undefined))
  const highlighted = useUI(s => s.highlight?.rowid === evt.rowid)
  const name = displayNameOf(evt.sender, member)
  const { content, localContent } = displayContent(evt, lastEdit)
  const relation = evt.content['m.relates_to'] as RelatesTo | undefined
  // Thread replies carry a fallback reply to the previous thread message; only explicit replies get a preview.
  const replyTo = relation?.is_falling_back ? undefined : relation?.['m.in_reply_to']?.event_id
  const failed = isFailedSend(evt)
  const pending = isPendingEvent(evt) && !failed

  return (
    <div
      className={cn('chat-message group relative flex gap-3 px-4', compact ? 'py-px' : 'pb-px pt-2')}
      data-rowid={evt.rowid}
      data-own={own || undefined}
      data-pending={pending || undefined}
      data-failed={failed || undefined}
      data-redacted={evt.redacted_by ? true : undefined}
      data-highlight={highlighted || undefined}
    >
      <div className="flex w-10 shrink-0 justify-end">
        {compact ? (
          <time title={formatFull(evt.timestamp)} className="invisible pt-[5px] text-[10px] tabular-nums text-muted group-hover:visible">
            {formatTime(evt.timestamp)}
          </time>
        ) : (
          <ProfileButton userID={evt.sender} name={name} className="mt-0.5 h-10 rounded-full">
            <Avatar mxc={member?.avatar_url} id={evt.sender} name={name} size={40} />
          </ProfileButton>
        )}
      </div>
      <div className={cn('chat-bubble flex-1', pending && 'opacity-60')}>
        {!compact && (
          <div className="flex items-baseline gap-2 leading-tight">
            <ProfileButton
              userID={evt.sender}
              name={name}
              className="sender-name min-w-0 truncate text-sm font-semibold hover:underline"
              style={{ color: userColor(evt.sender) }}
            >
              {name}
            </ProfileButton>
            <time title={formatFull(evt.timestamp)} className="shrink-0 text-[11px] tabular-nums text-muted">
              {formatTime(evt.timestamp)}
            </time>
          </div>
        )}
        {replyTo && <ReplyPreview roomID={roomID} eventID={replyTo} />}
        <MessageContent roomID={roomID} evt={evt} content={content} localContent={localContent} senderName={name} />
        {lastEdit && !evt.redacted_by && (
          <button
            type="button"
            onClick={() => openMessageDialog('edits', evt.rowid)}
            title="Show edit history"
            className="edited-marker text-[11px] text-muted hover:text-fg hover:underline"
          >
            (edited)
          </button>
        )}
        {failed && <SendFailure evt={evt} />}
        {evt.reactions && <Reactions roomID={roomID} evt={evt} />}
        {!threadRoot && !isPendingEvent(evt) && <ThreadSummary eventID={evt.event_id} />}
      </div>
      {!isPendingEvent(evt) && <MessageActions roomID={roomID} evt={evt} own={own} threadRoot={threadRoot} hasEdits={!!lastEdit} />}
    </div>
  )
}

function SendFailure({ evt }: { evt: TimelineEvent }) {
  const [retrying, setRetrying] = useState(false)
  const retry = async () => {
    if (!evt.transaction_id) return
    setRetrying(true)
    try {
      await client.resendEvent(evt.transaction_id)
    } catch (err) {
      showToast(`Couldn't resend: ${errorText(err)}`)
    } finally {
      setRetrying(false)
    }
  }
  return (
    <p className="send-failure flex flex-wrap items-center gap-x-2 text-xs text-danger">
      <span>Failed to send: {evt.send_error}</span>
      {evt.transaction_id && (
        <button type="button" onClick={() => void retry()} disabled={retrying} className="font-medium underline disabled:opacity-60">
          {retrying ? 'Retrying…' : 'Retry'}
        </button>
      )}
    </p>
  )
}

/** Avatar or name that opens the user's profile; hovering shows their user ID. */
function ProfileButton({
  userID,
  name,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { userID: UserID; name: string }) {
  return (
    <button
      type="button"
      title={userID}
      aria-label={`Show profile of ${name}`}
      onClick={() => openProfile(userID)}
      className={cn('outline-none focus-visible:ring-2 focus-visible:ring-accent', className)}
      {...props}
    >
      {children}
    </button>
  )
}

interface ContentProps {
  evt: TimelineEvent
  content: MessageEventContent
  localContent?: LocalContent
  senderName: string
}

function MessageContent({ roomID, evt, content, localContent, senderName }: ContentProps & { roomID: RoomID }) {
  if (evt.redacted_by) return <RedactedNotice roomID={roomID} evt={evt} />
  if (evt.type === 'm.room.encrypted') {
    return (
      <p className="message-body flex items-center gap-1.5 text-sm italic text-muted">
        <LockKeyhole size={13} />
        {evt.decryption_error ? `Unable to decrypt: ${evt.decryption_error}` : 'Waiting for encryption keys'}
      </p>
    )
  }
  const msgtype = evt.type === 'm.sticker' ? 'm.sticker' : content.msgtype
  switch (msgtype) {
    case 'm.image':
    case 'm.sticker':
    case 'm.video':
    case 'm.audio':
    case 'm.file': {
      const hasCaption = !!content.filename && content.body !== content.filename
      return (
        <>
          {hasCaption && <TextBody content={content} localContent={localContent} msgtype="m.text" senderName={senderName} />}
          <MediaContent content={content} msgtype={msgtype} />
        </>
      )
    }
    default:
      return <TextBody content={content} localContent={localContent} msgtype={msgtype} senderName={senderName} />
  }
}

/** "Message deleted", naming who deleted it (when not the sender) and why, from the redaction event. */
function RedactedNotice({ roomID, evt }: { roomID: RoomID; evt: TimelineEvent }) {
  const redactedBy = evt.redacted_by
  const redaction = useChat(s => {
    const rowid = redactedBy ? s.eventIDs[redactedBy] : undefined
    return rowid === undefined ? undefined : s.events[rowid]
  })
  const redacter = useMember(roomID, redaction?.sender)

  useEffect(() => {
    if (redactedBy && !redaction) void fetchEvent(roomID, redactedBy)
  }, [roomID, redactedBy, redaction])

  const reason = typeof redaction?.content.reason === 'string' ? redaction.content.reason.trim() : ''
  const by = redaction && redaction.sender !== evt.sender ? displayNameOf(redaction.sender, redacter) : undefined

  return (
    <p className="message-body redacted-notice flex flex-wrap items-center gap-x-1.5 text-sm text-muted">
      <Trash2 size={13} className="shrink-0" />
      <span className="italic">Message deleted</span>
      {by && (
        <span title={redaction?.sender}>
          by <span className="font-medium text-fg/80">{by}</span>
        </span>
      )}
      {redaction && (
        <time className="text-xs" title={formatFull(redaction.timestamp)}>
          · {formatTime(redaction.timestamp)}
        </time>
      )}
      {reason && (
        <span className="w-full text-[13px]">
          Reason: <span className="text-fg/80">{reason}</span>
        </span>
      )}
    </p>
  )
}

interface TextBodyProps extends Omit<ContentProps, 'evt'> {
  msgtype: string
  className?: string
  /** Emoji-only messages render large, except where space is tight (reply previews). */
  allowBigEmoji?: boolean
}

/**
 * Clicks inside formatted message text: matrix.to and matrix: links are followed inside the client,
 * and embedded images (not custom emoji) open in the lightbox.
 */
function handleMessageBodyClick(e: MouseEvent<HTMLElement>) {
  const target = e.target as HTMLElement
  const link = target.closest('a')
  if (link) {
    const href = link.getAttribute('href') ?? ''
    const matrixTarget = parseMatrixURI(href)
    // Modified clicks on https matrix.to links keep the browser default (e.g. open in a new tab).
    const modified = e.ctrlKey || e.metaKey || e.shiftKey || e.altKey
    if (!matrixTarget || (modified && !href.toLowerCase().startsWith('matrix:'))) return
    e.preventDefault()
    e.stopPropagation()
    void openMatrixTarget(matrixTarget)
    return
  }
  if (target.tagName !== 'IMG' || target.hasAttribute('data-mx-emoticon')) return
  const src = (target as HTMLImageElement).currentSrc || target.getAttribute('src')
  if (!src) return
  e.preventDefault()
  e.stopPropagation()
  openLightbox(src, target.getAttribute('alt') || target.getAttribute('title') || undefined)
}

function TextBody({ content, localContent, msgtype, senderName, className, allowBigEmoji = true }: TextBodyProps) {
  const html = localContent?.sanitized_html
  return (
    <div
      className={cn('message-body text-[15px]', msgtype === 'm.notice' && 'text-muted', className)}
      data-big-emoji={(allowBigEmoji && localContent?.big_emoji) || undefined}
      onClick={html ? handleMessageBodyClick : undefined}
    >
      {msgtype === 'm.emote' && <span className="font-medium">* {senderName} </span>}
      {html ? (
        <div className="contents" dangerouslySetInnerHTML={{ __html: sanitizeHTML(html) }} />
      ) : (
        <span className="whitespace-pre-wrap">{content.body}</span>
      )}
    </div>
  )
}

function fitSize(w: number | undefined, h: number | undefined, maxW: number, maxH: number) {
  if (!w || !h) return undefined
  const scale = Math.min(1, maxW / w, maxH / h)
  return { width: Math.round(w * scale), height: Math.round(h * scale) }
}

/** Original media URL, plus the sender-provided thumbnail for inline display where it makes sense. */
function mediaSources(content: MessageEventContent) {
  const info = content.info ?? {}
  const url = mediaURL(content.file?.url ?? content.url, !!content.file)
  const thumbnail = info.thumbnail_file ? mediaURL(info.thumbnail_file.url, true) : mediaURL(info.thumbnail_url)
  const inline = thumbnail && info.mimetype !== 'image/gif' ? thumbnail : url
  return { url, thumbnail, inline }
}

/** URLs that have finished loading once, so remounted rows (scrolling back) don't fade them in again. */
const loadedImages = new Set<string>()

/** An image that fades in over its blurhash placeholder once loaded. */
function FadeInImage({ src, alt, placeholder }: { src: string; alt: string; placeholder?: string }) {
  const [loaded, setLoaded] = useState(() => loadedImages.has(src))
  const [failed, setFailed] = useState(false)
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      onLoad={() => {
        loadedImages.add(src)
        setLoaded(true)
      }}
      onError={() => setFailed(true)}
      className={cn(
        'size-full object-cover transition-opacity duration-300 ease-out',
        // Without a placeholder there's nothing to fade from, so show the image as it loads.
        loaded || !placeholder || failed ? 'opacity-100' : 'opacity-0',
      )}
    />
  )
}

const placeholderStyle = (placeholder: string | undefined): CSSProperties | undefined =>
  placeholder ? { backgroundImage: `url(${placeholder})`, backgroundSize: '100% 100%' } : undefined

function MediaContent({ content, msgtype }: { content: MessageEventContent; msgtype: string }) {
  const { url, thumbnail, inline } = mediaSources(content)
  const info = content.info ?? {}
  if (!url) return <p className="text-sm italic text-muted">Invalid media</p>

  const placeholder = blurhashDataURL(blurhashOf(info))
  const isSticker = msgtype === 'm.sticker'
  const size = fitSize(info.w, info.h, isSticker ? 180 : 420, isSticker ? 180 : 340)
  const boxStyle = size ? { width: size.width, aspectRatio: `${size.width} / ${size.height}` } : undefined
  const name = content.filename ?? content.body

  switch (msgtype) {
    case 'm.image':
    case 'm.sticker': {
      const src = isSticker ? url : (inline ?? url)
      return (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={e => {
            // Plain clicks open the lightbox; middle/modifier clicks keep opening a new tab.
            if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return
            e.preventDefault()
            openLightbox(url, name, { placeholder, width: info.w, height: info.h })
          }}
          className={cn(
            'media-image mt-1 block max-w-full cursor-zoom-in overflow-hidden rounded-lg',
            !isSticker && 'border border-border bg-surface',
          )}
          style={{ ...(boxStyle ?? { maxWidth: 420 }), ...placeholderStyle(placeholder) }}
        >
          <FadeInImage key={src} src={src} alt={content.body} placeholder={placeholder} />
        </a>
      )
    }
    case 'm.video':
      return (
        <video
          src={url}
          poster={thumbnail}
          controls
          preload="none"
          className={cn('media-video mt-1 max-w-full rounded-lg', !placeholder && 'bg-black')}
          style={{ ...(boxStyle ?? { width: 420 }), ...placeholderStyle(placeholder) }}
        />
      )
    case 'm.audio':
      return <audio src={url} controls preload="none" className="media-audio mt-1 w-80 max-w-full" />
    default:
      return (
        <a
          href={url}
          download={name}
          className="media-file mt-1 flex w-fit max-w-full items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2 transition-colors hover:bg-hover"
        >
          <FileText size={22} className="shrink-0 text-accent" />
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">{name}</span>
            <span className="block text-xs text-muted">{[formatBytes(info.size), info.mimetype].filter(Boolean).join(' · ')}</span>
          </span>
        </a>
      )
  }
}

function ReplyPreview({ roomID, eventID }: { roomID: RoomID; eventID: EventID }) {
  const evt = useChat(s => {
    const rowid = s.eventIDs[eventID]
    return rowid === undefined ? undefined : s.events[rowid]
  })
  const member = useMember(roomID, evt?.sender)
  const lastEdit = useChat(s => (evt?.last_edit_rowid ? s.events[evt.last_edit_rowid] : undefined))
  useEffect(() => {
    if (!evt) void fetchEvent(roomID, eventID)
  }, [evt, roomID, eventID])

  if (!evt) {
    return (
      <div className="reply-preview my-1 rounded-md border-l-2 border-border bg-surface/60 px-2.5 py-1 text-[13px] text-muted">
        Loading reply…
      </div>
    )
  }

  const name = displayNameOf(evt.sender, member)
  const color = userColor(evt.sender)
  const jump = () => jumpToEvent(roomID, eventID)

  return (
    <div
      role="button"
      tabIndex={0}
      title="Jump to message"
      onClick={e => {
        // Links inside the quoted message keep working.
        if ((e.target as HTMLElement).closest('a')) return
        jump()
      }}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          jump()
        }
      }}
      className="reply-preview my-1 flex min-w-0 cursor-pointer flex-col gap-0.5 rounded-md border-l-2 bg-surface/60 py-1 pl-2.5 pr-3 text-[13px] outline-none transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-accent"
      style={{ borderColor: color }}
    >
      <span className="flex min-w-0 items-center gap-1.5" title={evt.sender}>
        <Avatar mxc={member?.avatar_url} id={evt.sender} name={name} size={16} />
        <span className="truncate font-medium" style={{ color }}>
          {name}
        </span>
      </span>
      <ReplyBody evt={evt} lastEdit={lastEdit} senderName={name} />
    </div>
  )
}

function ReplyBody({ evt, lastEdit, senderName }: { evt: TimelineEvent; lastEdit?: TimelineEvent; senderName: string }) {
  if (evt.redacted_by) return <span className="italic text-muted">Message deleted</span>
  if (evt.type === 'm.room.encrypted') return <span className="italic text-muted">Encrypted message</span>
  const { content, localContent } = displayContent(evt, lastEdit)
  const msgtype = evt.type === 'm.sticker' ? 'm.sticker' : content.msgtype

  if (msgtype === 'm.image' || msgtype === 'm.sticker') {
    const { inline } = mediaSources(content)
    const hasCaption = !!content.filename && content.body !== content.filename
    return (
      <span className="flex flex-col items-start gap-1">
        {inline && <img src={inline} alt={content.body} loading="lazy" className="max-h-28 max-w-48 rounded object-cover" />}
        {hasCaption && <TextBody content={content} localContent={localContent} msgtype="m.text" senderName={senderName} className="text-[13px] text-fg/80" allowBigEmoji={false} />}
      </span>
    )
  }
  if (msgtype === 'm.video' || msgtype === 'm.audio' || msgtype === 'm.file') {
    return (
      <span className="flex items-center gap-1.5 text-muted">
        <FileText size={13} /> {content.filename ?? content.body}
      </span>
    )
  }
  return <TextBody content={content} localContent={localContent} msgtype={msgtype} senderName={senderName} className="text-[13px] text-fg/80" allowBigEmoji={false} />
}

function ThreadSummary({ eventID }: { eventID: EventID }) {
  const count = useChat(s => s.threads[eventID]?.length ?? 0)
  if (!count) return null
  return (
    <button
      type="button"
      onClick={() => openThread(eventID)}
      className="thread-summary mt-1 flex w-fit items-center gap-1.5 rounded-lg border border-border bg-surface px-2 py-1 text-xs font-medium text-accent transition-colors hover:bg-hover"
    >
      <MessagesSquare size={13} />
      {count} {count === 1 ? 'reply' : 'replies'}
    </button>
  )
}

const TOOLTIP_NAME_LIMIT = 12

function Reactions({ roomID, evt }: { roomID: RoomID; evt: TimelineEvent }) {
  const ownUserID = useChat(selectOwnUserID)
  const details = useReactionDetails(s => s.entries[evt.event_id])
  const byKey = details?.signature === reactionSignature(evt) ? details.byKey : undefined
  const entries = Object.entries(evt.reactions ?? {})
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
  if (!entries.length) return null

  // Clicking your own reaction removes it; otherwise it adds one.
  const toggle = async (key: string) => {
    try {
      const reactors = isPendingEvent(evt) ? undefined : (await loadReactionDetails(roomID, evt))[key]
      const mine = reactors?.find(reactor => reactor.userID === ownUserID)
      if (mine) await client.redactEvent(roomID, mine.eventID)
      else await client.sendReaction(roomID, evt.event_id, key)
    } catch (err) {
      showToast(`Couldn't update the reaction: ${errorText(err)}`)
    }
  }

  return (
    <div className="reactions mt-1 flex flex-wrap gap-1">
      {entries.map(([key, count]) => (
        <ReactionChip
          key={key}
          roomID={roomID}
          evt={evt}
          reactionKey={key}
          count={count}
          reactors={byKey?.[key]}
          own={!!byKey?.[key]?.some(reactor => reactor.userID === ownUserID)}
          onToggle={() => void toggle(key)}
        />
      ))}
    </div>
  )
}

interface ReactionChipProps {
  roomID: RoomID
  evt: TimelineEvent
  reactionKey: string
  count: number
  reactors?: Reactor[]
  own: boolean
  onToggle: () => void
}

const NO_NAMES: string[] = []

function ReactionChip({ roomID, evt, reactionKey, count, reactors, own, onToggle }: ReactionChipProps) {
  const names = useChat(
    useShallow(s => {
      if (!reactors) return NO_NAMES
      const room = s.rooms[roomID]
      return reactors.slice(0, TOOLTIP_NAME_LIMIT).map(({ userID }) => {
        const rowid = room?.state['m.room.member']?.[userID]
        return displayNameOf(userID, rowid === undefined ? undefined : (s.events[rowid]?.content as { displayname?: unknown }))
      })
    }),
  )
  const extra = reactors ? reactors.length - names.length : 0
  const label = reactionKey.startsWith('mxc://') ? 'this emoji' : reactionKey

  return (
    <Tooltip.Root delayDuration={250} onOpenChange={open => open && loadReactionDetails(roomID, evt).catch(() => {})}>
      <Tooltip.Trigger asChild>
        <button
          type="button"
          onClick={onToggle}
          data-own={own || undefined}
          aria-label={`${reactionKey} ${count}${own ? ', including you' : ''}`}
          className="reaction-chip flex h-6 items-center gap-1 rounded-full px-2 text-xs transition hover:brightness-110"
        >
          {reactionKey.startsWith('mxc://') ? <img src={mediaURL(reactionKey)} alt="" className="size-4 object-contain" /> : <span>{reactionKey}</span>}
          <span className="tabular-nums text-muted">{count}</span>
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side="top"
          sideOffset={6}
          className="tooltip z-50 max-w-72 rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-xs text-fg shadow-lg"
        >
          {reactors
            ? `${formatNames(extra > 0 ? [...names, `${extra} more`] : names)} reacted with ${label}`
            : 'Loading…'}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}

async function copyToClipboard(text: string, success: string) {
  try {
    await navigator.clipboard.writeText(text)
    showToast(success)
  } catch (err) {
    showToast(`Couldn't copy: ${errorText(err)}`)
  }
}

function react(roomID: RoomID, eventID: EventID, key: string) {
  client.sendReaction(roomID, eventID, key).catch(err => showToast(`Couldn't react: ${errorText(err)}`))
}

function ActionButton({ label, className, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className={cn(
        'grid size-8 place-items-center rounded-md text-muted transition-colors hover:bg-hover hover:text-fg data-[state=open]:bg-hover data-[state=open]:text-fg',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
}

const menuItemClass =
  'flex cursor-default select-none items-center gap-2.5 rounded-md px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-hover'

function MenuItem({ icon, onSelect, danger, children }: { icon: ReactNode; onSelect: () => void; danger?: boolean; children: ReactNode }) {
  return (
    <DropdownMenu.Item onSelect={onSelect} className={cn(menuItemClass, danger && 'text-danger')}>
      <span className={cn('text-muted', danger && 'text-danger')}>{icon}</span>
      {children}
    </DropdownMenu.Item>
  )
}

interface MessageActionsProps {
  roomID: RoomID
  evt: TimelineEvent
  own: boolean
  threadRoot?: EventID
  hasEdits: boolean
}

function MessageActions({ roomID, evt, own, threadRoot, hasEdits }: MessageActionsProps) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const redacted = !!evt.redacted_by
  const msgtype = evt.content.msgtype as string | undefined
  const editable = own && !redacted && evt.type === 'm.room.message' && EDITABLE_MSGTYPES.has(msgtype ?? '')
  const hasReactions = Object.values(evt.reactions ?? {}).some(count => count > 0)
  const scope = threadRoot ?? null
  // Dialogs open after the menu has closed, so focus handling doesn't fight between them.
  const openDialog = (type: Parameters<typeof openMessageDialog>[0]) => requestAnimationFrame(() => openMessageDialog(type, evt.rowid))

  const copyText = () => {
    const { events } = useChat.getState()
    const { content } = displayContent(evt, evt.last_edit_rowid ? events[evt.last_edit_rowid] : undefined)
    void copyToClipboard(content.body ?? '', 'Message copied')
  }

  return (
    <div
      role="toolbar"
      aria-label="Message actions"
      className={cn(
        'message-actions absolute -top-4 right-4 z-10 items-center gap-0.5 rounded-lg border border-border bg-surface p-0.5 shadow-md',
        pickerOpen || menuOpen ? 'flex' : 'hidden group-focus-within:flex group-hover:flex',
      )}
    >
      {QUICK_REACTIONS.map(key => (
        <ActionButton key={key} label={`React with ${key}`} onClick={() => react(roomID, evt.event_id, key)}>
          <span className="text-base leading-none">{key}</span>
        </ActionButton>
      ))}
      <ReactionPicker open={pickerOpen} onOpenChange={setPickerOpen} onSelect={key => react(roomID, evt.event_id, key)}>
        <ActionButton label="Add reaction">
          <SmilePlus size={16} />
        </ActionButton>
      </ReactionPicker>
      <span aria-hidden className="mx-0.5 h-5 w-px bg-border" />
      <ActionButton label="Reply" onClick={() => useUI.setState({ replyTo: evt.rowid, editing: null, composerScope: scope })}>
        <Reply size={16} />
      </ActionButton>
      {!threadRoot && (
        <ActionButton label="Reply in thread" onClick={() => openThread(evt.event_id)}>
          <MessagesSquare size={16} />
        </ActionButton>
      )}
      {editable && (
        <ActionButton label="Edit" onClick={() => useUI.setState({ editing: evt.rowid, replyTo: null, composerScope: scope })}>
          <Pencil size={15} />
        </ActionButton>
      )}
      <DropdownMenu.Root open={menuOpen} onOpenChange={setMenuOpen} modal={false}>
        <DropdownMenu.Trigger asChild>
          <ActionButton label="More options">
            <Ellipsis size={16} />
          </ActionButton>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={6}
            collisionPadding={12}
            className="message-menu z-50 min-w-52 rounded-lg border border-border bg-surface p-1 text-fg shadow-xl"
          >
            <MenuItem icon={<Link2 size={15} />} onSelect={() => void copyToClipboard(`https://matrix.to/#/${roomID}/${evt.event_id}`, 'Link copied')}>
              Share link
            </MenuItem>
            {!redacted && typeof evt.content.body === 'string' && (
              <MenuItem icon={<Copy size={15} />} onSelect={copyText}>
                Copy text
              </MenuItem>
            )}
            {hasReactions && (
              <MenuItem icon={<Users size={15} />} onSelect={() => openDialog('reactions')}>
                Reactions
              </MenuItem>
            )}
            {hasEdits && !redacted && (
              <MenuItem icon={<History size={15} />} onSelect={() => openDialog('edits')}>
                Edit history
              </MenuItem>
            )}
            {redacted && (
              <MenuItem icon={<Undo2 size={15} />} onSelect={() => openDialog('original')}>
                View original
              </MenuItem>
            )}
            <MenuItem icon={<Code size={15} />} onSelect={() => openDialog('source')}>
              View source
            </MenuItem>
            {own && !redacted && (
              <>
                <DropdownMenu.Separator className="my-1 h-px bg-border" />
                <MenuItem icon={<Trash2 size={15} />} onSelect={() => openDialog('delete')} danger>
                  Delete
                </MenuItem>
              </>
            )}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  )
}
