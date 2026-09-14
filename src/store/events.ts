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
])

export function isMessageLike(evt: TimelineEvent): boolean {
  return evt.type === 'm.room.message' || evt.type === 'm.sticker' || evt.type === 'm.room.encrypted'
}

/**
 * Whether an event gets its own row in the main timeline. Edits and reactions are folded into
 * their targets, and thread replies live in the thread panel.
 */
export function isRenderable(evt: TimelineEvent): boolean {
  if (evt.relation_type === 'm.replace' || threadRootOf(evt)) return false
  return isMessageLike(evt) || (evt.state_key !== undefined && STATE_TYPES.has(evt.type))
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
