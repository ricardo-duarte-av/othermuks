import type { EventID, MemberEventContent, MessageEventContent, RawDBEvent, RelatesTo, UserID } from '@/api/types'

/** A DB event with decrypted content (if any) moved into type/content. */
export interface TimelineEvent extends RawDBEvent {
  encrypted: boolean
  /** The event as it was sent, before decryption. Only set for decrypted events. */
  original?: { type: string; content: Record<string, unknown> }
}

export function normalizeEvent(raw: RawDBEvent): TimelineEvent {
  if (raw.decrypted && raw.decrypted_type) {
    return {
      ...raw,
      type: raw.decrypted_type,
      content: raw.decrypted,
      encrypted: true,
      original: { type: raw.type, content: raw.content },
    }
  }
  return { ...raw, encrypted: raw.type === 'm.room.encrypted' }
}

/** Local echoes don't have a real event ID until the homeserver accepts them. */
export function isPendingEvent(evt: TimelineEvent): boolean {
  return !evt.event_id || evt.event_id.startsWith('~')
}

/**
 * gomuks marks every local echo with send_error "not sent" and keeps that placeholder even after a
 * successful send_complete; only other values are real failures (same rule as gomuks web).
 */
export function isFailedSend(evt: TimelineEvent): boolean {
  return !!evt.send_error && evt.send_error !== 'not sent'
}

export function localpart(userID: UserID): string {
  return userID.replace(/^@/, '').split(':')[0]
}

/** "@alice:example.org" → "Alice": used when a user has no display name. */
export function fallbackDisplayName(userID: UserID): string {
  const [first = '', ...rest] = Array.from(localpart(userID))
  return first ? first.toUpperCase() + rest.join('') : userID
}

/** A user's display name from their (per-room) member content, or the capitalized localpart. */
export function displayNameOf(userID: UserID, member?: { displayname?: unknown }): string {
  const name = member?.displayname
  return typeof name === 'string' && name.trim() ? name : fallbackDisplayName(userID)
}

/** The event exactly as gomuks delivered it (encrypted type/content, with any decrypted_* fields alongside). */
export function originalEvent(evt: TimelineEvent): Record<string, unknown> {
  const raw: Record<string, unknown> = { ...evt }
  delete raw.encrypted
  delete raw.original
  if (evt.original) {
    raw.type = evt.original.type
    raw.content = evt.original.content
  }
  return raw
}

/** The thread root this event replies in, if any. */
export function threadRootOf(evt: TimelineEvent): EventID | undefined {
  if (evt.relation_type === 'm.thread' && evt.relates_to) return evt.relates_to
  const relation = (evt.content['m.relates_to'] ?? evt.original?.content['m.relates_to']) as RelatesTo | undefined
  return relation?.rel_type === 'm.thread' ? relation.event_id : undefined
}

const STATE_TYPES = new Set([
  'm.room.member',
  'm.room.name',
  'm.room.topic',
  'm.room.avatar',
  'm.room.encryption',
  'm.room.create',
  'm.room.tombstone',
  'm.room.pinned_events',
])

const eventIDList = (value: unknown): string[] => (Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [])
const messageCount = (count: number) => (count === 1 ? 'a message' : `${count} messages`)

/** Consecutive messages from one sender closer together than this share an avatar and name. */
export const GROUP_WINDOW = 60_000

export function isMessageLike(evt: TimelineEvent): boolean {
  return evt.type === 'm.room.message' || evt.type === 'm.sticker' || evt.type === 'm.room.encrypted'
}

/** Timeline visibility preferences (see store/preferences). */
export interface TimelineFilter {
  showHidden: boolean
  showRedacted: boolean
  showMembership: boolean
  showProfileChanges: boolean
}

export const DEFAULT_TIMELINE_FILTER: TimelineFilter = {
  showHidden: true,
  showRedacted: true,
  showMembership: true,
  showProfileChanges: true,
}

const UNREDACTABLE_TYPES = new Set(['m.room.power_levels', 'm.room.create', 'm.room.member'])

/**
 * Events othermuks has no renderer for: an edit (folded into its target), a reaction, a redaction, a
 * server ACL, a power level change, a custom type. They show as their raw type, like gomuks web's
 * HiddenEvent, rather than not at all.
 */
export function hasNoRenderer(evt: TimelineEvent): boolean {
  if (evt.relation_type === 'm.replace') return true
  return !isMessageLike(evt) && !(evt.state_key !== undefined && STATE_TYPES.has(evt.type))
}

/** A member event that changes nothing: it has a renderer, but nothing worth saying (gomuks's rule). */
function isNoOpMemberEvent(evt: TimelineEvent): boolean {
  if (evt.type !== 'm.room.member') return false
  const prev = evt.unsigned.prev_content as Partial<MemberEventContent> | undefined
  return (
    !!prev &&
    prev.membership === evt.content.membership &&
    prev.displayname === evt.content.displayname &&
    prev.avatar_url === evt.content.avatar_url
  )
}

/** What "Show hidden events" covers: nothing to say, or nothing to say it with. */
function isHiddenEvent(evt: TimelineEvent): boolean {
  return isNoOpMemberEvent(evt) || hasNoRenderer(evt)
}

/**
 * Whether an event gets its own row in the main timeline. Edits and reactions are folded into
 * their targets, thread replies live in the thread panel, and the filter hides what the user chose.
 */
export function isRenderable(evt: TimelineEvent, filter: TimelineFilter = DEFAULT_TIMELINE_FILTER): boolean {
  if (threadRootOf(evt)) return false
  if (evt.type === 'm.room.member') {
    if (!filter.showMembership) return false
    const prev = evt.unsigned.prev_content as Partial<MemberEventContent> | undefined
    if (!filter.showProfileChanges && prev?.membership === evt.content.membership) return false
  }
  if (evt.redacted_by && !filter.showRedacted && !UNREDACTABLE_TYPES.has(evt.type)) return false
  // Everything the timeline can't describe is a hidden event, so the preference governs all of it and
  // not just the handful of types that happened to have a renderer already.
  if (isHiddenEvent(evt)) return filter.showHidden
  return true
}

/** Content to display for a message, taking the latest edit into account. */
export function displayContent(evt: TimelineEvent, lastEdit?: TimelineEvent) {
  const newContent = lastEdit?.content['m.new_content'] as MessageEventContent | undefined
  return {
    content: (newContent ?? evt.content) as unknown as MessageEventContent,
    localContent: newContent ? lastEdit?.local_content : evt.local_content,
  }
}

export function describeStateEvent(evt: TimelineEvent, senderName: string, targetName: string): string {
  const content = evt.content
  switch (evt.type) {
    case 'm.room.member': {
      const member = content as unknown as MemberEventContent
      const prev = evt.unsigned.prev_content as Partial<MemberEventContent> | undefined
      const self = evt.sender === evt.state_key
      switch (member.membership) {
        case 'join':
          if (prev?.membership !== 'join') return `${targetName} joined the room`
          if (prev.displayname !== member.displayname) {
            return member.displayname
              ? `${prev.displayname ?? evt.state_key} changed their name to ${member.displayname}`
              : `${prev.displayname} removed their display name`
          }
          if (prev.avatar_url !== member.avatar_url) return `${targetName} changed their avatar`
          return `${targetName} updated their profile`
        case 'invite':
          return `${senderName} invited ${targetName}`
        case 'leave':
          if (self) return prev?.membership === 'invite' ? `${targetName} rejected the invite` : `${targetName} left the room`
          return prev?.membership === 'ban' ? `${senderName} unbanned ${targetName}` : `${senderName} removed ${targetName}`
        case 'ban':
          return `${senderName} banned ${targetName}`
        case 'knock':
          return `${targetName} asked to join`
      }
      return `${targetName} membership changed`
    }
    case 'm.room.name':
      return content.name ? `${senderName} renamed the room to “${content.name}”` : `${senderName} removed the room name`
    case 'm.room.topic':
      return content.topic ? `${senderName} changed the topic to “${content.topic}”` : `${senderName} removed the topic`
    case 'm.room.avatar':
      return `${senderName} changed the room avatar`
    case 'm.room.encryption':
      return `${senderName} enabled end-to-end encryption`
    case 'm.room.create':
      return `${senderName} created the room`
    case 'm.room.tombstone':
      return `${senderName} upgraded this room`
    case 'm.room.pinned_events': {
      const now = eventIDList(content.pinned)
      const before = eventIDList(evt.unsigned.prev_content?.pinned)
      const added = now.filter(id => !before.includes(id)).length
      const removed = before.filter(id => !now.includes(id)).length
      if (added && removed) return `${senderName} pinned ${messageCount(added)} and unpinned ${messageCount(removed)}`
      if (added) return `${senderName} pinned ${messageCount(added)}`
      if (removed) return `${senderName} unpinned ${messageCount(removed)}`
      return `${senderName} changed the pinned messages`
    }
  }
  return `${senderName} sent ${evt.type}`
}

export function previewText(evt: TimelineEvent | undefined): string {
  if (!evt) return ''
  if (evt.redacted_by) return 'Message deleted'
  if (evt.type === 'm.room.encrypted') return 'Encrypted message'
  if (evt.local_content?.preview_text) return evt.local_content.preview_text
  const body = evt.content.body
  if (typeof body === 'string') {
    return evt.content.msgtype === 'm.emote' ? `* ${body}` : body
  }
  return ''
}
