import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import * as Tooltip from '@radix-ui/react-tooltip'
import {
  Code,
  Copy,
  Ellipsis,
  Eye,
  FileText,
  Film,
  Image as ImageIcon,
  History,
  Link2,
  LockKeyhole,
  MessagesSquare,
  Pencil,
  Pin,
  PinOff,
  Reply,
  SmilePlus,
  SquareTerminal,
  Sticker,
  Trash2,
  Undo2,
  Users,
  X,
} from 'lucide-react'
import { motion } from 'motion/react'
import { memo, useEffect, useState, type ButtonHTMLAttributes, type CSSProperties, type MouseEvent, type ReactNode } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { client } from '@/api/client'
import { avatarURL, mediaURL, userColorIndex } from '@/api/media'
import type {
  ContentURI,
  EventID,
  EventRowID,
  LocalContent,
  MediaInfo,
  MemberEventContent,
  MessageEventContent,
  RelatesTo,
  RoomID,
  UserID,
} from '@/api/types'
import { cn } from '@/lib/cn'
import { parseMatrixURI } from '@/lib/matrixURI'
import { formatBytes, formatDay, formatFull, formatNames, formatTime } from '@/lib/format'
import { dismissGomuksNotice, fetchEvent, selectOwnUserID, useChat } from '@/store/chat'
import { GOMUKS_SENDER } from '@/store/commands'
import {
  describeStateEvent,
  displayContent,
  hasNoRenderer,
  displayNameOf,
  fallbackDisplayName,
  isFailedSend,
  isMessageLike,
  isPendingEvent,
  previewText,
  type TimelineEvent,
} from '@/store/events'
import { customEmojiShortcode } from '@/store/emoji'
import { useMember } from '@/store/hooks'
import { useCanRedact } from '@/store/permissions'
import { setPinned, useCanPin, useIsPinned } from '@/store/pins'
import { usePreference } from '@/store/preferences'
import type { PickerSelection } from '@/ui/emoji/items'
import { jumpToEvent, openMatrixTarget } from '@/store/navigation'
import { loadReactionDetails, reactionSignature, useReactionDetails, type Reactor } from '@/store/reactions'
import { openLightbox, openMessageDialog, openProfile, openThread, showToast, useUI } from '@/store/ui'
import { blurhashDataURL, blurhashOf } from '@/ui/blurhash'
import { sanitizeHTML } from '@/ui/html'
import { Avatar } from '@/ui/primitives'
import { ReactionPicker } from './ReactionPicker'
import { ReadReceipts } from './ReadReceipts'

// Fully qualified (with U+FE0F where needed), matching the picker, gomuks and Element, so the same
// reaction from different clients is counted together.
const QUICK_REACTIONS = ['👍️', '❤️', '😂']
const EDITABLE_MSGTYPES = new Set(['m.text', 'm.emote', 'm.notice'])

/** A row mounting within this long after it arrived animates in; later remounts (scrolling) don't. */
export const ENTER_ANIMATION_WINDOW = 1500

interface RowProps {
  roomID: RoomID
  rowid: EventRowID
  compact: boolean
  /** The next row is a compact continuation of this one (same sender, within the group window). */
  continued?: boolean
  newDay: boolean
  /** Set when the row is rendered inside a thread panel. */
  threadRoot?: EventID
  /** Other users whose read receipt is on this row (main timeline only). */
  readers?: UserID[]
  /** When the row arrived while the room was open (ms timestamp), for the entrance animation. */
  arrivedAt?: number
}

export const TimelineRow = memo(function TimelineRow({ roomID, rowid, compact, continued, newDay, threadRoot, readers, arrivedAt }: RowProps) {
  const evt = useChat(s => s.events[rowid])
  const ownUserID = useChat(selectOwnUserID)
  // Decided once on mount: flipping it later (the window passing on a re-render) would drop the animation
  // target mid-way and could leave the row stuck at its invisible starting state.
  const [entering] = useState(() => arrivedAt !== undefined && Date.now() - arrivedAt < ENTER_ANIMATION_WINDOW)
  if (!evt) return null
  const own = evt.sender === ownUserID

  return (
    <motion.div
      // New messages rise into place (own ones grow from the right, others from the left) instead of popping in.
      initial={entering ? { opacity: 0, y: 16, scale: 0.97, filter: 'blur(4px)' } : false}
      animate={entering ? { opacity: 1, y: 0, scale: 1, filter: 'blur(0px)', transitionEnd: { filter: 'none' } } : undefined}
      transition={{ type: 'spring', stiffness: 420, damping: 32, mass: 0.7 }}
      style={{ transformOrigin: own ? '100% 100%' : '0% 100%' }}
    >
      {newDay && <DaySeparator ts={evt.timestamp} />}
      {evt.sender === GOMUKS_SENDER ? (
        <GomuksNoticeRow roomID={roomID} evt={evt} compact={compact} />
      ) : hasNoRenderer(evt) ? (
        <HiddenRow roomID={roomID} evt={evt} own={own} threadRoot={threadRoot} readers={readers} />
      ) : isMessageLike(evt) ? (
        <MessageRow roomID={roomID} evt={evt} compact={compact} continued={continued} own={own} threadRoot={threadRoot} readers={readers} />
      ) : (
        <StateRow roomID={roomID} evt={evt} own={own} threadRoot={threadRoot} readers={readers} />
      )}
    </motion.div>
  )
})

/** A reply from gomuks to a command: only shown here, never sent, and dismissable. */
function GomuksNoticeRow({ roomID, evt, compact }: { roomID: RoomID; evt: TimelineEvent; compact: boolean }) {
  const html = evt.local_content?.sanitized_html ?? ''
  return (
    <div className={cn('gomuks-notice group relative flex gap-3 px-4', compact ? 'py-px' : 'pb-px pt-2')} data-rowid={evt.rowid}>
      <div className="flex w-10 shrink-0 justify-end">
        {compact ? (
          <time title={formatFull(evt.timestamp)} className="invisible pt-[5px] text-[10px] tabular-nums text-muted group-hover:visible">
            {formatTime(evt.timestamp)}
          </time>
        ) : (
          <span className="mt-0.5 grid size-10 place-items-center rounded-full bg-surface-2 text-muted" aria-hidden>
            <SquareTerminal size={20} />
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        {!compact && (
          <div className="flex items-baseline gap-2 leading-tight">
            <span className="sender-name text-sm font-semibold text-muted">gomuks</span>
            <span className="rounded bg-surface-2 px-1 text-[10px] font-medium uppercase tracking-wide text-muted">Only visible to you</span>
            <time title={formatFull(evt.timestamp)} className="shrink-0 text-[11px] tabular-nums text-muted">
              {formatTime(evt.timestamp)}
            </time>
          </div>
        )}
        <div className="message-body break-words text-sm" dangerouslySetInnerHTML={{ __html: sanitizeHTML(html) }} />
      </div>
      <button
        type="button"
        aria-label="Dismiss"
        title="Dismiss"
        onClick={() => dismissGomuksNotice(roomID, evt.rowid)}
        className="invisible absolute right-4 top-1 rounded-md p-1 text-muted hover:bg-hover hover:text-fg group-hover:visible focus-visible:visible"
      >
        <X size={14} />
      </button>
    </div>
  )
}

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

/** Marks where the sender's name goes when a generic state description is split around a profile link. */
const SENDER_MARK = '\0'

/**
 * Name of the user a state event is about. A rename reads "Old changed their name to New", so for profile
 * changes the previous name leads; otherwise the name in the event, then the current member name.
 */
function stateSubjectName(evt: TimelineEvent, member: { displayname?: unknown } | undefined): string {
  if (!evt.state_key) return ''
  const prev = evt.unsigned.prev_content?.displayname
  const current = evt.type === 'm.room.member' ? evt.content.displayname : undefined
  const profileChange = evt.type === 'm.room.member' && evt.unsigned.prev_content?.membership === 'join' && evt.content.membership === 'join'
  const pick = [profileChange ? prev : current, profileChange ? current : prev, member?.displayname].find(
    (name): name is string => typeof name === 'string' && !!name.trim(),
  )
  return pick ?? fallbackDisplayName(evt.state_key)
}

/** A user's mini avatar and name, opening their profile. */
function UserLink({ userID, name, avatar }: { userID: UserID; name: string; avatar?: ContentURI }) {
  return (
    <button
      type="button"
      onClick={() => openProfile(userID)}
      title={userID}
      className="group/user inline-flex max-w-full items-center gap-1 align-middle font-medium"
      style={{ color: userColor(userID) }}
    >
      <Avatar mxc={avatar} id={userID} name={name} size={16} className="shrink-0" />
      <span className="truncate group-hover/user:underline">{name}</span>
    </button>
  )
}

function AvatarThumb({ mxc, label }: { mxc?: ContentURI; label: string }) {
  const thumbnail = avatarURL(mxc)
  const full = mediaURL(mxc)
  if (!thumbnail || !full) return <span className="italic">an image</span>
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={() => openLightbox(full, label)}
      className="mx-0.5 inline-block size-6 overflow-hidden rounded-full align-middle ring-1 ring-border transition hover:scale-110 hover:ring-accent"
    >
      <img src={thumbnail} alt="" loading="lazy" draggable={false} className="size-full object-cover" />
    </button>
  )
}

const Quoted = ({ children }: { children: ReactNode }) => <span className="font-medium text-fg/90">{children}</span>

interface DescriptionProps {
  evt: TimelineEvent
  senderName: string
  senderAvatar?: ContentURI
  subjectName: string
}

function MemberDescription({ evt, senderName, senderAvatar, subjectName }: DescriptionProps) {
  const content = evt.content as Partial<MemberEventContent>
  const prev = evt.unsigned.prev_content as Partial<MemberEventContent> | undefined
  const subjectID = evt.state_key ?? evt.sender
  // The avatar from the event itself (their avatar at the time), matching the name shown. Profile changes
  // and leaves use the previous one, like the name.
  const profileChange = prev?.membership === 'join' && content.membership === 'join'
  const subjectAvatar = (profileChange ? prev?.avatar_url : undefined) ?? content.avatar_url ?? prev?.avatar_url
  const sender = <UserLink userID={evt.sender} name={senderName} avatar={evt.sender === subjectID ? subjectAvatar : senderAvatar} />
  const subject = <UserLink userID={subjectID} name={subjectName} avatar={subjectAvatar} />
  const reason =
    typeof content.reason === 'string' && content.reason.trim() ? (
      <>
        {' '}
        (reason: <Quoted>{content.reason.trim()}</Quoted>)
      </>
    ) : null

  switch (content.membership) {
    case 'join': {
      if (prev?.membership !== 'join') return <>{subject} joined the room</>
      const changes: ReactNode[] = []
      if (prev.displayname !== content.displayname) {
        if (content.displayname && prev.displayname) {
          changes.push(
            <>
              changed their name from <Quoted>{prev.displayname}</Quoted> to <Quoted>{content.displayname}</Quoted>
            </>,
          )
        } else if (content.displayname) {
          changes.push(
            <>
              set their name to <Quoted>{content.displayname}</Quoted>
            </>,
          )
        } else {
          changes.push(
            <>
              removed their name <Quoted>{prev.displayname}</Quoted>
            </>,
          )
        }
      }
      if (prev.avatar_url !== content.avatar_url) {
        if (content.avatar_url && prev.avatar_url) {
          changes.push(
            <>
              changed their avatar from <AvatarThumb mxc={prev.avatar_url} label={`${subjectName}'s previous avatar`} /> to{' '}
              <AvatarThumb mxc={content.avatar_url} label={`${subjectName}'s new avatar`} />
            </>,
          )
        } else if (content.avatar_url) {
          changes.push(
            <>
              set their avatar to <AvatarThumb mxc={content.avatar_url} label={`${subjectName}'s avatar`} />
            </>,
          )
        } else {
          changes.push(
            <>
              removed their avatar <AvatarThumb mxc={prev.avatar_url} label={`${subjectName}'s previous avatar`} />
            </>,
          )
        }
      }
      if (!changes.length) return <>{subject} updated their profile</>
      return (
        <>
          {subject} {changes[0]}
          {changes[1] && <> and {changes[1]}</>}
        </>
      )
    }
    case 'invite':
      return (
        <>
          {sender} invited {subject}
          {reason}
        </>
      )
    case 'leave':
      if (evt.sender === subjectID) {
        if (prev?.membership === 'invite') return <>{subject} rejected the invite{reason}</>
        if (prev?.membership === 'knock') return <>{subject} withdrew their request to join</>
        return <>{subject} left the room{reason}</>
      }
      if (prev?.membership === 'ban') return <>{sender} unbanned {subject}{reason}</>
      if (prev?.membership === 'invite') return <>{sender} withdrew the invite for {subject}{reason}</>
      return <>{sender} removed {subject}{reason}</>
    case 'ban':
      return (
        <>
          {sender} banned {subject}
          {reason}
        </>
      )
    case 'knock':
      return (
        <>
          {subject} asked to join{reason}
        </>
      )
  }
  return <>{subject}'s membership changed</>
}

function StateDescription({ evt, senderName, senderAvatar, subjectName }: DescriptionProps) {
  if (evt.type === 'm.room.member') {
    return <MemberDescription evt={evt} senderName={senderName} senderAvatar={senderAvatar} subjectName={subjectName} />
  }
  const [before, after = ''] = describeStateEvent(evt, SENDER_MARK, subjectName).split(SENDER_MARK)
  const roomAvatar = evt.type === 'm.room.avatar' && typeof evt.content.url === 'string' ? (evt.content.url as ContentURI) : undefined
  return (
    <>
      {before}
      <UserLink userID={evt.sender} name={senderName} avatar={senderAvatar} />
      {after}
      {roomAvatar && (
        <>
          {' to '}
          <AvatarThumb mxc={roomAvatar} label="New room avatar" />
        </>
      )}
    </>
  )
}

interface StateRowProps {
  roomID: RoomID
  evt: TimelineEvent
  own: boolean
  threadRoot?: EventID
  readers?: UserID[]
}

/** Membership, profile and room changes: a sentence with clickable names and images, and the same actions as messages. */
function StateRow({ roomID, evt, own, threadRoot, readers }: StateRowProps) {
  const sender = useMember(roomID, evt.sender)
  const subject = useMember(roomID, evt.state_key)
  const highlighted = useUI(s => s.highlight?.rowid === evt.rowid)
  const senderName = displayNameOf(evt.sender, sender)
  const subjectName = stateSubjectName(evt, subject)

  return (
    <div
      className="state-event group relative flex items-start gap-3 px-4 py-0.5 text-xs text-muted"
      data-rowid={evt.rowid}
      data-highlight={highlighted || undefined}
    >
      <div className="w-10 shrink-0" />
      <div className="min-w-0 flex-1 break-words leading-6">
        <StateDescription
          evt={evt}
          senderName={senderName}
          senderAvatar={typeof sender?.avatar_url === 'string' ? (sender.avatar_url as ContentURI) : undefined}
          subjectName={subjectName}
        />
        {evt.reactions && <Reactions roomID={roomID} evt={evt} />}
      </div>
      <time title={formatFull(evt.timestamp)} className="invisible shrink-0 pt-1 leading-4 tabular-nums group-hover:visible">
        {formatTime(evt.timestamp)}
      </time>
      {readers && readers.length > 0 && (
        <div className="flex shrink-0 self-end pb-0.5">
          <ReadReceipts roomID={roomID} rowid={evt.rowid} readers={readers} />
        </div>
      )}
      {!isPendingEvent(evt) && <MessageActions roomID={roomID} evt={evt} own={own} threadRoot={threadRoot} hasEdits={false} />}
    </div>
  )
}

/**
 * An event the timeline has nothing to say about: a reaction, an edit, a server ACL, a power level
 * change, a custom type. Shown as its bare type (like gomuks web) when "Show hidden events" is on,
 * with the usual actions, so "View source" is still one hover away.
 */
function HiddenRow({ roomID, evt, own, threadRoot, readers }: StateRowProps) {
  const highlighted = useUI(s => s.highlight?.rowid === evt.rowid)

  return (
    <div
      className="state-event group relative flex items-start gap-3 px-4 py-0.5 text-xs text-muted"
      data-rowid={evt.rowid}
      data-highlight={highlighted || undefined}
    >
      <div className="w-10 shrink-0" />
      <div className="min-w-0 flex-1 break-words leading-6">
        <code className="rounded bg-[var(--code-bg)] px-1 py-0.5 font-mono text-[11px]">{`{ "type": ${JSON.stringify(evt.type)} }`}</code>
      </div>
      <time title={formatFull(evt.timestamp)} className="invisible shrink-0 pt-1 leading-4 tabular-nums group-hover:visible">
        {formatTime(evt.timestamp)}
      </time>
      {readers && readers.length > 0 && (
        <div className="flex shrink-0 self-end pb-0.5">
          <ReadReceipts roomID={roomID} rowid={evt.rowid} readers={readers} />
        </div>
      )}
      {!isPendingEvent(evt) && <MessageActions roomID={roomID} evt={evt} own={own} threadRoot={threadRoot} hasEdits={false} />}
    </div>
  )
}

interface MessageRowProps {
  roomID: RoomID
  evt: TimelineEvent
  compact: boolean
  continued?: boolean
  own: boolean
  threadRoot?: EventID
  readers?: UserID[]
}

function MessageRow({ roomID, evt, compact, continued, own, threadRoot, readers }: MessageRowProps) {
  const codeWrap = usePreference('code_block_line_wrap', roomID)
  const inlineImages = usePreference('show_inline_images', roomID)
  const maxImageWidth = usePreference('max_image_width', roomID)
  const smallReplies = usePreference('small_replies', roomID)
  const cardsEnabled = usePreference('message_cards', roomID)
  const pinned = useIsPinned(roomID, evt.event_id)
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
  // Emotes read as narration, like state events, so they stay flat.
  const card = cardsEnabled && content.msgtype !== 'm.emote'

  return (
    <div
      className={cn('chat-message group relative flex gap-3 px-4', compact ? (card ? 'py-0.5' : 'py-px') : card ? 'pb-0.5 pt-2' : 'pb-px pt-2')}
      data-rowid={evt.rowid}
      data-own={own || undefined}
      data-card={card || undefined}
      data-continued={continued || undefined}
      data-pending={pending || undefined}
      data-failed={failed || undefined}
      data-redacted={evt.redacted_by ? true : undefined}
      data-highlight={highlighted || undefined}
      data-code-wrap={codeWrap || undefined}
      data-hide-inline-images={!inlineImages || undefined}
      style={{ '--max-image-width': `${maxImageWidth}px`, '--sender-color': userColor(evt.sender) } as CSSProperties}
    >
      <div className="flex w-10 shrink-0 justify-end">
        {compact ? (
          <time
            title={formatFull(evt.timestamp)}
            className={cn('invisible text-[10px] tabular-nums text-muted group-hover:visible', card ? 'pt-[11px]' : 'pt-[5px]')}
          >
            {formatTime(evt.timestamp)}
          </time>
        ) : (
          <ProfileButton userID={evt.sender} name={name} className="mt-0.5 h-10 rounded-full">
            <Avatar mxc={member?.avatar_url} id={evt.sender} name={name} size={40} />
          </ProfileButton>
        )}
      </div>
      <div className="min-w-0 flex-1">
        {/* Receipts sit beside the message, at its bottom, so they don't add a line of their own. */}
        <div className="flex items-end gap-2">
          <div className={cn('chat-bubble relative', card && 'group/card', pending && 'opacity-60')}>
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
                {pinned && <Pin size={11} className="pinned-marker shrink-0 self-center text-accent" aria-label="Pinned" />}
              </div>
            )}
            {replyTo && <ReplyPreview roomID={roomID} eventID={replyTo} small={smallReplies} />}
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
            {!isPendingEvent(evt) && (
              <MessageActions roomID={roomID} evt={evt} own={own} threadRoot={threadRoot} hasEdits={!!lastEdit} anchored card={card} />
            )}
          </div>
          {readers && readers.length > 0 && (
            <div className="receipts-slot flex shrink-0 pb-0.5">
              <ReadReceipts roomID={roomID} rowid={evt.rowid} readers={readers} />
            </div>
          )}
        </div>
        {evt.reactions && <Reactions roomID={roomID} evt={evt} />}
        {!threadRoot && !isPendingEvent(evt) && <ThreadSummary eventID={evt.event_id} />}
      </div>
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
          <MediaContent roomID={roomID} content={content} msgtype={msgtype} />
          {hasCaption && <TextBody content={content} localContent={localContent} msgtype="m.text" senderName={senderName} className="mt-1" />}
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
  if (target.tagName !== 'IMG' || target.hasAttribute('data-mx-emoticon') || target.classList.contains('hicli-custom-emoji')) return
  const src = (target as HTMLImageElement).currentSrc || target.getAttribute('src')
  if (!src) return
  e.preventDefault()
  e.stopPropagation()
  openLightbox(src, target.getAttribute('alt') || target.getAttribute('title') || undefined)
}

function TextBody({ content, localContent, msgtype, senderName, className, allowBigEmoji = true }: TextBodyProps) {
  const html = localContent?.sanitized_html
  const formattedBody = (content as { formatted_body?: unknown }).formatted_body
  return (
    <div
      className={cn('message-body text-[15px]', className)}
      data-notice={msgtype === 'm.notice' || undefined}
      data-big-emoji={(allowBigEmoji && localContent?.big_emoji) || undefined}
      onClick={html ? handleMessageBodyClick : undefined}
    >
      {msgtype === 'm.emote' && <span className="font-medium">* {senderName} </span>}
      {html ? (
        <div
          className="contents"
          dangerouslySetInnerHTML={{ __html: sanitizeHTML(html, typeof formattedBody === 'string' ? formattedBody : undefined) }}
        />
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

/** Media revealed while show_media_previews is off, remembered so rows scrolled away and back stay revealed. */
const revealedMedia = new Set<string>()

function formatDuration(ms?: number) {
  if (!ms || ms < 0) return undefined
  const seconds = Math.round(ms / 1000)
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const rest = String(seconds % 60).padStart(2, '0')
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`
}

/** Dimensions, duration, size and type of a media file, as far as the event says. */
function mediaDetails(info: MediaInfo): string[] {
  const type = info.mimetype?.split('/')[1]?.split(/[+;]/)[0]?.toUpperCase()
  return [info.w && info.h ? `${info.w}×${info.h}` : undefined, formatDuration(info.duration), formatBytes(info.size), type].filter(
    (part): part is string => !!part,
  )
}

function MediaKindIcon({ kind, size = 26 }: { kind: 'image' | 'video' | 'sticker'; size?: number }) {
  const Icon = kind === 'video' ? Film : kind === 'sticker' ? Sticker : ImageIcon
  return <Icon size={size} className="shrink-0 text-muted" aria-hidden />
}

function MediaContent({ roomID, content, msgtype }: { roomID: RoomID; content: MessageEventContent; msgtype: string }) {
  const showPreviews = usePreference('show_media_previews', roomID)
  const autoplayGifs = usePreference('autoplay_gifs', roomID)
  const maxWidth = usePreference('max_image_width', roomID)
  const [revealedHere, setRevealedHere] = useState(false)
  const [hovering, setHovering] = useState(false)
  const { url, thumbnail, inline } = mediaSources(content)
  const info = content.info ?? {}
  if (!url) return <p className="text-sm italic text-muted">Invalid media</p>

  const placeholder = blurhashDataURL(blurhashOf(info))
  const isSticker = msgtype === 'm.sticker'
  const maxHeight = Math.max(340, Math.round(maxWidth * 0.8))
  const size = fitSize(info.w, info.h, isSticker ? 180 : maxWidth, isSticker ? 180 : maxHeight)
  const boxStyle = size ? { width: size.width, aspectRatio: `${size.width} / ${size.height}` } : undefined
  const name = content.filename ?? content.body

  // show_media_previews off: nothing is downloaded until the user asks for it. Until then show the
  // blurhash (when the sender included one) and what the event says about the file.
  const revealed = revealedHere || revealedMedia.has(url)
  if (!showPreviews && !revealed && (msgtype === 'm.image' || msgtype === 'm.sticker' || msgtype === 'm.video')) {
    const kind = msgtype === 'm.video' ? 'video' : isSticker ? 'sticker' : 'image'
    const details = mediaDetails(info)
    const label = content.filename || content.body
    return (
      <button
        type="button"
        onClick={() => {
          revealedMedia.add(url)
          setRevealedHere(true)
        }}
        aria-label={`Show ${kind}${label ? `: ${label}` : ''}${details.length ? ` (${details.join(', ')})` : ''}`}
        title={`Show ${kind}`}
        className={cn(
          'media-hidden group/hidden relative mt-1 flex max-w-full flex-col overflow-hidden rounded-lg border border-border text-left outline-none focus-visible:ring-2 focus-visible:ring-accent',
          placeholder ? 'bg-surface' : 'bg-surface-2/60',
        )}
        style={{
          width: Math.max(size?.width ?? Math.min(maxWidth, 320), 220),
          aspectRatio: size ? `${size.width} / ${size.height}` : '4 / 3',
          minHeight: 132,
          ...placeholderStyle(placeholder),
        }}
      >
        <span className="flex flex-1 flex-col items-center justify-center gap-2 p-3">
          {!placeholder && <MediaKindIcon kind={kind} />}
          <span className="flex items-center gap-1.5 rounded-full bg-bg/85 px-3 py-1 text-sm font-medium text-fg shadow-sm backdrop-blur-sm transition-transform group-hover/hidden:scale-105">
            <Eye size={14} /> Show {kind}
          </span>
        </span>
        {(label || details.length > 0) && (
          <span
            className={cn(
              'block w-full px-2.5 pb-2 pt-5 text-xs leading-snug',
              placeholder ? 'bg-linear-to-t from-black/70 to-transparent text-white' : 'text-muted',
            )}
          >
            {label && <span className={cn('block truncate font-medium', !placeholder && 'text-fg')}>{label}</span>}
            {details.length > 0 && <span className="block truncate opacity-90">{details.join(' · ')}</span>}
          </span>
        )}
      </button>
    )
  }

  switch (msgtype) {
    case 'm.image':
    case 'm.sticker': {
      // autoplay_gifs off: a GIF shows its still thumbnail until hovered.
      const pauseGif = info.mimetype === 'image/gif' && !autoplayGifs && !!thumbnail
      const still = pauseGif && !hovering ? thumbnail : undefined
      const src = still ?? (isSticker ? url : (inline ?? url))
      return (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          onMouseEnter={pauseGif ? () => setHovering(true) : undefined}
          onMouseLeave={pauseGif ? () => setHovering(false) : undefined}
          onClick={e => {
            // Plain clicks open the lightbox; middle/modifier clicks keep opening a new tab.
            if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return
            e.preventDefault()
            // The thumbnail's box and pixels, so the viewer can grow out of what was just clicked.
            const rect = e.currentTarget.getBoundingClientRect()
            openLightbox(url, name, {
              placeholder,
              width: info.w,
              height: info.h,
              from: {
                rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
                url: src,
                element: e.currentTarget,
              },
            })
          }}
          className={cn(
            'media-image mt-1 block max-w-full cursor-zoom-in overflow-hidden rounded-lg',
            !isSticker && 'border border-border bg-surface',
          )}
          data-sticker={isSticker || undefined}
          style={{ ...(boxStyle ?? { maxWidth }), ...placeholderStyle(placeholder) }}
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
          style={{ ...(boxStyle ?? { width: Math.min(420, maxWidth) }), ...placeholderStyle(placeholder) }}
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

/** A quoted message (sender, avatar and content); clicking it jumps to the message. Also used by the composer. */
export function ReplyPreview({ roomID, eventID, small }: { roomID: RoomID; eventID: EventID; small?: boolean }) {
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
      <div className="reply-preview my-1 rounded-md border-l-2 border-border bg-[var(--reply-bg)] px-2.5 py-1 text-[13px] text-muted">
        Loading reply…
      </div>
    )
  }

  const name = displayNameOf(evt.sender, member)
  const color = userColor(evt.sender)
  const jump = () => jumpToEvent(roomID, eventID)
  const interactive = {
    role: 'button',
    tabIndex: 0,
    title: 'Jump to message',
    onClick: (e: MouseEvent<HTMLElement>) => {
      // Links inside the quoted message keep working.
      if ((e.target as HTMLElement).closest('a')) return
      jump()
    },
    onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        jump()
      }
    },
  }

  if (small) {
    // Compact (Discord-like) style: one line above the message.
    return (
      <div
        {...interactive}
        className="reply-preview reply-preview-small mb-0.5 flex min-w-0 cursor-pointer items-center gap-1.5 text-[13px] text-muted outline-none transition-colors hover:text-fg focus-visible:ring-2 focus-visible:ring-accent"
      >
        <Reply size={12} className="shrink-0 -scale-x-100" />
        <Avatar mxc={member?.avatar_url} id={evt.sender} name={name} size={14} />
        <span className="shrink-0 font-medium" style={{ color }} title={evt.sender}>
          {name}
        </span>
        <span className="min-w-0 truncate">{lastEdit && !evt.redacted_by ? (displayContent(evt, lastEdit).content.body ?? '') : previewText(evt)}</span>
      </div>
    )
  }

  return (
    <div
      {...interactive}
      className="reply-preview my-1 flex min-w-0 cursor-pointer flex-col gap-0.5 rounded-md border-l-2 bg-[var(--reply-bg)] py-1 pl-2.5 pr-3 text-[13px] outline-none transition-colors hover:bg-[var(--reply-hover-bg)] focus-visible:ring-2 focus-visible:ring-accent"
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
  const showPreviews = usePreference('show_media_previews', evt.room_id)
  if (evt.redacted_by) return <span className="italic text-muted">Message deleted</span>
  if (evt.type === 'm.room.encrypted') return <span className="italic text-muted">Encrypted message</span>
  // Replying to a membership or room change quotes its description.
  if (evt.state_key !== undefined) return <span className="text-muted">{describeStateEvent(evt, senderName, stateSubjectName(evt, undefined))}</span>
  const { content, localContent } = displayContent(evt, lastEdit)
  const msgtype = evt.type === 'm.sticker' ? 'm.sticker' : content.msgtype

  if (msgtype === 'm.image' || msgtype === 'm.sticker') {
    const { url, inline } = mediaSources(content)
    const hasCaption = !!content.filename && content.body !== content.filename
    const info = content.info ?? {}
    // Quoted media obeys show_media_previews too, unless it was already revealed in the timeline.
    const hidden = !showPreviews && !(url && revealedMedia.has(url))
    const placeholder = hidden ? blurhashDataURL(blurhashOf(info)) : undefined
    const thumb = fitSize(info.w, info.h, 120, 64)
    const details = hidden ? mediaDetails(info) : []
    return (
      <span className="flex flex-col items-start gap-1">
        {hidden ? (
          <span className="flex min-w-0 max-w-full items-center gap-2">
            {placeholder ? (
              <span
                aria-hidden
                className="block shrink-0 rounded"
                style={{ width: thumb?.width ?? 64, height: thumb?.height ?? 48, ...placeholderStyle(placeholder) }}
              />
            ) : (
              <MediaKindIcon kind={msgtype === 'm.sticker' ? 'sticker' : 'image'} size={16} />
            )}
            <span className="min-w-0 leading-tight text-muted">
              <span className="block truncate">{content.filename || content.body || (msgtype === 'm.sticker' ? 'Sticker' : 'Image')}</span>
              {details.length > 0 && <span className="block truncate text-[11px]">{details.join(' · ')}</span>}
            </span>
          </span>
        ) : (
          inline && <img src={inline} alt={content.body} loading="lazy" className="max-h-28 max-w-48 rounded object-cover" />
        )}
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
  const custom = reactionKey.startsWith('mxc://')
  const knownShortcode = useChat(s => (custom ? customEmojiShortcode(s, roomID, reactionKey) : undefined))
  const shortcode = knownShortcode ?? reactors?.find(reactor => reactor.shortcode)?.shortcode?.replaceAll(':', '')
  const extra = reactors ? reactors.length - names.length : 0
  const label = custom ? (shortcode ? `:${shortcode}:` : 'a custom emoji') : reactionKey

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
          {custom ? <img src={mediaURL(reactionKey)} alt={label} className="size-4 object-contain" /> : <span>{reactionKey}</span>}
          {count > 1 && <span className="tabular-nums text-muted">{count}</span>}
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

function react(roomID: RoomID, eventID: EventID, key: string, shortcode?: string) {
  client.sendReaction(roomID, eventID, key, shortcode).catch(err => showToast(`Couldn't react: ${errorText(err)}`))
}

function reactWith(roomID: RoomID, eventID: EventID, selection: PickerSelection) {
  if (selection.kind === 'unicode') react(roomID, eventID, selection.text)
  else react(roomID, eventID, selection.emoji.key, selection.emoji.shortcode)
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
  /** Sit at the end of the enclosing positioned box (a message card) instead of the row's right edge. */
  anchored?: boolean
  /** Show on hovering the message card (group/card) rather than anywhere on the row. */
  card?: boolean
}

function MessageActions({ roomID, evt, own, threadRoot, hasEdits, anchored, card }: MessageActionsProps) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const allowedToPin = useCanPin(roomID)
  // Own messages, or anyone's for moderators, as the room's power levels allow.
  const canRedact = useCanRedact(roomID, evt.sender)
  const pinned = useIsPinned(roomID, evt.event_id)
  const togglePin = () => {
    setPinned(roomID, evt.event_id, !pinned).then(
      () => showToast(pinned ? 'Message unpinned' : 'Message pinned'),
      err => showToast(`Couldn't ${pinned ? 'unpin' : 'pin'} the message: ${errorText(err)}`),
    )
  }
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

  const toolbar = (
    <div
      role="toolbar"
      aria-label="Message actions"
      className={cn(
        // Sits above the row, overlapping its top edge by a few pixels: it doesn't cover the row's content
        // (e.g. read receipts on one-line messages), and moving the mouse straight up enters the toolbar
        // without crossing the message above, which would take over the hover.
        'message-actions items-center gap-0.5 rounded-lg border border-border bg-surface p-0.5 shadow-md',
        anchored ? 'pointer-events-auto' : 'absolute bottom-[calc(100%-6px)] right-4 z-10',
        pickerOpen || menuOpen
          ? 'flex'
          : card
            ? 'hidden group-focus-within/card:flex group-hover/card:flex'
            : 'hidden group-focus-within:flex group-hover:flex',
      )}
    >
      {QUICK_REACTIONS.map(key => (
        <ActionButton key={key} label={`React with ${key}`} onClick={() => react(roomID, evt.event_id, key)}>
          <span className="text-base leading-none">{key}</span>
        </ActionButton>
      ))}
      <ReactionPicker roomID={roomID} open={pickerOpen} onOpenChange={setPickerOpen} onSelect={selection => reactWith(roomID, evt.event_id, selection)}>
        <ActionButton label="Add reaction">
          <SmilePlus size={16} />
        </ActionButton>
      </ReactionPicker>
      <span aria-hidden className="mx-0.5 h-5 w-px bg-border" />
      <ActionButton label="Reply" onClick={() => useUI.setState({ replyTo: evt.rowid, editing: null, composerScope: scope })}>
        <Reply size={16} />
      </ActionButton>
      {!threadRoot && evt.state_key === undefined && (
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
            {/* Only offered when the room's power levels allow it; a deleted message can still be unpinned. */}
            {allowedToPin && (pinned || !redacted) && (
              <MenuItem icon={pinned ? <PinOff size={15} /> : <Pin size={15} />} onSelect={togglePin}>
                {pinned ? 'Unpin message' : 'Pin message'}
              </MenuItem>
            )}
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
            {canRedact && !redacted && (
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
  if (!anchored) return toolbar
  // Ends where the card ends, but grows to the right of a card narrower than the toolbar.
  return (
    <div className="pointer-events-none absolute bottom-[calc(100%-6px)] left-0 z-10 flex w-max min-w-full justify-end">{toolbar}</div>
  )
}
