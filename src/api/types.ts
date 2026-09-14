// Wire types for the gomuks RPC and HTTP APIs.
// Adapted from gomuks web/src/api/types (AGPL-3.0-or-later).
// RPC spec: https://spec.mau.fi/gomuks/rpc.html

export type RoomID = string
export type EventID = string
export type UserID = string
export type DeviceID = string
export type EventType = string
export type ContentURI = string
export type RoomAlias = string
export type EventRowID = number
export type TimelineRowID = number

export interface TimelineRowTuple {
  timeline_rowid: TimelineRowID
  event_rowid: EventRowID
}

export const UnreadType = {
  None: 0b0000,
  Normal: 0b0001,
  Notify: 0b0010,
  Highlight: 0b0100,
  Sound: 0b1000,
} as const

export interface LazyLoadSummary {
  'm.heroes'?: UserID[]
  'm.joined_member_count'?: number
  'm.invited_member_count'?: number
}

export interface DBRoom {
  room_id: RoomID
  creation_content?: { type?: string }
  tombstone?: { replacement_room: RoomID; body?: string }
  name?: string
  name_quality: number
  avatar?: ContentURI
  explicit_avatar: boolean
  dm_user_id?: UserID
  topic?: string
  canonical_alias?: RoomAlias
  lazy_load_summary?: LazyLoadSummary
  encryption_event?: { algorithm: string }
  has_member_list: boolean
  preview_event_rowid: EventRowID
  sorting_timestamp: number
  unread_highlights: number
  unread_notifications: number
  unread_messages: number
  marked_unread: boolean
}

export interface LocalContent {
  sanitized_html?: string
  preview_text?: string
  edit_source?: string
  html_version?: number
  was_plaintext?: boolean
  big_emoji?: boolean
  has_math?: boolean
}

export interface RawDBEvent {
  rowid: EventRowID
  timeline_rowid: TimelineRowID
  room_id: RoomID
  event_id: EventID
  sender: UserID
  type: EventType
  state_key?: string
  timestamp: number
  content: Record<string, unknown>
  unsigned: { prev_content?: Record<string, unknown>; prev_sender?: UserID }
  local_content?: LocalContent
  transaction_id?: string
  redacted_by?: EventID
  relates_to?: EventID
  relation_type?: string
  decryption_error?: string
  send_error?: string
  reactions?: Record<string, number>
  last_edit_rowid?: EventRowID
  unread_type: number
  decrypted?: Record<string, unknown>
  decrypted_type?: EventType
}

export interface EncryptedFile {
  url: ContentURI
  k: string
  v: 'v2'
  ext: true
  alg: 'A256CTR'
  key_ops: string[]
  kty: 'oct'
}

export interface MediaInfo {
  mimetype?: string
  size?: number
  w?: number
  h?: number
  duration?: number
  thumbnail_url?: ContentURI
  thumbnail_file?: EncryptedFile
  thumbnail_info?: MediaInfo
  'xyz.amorgan.blurhash'?: string
}

export interface Mentions {
  user_ids: UserID[]
  room: boolean
}

export interface RelatesTo {
  rel_type?: string
  event_id?: EventID
  key?: string
  is_falling_back?: boolean
  'm.in_reply_to'?: { event_id: EventID }
}

export interface MessageEventContent {
  msgtype: string
  body: string
  formatted_body?: string
  format?: 'org.matrix.custom.html'
  filename?: string
  url?: ContentURI
  file?: EncryptedFile
  info?: MediaInfo
  'm.mentions'?: Mentions
  'm.relates_to'?: RelatesTo
  'm.new_content'?: MessageEventContent
}

export interface MemberEventContent {
  membership: 'join' | 'leave' | 'invite' | 'ban' | 'knock'
  displayname?: string
  avatar_url?: ContentURI
  avatar_file?: EncryptedFile
  reason?: string
}

export interface DBReceipt {
  user_id: UserID
  receipt_type: string
  thread_id?: EventID | 'main'
  event_id: EventID
  timestamp: number
}

export interface DBAccountData {
  user_id: UserID
  type: EventType
  content: Record<string, unknown>
}

export interface DBRoomAccountData extends DBAccountData {
  room_id: RoomID
}

export interface SyncRoom {
  meta?: DBRoom
  timeline?: TimelineRowTuple[] | null
  events?: RawDBEvent[] | null
  state?: Record<EventType, Record<string, EventRowID>> | null
  reset?: boolean
  notifications?: { event_rowid: EventRowID; sound: boolean }[] | null
  account_data?: Record<EventType, DBRoomAccountData> | null
  receipts?: Record<EventID, DBReceipt[]> | null
}

export interface DBInvitedRoom {
  room_id: RoomID
  created_at: number
  invite_state: { type: EventType; state_key: string; sender: UserID; content: Record<string, unknown> }[]
}

export interface DBSpaceEdge {
  child_id: RoomID
  order?: string
  suggested?: true
  canonical?: true
}

export interface SyncCompleteData {
  rooms?: Record<RoomID, SyncRoom> | null
  invited_rooms?: DBInvitedRoom[] | null
  left_rooms?: RoomID[] | null
  account_data?: Record<EventType, DBAccountData> | null
  space_edges?: Record<RoomID, DBSpaceEdge[]> | null
  top_level_spaces?: RoomID[] | null
  since?: string
  clear_state?: boolean
  catchup?: boolean
  server_timestamp?: number
}

export interface VerificationState {
  is_verified: boolean
  state_checked: boolean
  has_cross_signing: boolean
  has_ssss: boolean
}

export type ClientState =
  | { is_initialized: boolean; is_logged_in: false; is_verified: false }
  | {
      is_initialized: boolean
      is_logged_in: true
      is_verified: boolean
      verification_state: VerificationState
      user_id: UserID
      device_id: DeviceID
      homeserver_url: string
      displayname?: string
      avatar_url?: ContentURI
    }

export interface SyncStatus {
  type: 'ok' | 'waiting' | 'erroring' | 'permanently-failed'
  error?: string
  error_count: number
  last_sync?: number
}

export interface RunData {
  run_id: string
  etag: string
  vapid_key: string
  listener_id: number
}

export interface PaginationResponse {
  events: RawDBEvent[]
  receipts: Record<EventID, DBReceipt[]>
  related_events: RawDBEvent[]
  has_more: boolean
}

/** Response of the get_profile command. `bio` is gomuks' sanitized HTML of the extended profile biography. */
export interface GetProfileResponse {
  profile: Record<string, unknown> & { displayname?: string; avatar_url?: ContentURI }
  bio?: { html: string; edit_source?: string }
}

/** get_event_context: `before` is newest-first, `after` oldest-first (Matrix /context semantics). */
export interface EventContextResponse {
  start: string
  end: string
  before: RawDBEvent[]
  after: RawDBEvent[]
  event: RawDBEvent
}

export interface ManualPaginationResponse {
  events: RawDBEvent[]
  next_batch?: string
}

export interface SendMessageParams {
  room_id: RoomID
  text: string
  base_content?: Partial<MessageEventContent>
  extra?: Record<string, unknown>
  relates_to?: RelatesTo
  mentions?: Mentions
  url_previews?: unknown[]
}

interface Cmd<C extends string, D> {
  command: C
  request_id: number
  data: D
}

export type RPCEvent =
  | Cmd<'run_id', RunData>
  | Cmd<'client_state', ClientState>
  | Cmd<'sync_status', SyncStatus>
  | Cmd<'image_auth_token', string>
  | Cmd<'sync_complete', SyncCompleteData>
  | Cmd<'init_complete', null>
  | Cmd<'typing', { room_id: RoomID; user_ids: UserID[] }>
  | Cmd<'send_complete', { event: RawDBEvent; error: string | null }>
  | Cmd<'events_decrypted', {
      room_id: RoomID
      preview_event_rowid?: EventRowID
      sorting_timestamp?: number
      events: RawDBEvent[]
    }>
