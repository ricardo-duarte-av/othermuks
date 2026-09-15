// Maps widget API requests to gomuks commands (based on gomuks web's GomuksWidgetDriver).
import {
  OpenIDRequestState,
  Symbols,
  WidgetDriver,
  type Capability,
  type IGetMediaConfigResult,
  type IOpenIDCredentials,
  type IOpenIDUpdate,
  type IRoomAccountData,
  type IRoomEvent,
  type IRtcTransportsResult,
  type ISendDelayedEventDetails,
  type ISendEventDetails,
  type ITurnServer,
  type SimpleObservable,
} from 'matrix-widget-api'
import { client } from '@/api/client'
import { mediaURL } from '@/api/media'
import type { ContentURI, RoomID } from '@/api/types'
import { parseMatrixURI } from '@/lib/matrixURI'
import { loadOlder, loadRoomState, useChat } from '@/store/chat'
import { normalizeEvent, type TimelineEvent } from '@/store/events'
import { openMatrixTarget } from '@/store/navigation'

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)

export function toIRoomEvent(evt: TimelineEvent): IRoomEvent {
  return {
    type: evt.type,
    sender: evt.sender,
    event_id: evt.event_id,
    room_id: evt.room_id,
    state_key: evt.state_key,
    origin_server_ts: evt.timestamp,
    content: evt.content,
    unsigned: evt.unsigned as Record<string, unknown>,
    ...(evt.sticky_duration_ms ? { msc4354_sticky: { duration_ms: evt.sticky_duration_ms } } : {}),
  } as IRoomEvent
}

export class OthermuksWidgetDriver extends WidgetDriver {
  readonly #roomID: RoomID
  readonly #approve: (requested: Set<Capability>) => Promise<Set<Capability>>
  #openID: { token: IOpenIDCredentials; expiresAt: number } | null = null

  constructor(roomID: RoomID, approve: (requested: Set<Capability>) => Promise<Set<Capability>>) {
    super()
    this.#roomID = roomID
    this.#approve = approve
  }

  validateCapabilities(requested: Set<Capability>): Promise<Set<Capability>> {
    return this.#approve(requested)
  }

  async sendEvent(eventType: string, content: unknown, stateKey: string | null = null, roomID: string | null = null): Promise<ISendEventDetails> {
    if (!isRecord(content)) throw new Error('Content must be an object')
    const room = roomID ?? this.#roomID
    if (stateKey !== null && stateKey !== undefined) {
      return { eventId: await client.setState(room, eventType, stateKey, content), roomId: room }
    }
    const evt = await client.sendEvent(room, eventType, content, { synchronous: true })
    return { eventId: evt.event_id, roomId: evt.room_id }
  }

  async sendStickyEvent(stickyDurationMs: number, eventType: string, content: unknown, roomID: string | null = null): Promise<ISendEventDetails> {
    if (!isRecord(content)) throw new Error('Content must be an object')
    const room = roomID ?? this.#roomID
    return { eventId: await client.sendStickyEvent(room, eventType, content, stickyDurationMs), roomId: room }
  }

  async sendDelayedStickyEvent(
    delay: number,
    stickyDurationMs: number,
    eventType: string,
    content: unknown,
    roomID: string | null = null,
  ): Promise<ISendDelayedEventDetails> {
    if (!isRecord(content)) throw new Error('Content must be an object')
    if (!delay || typeof delay !== 'number') throw new Error('Delay must be a number')
    const room = roomID ?? this.#roomID
    return { delayId: await client.sendStickyEvent(room, eventType, content, stickyDurationMs, delay), roomId: room }
  }

  async sendDelayedEvent(
    delay: number,
    eventType: string,
    content: unknown,
    stateKey: string | null = null,
    roomID: string | null = null,
  ): Promise<ISendDelayedEventDetails> {
    if (!isRecord(content)) throw new Error('Content must be an object')
    if (stateKey === null || stateKey === undefined) throw new Error('Non-state delayed events are not supported')
    if (!delay || typeof delay !== 'number') throw new Error('Delay must be a number')
    const room = roomID ?? this.#roomID
    return { delayId: await client.setState(room, eventType, stateKey, content, { delay_ms: delay }), roomId: room }
  }

  async cancelScheduledDelayedEvent(delayID: string): Promise<void> {
    await client.updateDelayedEvent(delayID, 'cancel')
  }

  async restartScheduledDelayedEvent(delayID: string): Promise<void> {
    await client.updateDelayedEvent(delayID, 'restart')
  }

  async sendScheduledDelayedEvent(delayID: string): Promise<void> {
    await client.updateDelayedEvent(delayID, 'send')
  }

  async sendToDevice(eventType: string, encrypted: boolean, contentMap: { [userId: string]: { [deviceId: string]: object } }): Promise<void> {
    await client.sendToDevice(eventType, contentMap, encrypted)
  }

  async readRoomTimeline(
    roomID: string,
    eventType: string,
    msgtype: string | undefined,
    stateKey: string | undefined,
    limit: number,
    since: string | undefined,
  ): Promise<IRoomEvent[]> {
    if (!useChat.getState().rooms[roomID]) return []
    if (!useChat.getState().rooms[roomID].timeline.length) await loadOlder(roomID)
    const { rooms, events } = useChat.getState()
    const results: IRoomEvent[] = []
    const timeline = rooms[roomID]?.timeline ?? []
    for (let i = timeline.length - 1; i >= 0 && results.length < limit; i--) {
      const evt = events[timeline[i].event_rowid]
      if (!evt) continue
      if (evt.event_id === since) break
      if (evt.type !== eventType) continue
      if (msgtype && evt.content.msgtype !== msgtype) continue
      if (stateKey !== undefined && evt.state_key !== stateKey) continue
      results.push(toIRoomEvent(evt))
    }
    return results
  }

  async readRoomState(roomID: string, eventType: string, stateKey: string | undefined): Promise<IRoomEvent[]> {
    const room = useChat.getState().rooms[roomID]
    if (!room) return []
    if (!room.membersLoaded) await loadRoomState(roomID)
    const { rooms, events } = useChat.getState()
    const keys = rooms[roomID]?.state[eventType]
    if (!keys) return []
    const rowids = stateKey === undefined ? Object.values(keys) : keys[stateKey] === undefined ? [] : [keys[stateKey]]
    return rowids.map(rowid => events[rowid]).filter((evt): evt is TimelineEvent => !!evt).map(toIRoomEvent)
  }

  #roomIDs(roomIDs: string[] | null | undefined): string[] {
    if (!roomIDs || (roomIDs.length === 1 && roomIDs[0] === this.#roomID)) return [this.#roomID]
    if (roomIDs.includes(Symbols.AnyRoom)) return Object.keys(useChat.getState().rooms)
    return roomIDs
  }

  async readStateEvents(eventType: string, stateKey: string | undefined, limit: number, roomIDs: string[] | null = null): Promise<IRoomEvent[]> {
    const all = await Promise.all(this.#roomIDs(roomIDs).map(roomID => this.readRoomState(roomID, eventType, stateKey)))
    return all.flat().slice(0, limit)
  }

  async readStickyEvents(roomID: string): Promise<IRoomEvent[]> {
    const raws = (await client.getStickyEvents(roomID)) ?? []
    return raws.map(raw => toIRoomEvent(normalizeEvent(raw)))
  }

  async readRoomAccountData(eventType: string, roomIDs: string[] | null = null): Promise<IRoomAccountData[]> {
    const { rooms } = useChat.getState()
    return this.#roomIDs(roomIDs).flatMap(roomID => {
      const data = rooms[roomID]?.accountData[eventType]
      return data ? [{ type: eventType, room_id: roomID, content: data.content }] : []
    })
  }

  askOpenID(observer: SimpleObservable<IOpenIDUpdate>): void {
    const cached = this.#openID
    const token =
      cached && cached.expiresAt > Date.now()
        ? Promise.resolve(cached.token)
        : client.requestOpenIDToken().then(resp => {
            if (!resp) throw new Error('No OpenID token returned')
            const credentials = resp as IOpenIDCredentials
            // Refresh at half the lifetime.
            this.#openID = { token: credentials, expiresAt: Date.now() + (resp.expires_in / 2) * 1000 }
            return credentials
          })
    token.then(
      credentials => observer.update({ state: OpenIDRequestState.Allowed, token: credentials }),
      err => {
        console.error('Failed to get an OpenID token for a widget', err)
        observer.update({ state: OpenIDRequestState.Blocked })
      },
    )
  }

  async uploadFile(file: XMLHttpRequestBodyInit): Promise<{ contentUri: string }> {
    const blob = file instanceof Blob ? file : new Blob([file as BlobPart])
    const upload = blob instanceof File ? blob : new File([blob], 'upload', { type: blob.type })
    const content = await client.upload(upload, false)
    if (!content.url) throw new Error('Upload returned no URL')
    return { contentUri: content.url }
  }

  async downloadFile(contentUri: string): Promise<{ file: XMLHttpRequestBodyInit }> {
    const url = mediaURL(contentUri as ContentURI)
    if (!url) throw new Error('Invalid content URI')
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`)
    return { file: await res.blob() }
  }

  async getMediaConfig(): Promise<IGetMediaConfigResult> {
    return (await client.getMediaConfig()) as IGetMediaConfigResult
  }

  getKnownRooms(): string[] {
    return Object.keys(useChat.getState().rooms)
  }

  async navigate(uri: string): Promise<void> {
    const target = parseMatrixURI(uri)
    if (!target) throw new Error(`Unsupported URI: ${uri}`)
    await openMatrixTarget(target)
  }

  async *getTurnServers(): AsyncGenerator<ITurnServer> {
    const res = await client.getTurnServers()
    yield { uris: res.uris, username: res.username, password: res.password }
  }

  async getRtcTransports(): Promise<IRtcTransportsResult> {
    return (await client.getRTCTransports()) as IRtcTransportsResult
  }
}
