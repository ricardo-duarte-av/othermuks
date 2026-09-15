// Matrix widgets (im.vector.modular.widgets room state) and Element Call, modelled on gomuks web:
// widgets run in iframes speaking the widget API, a driver maps their requests to gomuks commands
// (ui/widget), and new timeline, state and to-device events are forwarded to open widgets from here.
import { useMemo } from 'react'
import { create } from 'zustand'
import { client } from '@/api/client'
import type { RoomID, SyncToDevice, UserID } from '@/api/types'
import { selectOwnUserID, syncListeners, useChat, type ChatSnapshot } from './chat'
import type { TimelineEvent } from './events'

export const WIDGET_STATE_TYPE = 'im.vector.modular.widgets'
export const CALL_MEMBER_STATE_TYPE = 'org.matrix.msc3401.call.member'
export const CALL_ROOM_TYPE = 'org.matrix.msc3417.call'
/** Widget ID of the Element Call widget othermuks adds to every room (it isn't room state). */
export const CALL_WIDGET_ID = 'app.othermuks.call'

export interface RoomWidget {
  id: string
  name: string
  type?: string
  url: string
  creatorUserId: UserID
  data?: Record<string, unknown>
}

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)

export function widgetFromState(stateKey: string, evt: TimelineEvent | undefined): RoomWidget | null {
  if (!evt || evt.redacted_by || !isRecord(evt.content)) return null
  const { url, name, type, data } = evt.content
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return null
  return {
    id: stateKey,
    name: typeof name === 'string' && name.trim() ? name : stateKey,
    type: typeof type === 'string' ? type : undefined,
    url,
    creatorUserId: evt.sender,
    data: isRecord(data) ? data : undefined,
  }
}

/** Widgets added to a room (valid http(s) widget state events), by name. */
export function useRoomWidgets(roomID: RoomID): RoomWidget[] {
  const stateMap = useChat(s => s.rooms[roomID]?.state[WIDGET_STATE_TYPE])
  return useMemo(() => {
    const { events } = useChat.getState()
    return Object.entries(stateMap ?? {})
      .map(([stateKey, rowid]) => widgetFromState(stateKey, events[rowid]))
      .filter((widget): widget is RoomWidget => !!widget)
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [stateMap])
}

/** People with a (non-empty) MatrixRTC call membership in the room. */
export function activeCallMembers(chat: ChatSnapshot, roomID: RoomID): number {
  const members = chat.rooms[roomID]?.state[CALL_MEMBER_STATE_TYPE]
  if (!members) return 0
  let count = 0
  for (const rowid of Object.values(members)) {
    const content = chat.events[rowid]?.content
    if (!content || chat.events[rowid]?.redacted_by) continue
    const memberships = content.memberships
    if (Array.isArray(memberships) ? memberships.length > 0 : Object.keys(content).length > 0) count++
  }
  return count
}

// ---- Element Call ----

const ELEMENT_CALL_PARAMS =
  '#?' +
  new URLSearchParams({
    roomId: '$matrix_room_id',
    theme: '$org.matrix.msc2873.client_theme',
    userId: '$matrix_user_id',
    deviceId: '$org.matrix.msc3819.matrix_device_id',
    perParticipantE2EE: '$perParticipantE2EE',
    baseUrl: '$homeserverBaseURL',
    intent: 'join_existing',
    hideHeader: 'true',
    confineToRoom: 'true',
    appPrompt: 'false',
    lang: 'en',
    fontScale: '1',
    rageshakeSubmitUrl: 'https://element.io/bugreports/submit',
    preload: 'false',
  })
    .toString()
    .replaceAll('%24', '$')

/** The bundled Element Call, or `<custom base>/room` when the element_call_base_url preference is set. */
export function elementCallURL(customBaseURL: string): string {
  const base = customBaseURL.trim()
  if (!base) return `${new URL('element-call-embedded/index.html', document.baseURI).href}${ELEMENT_CALL_PARAMS}`
  let parsed: URL
  try {
    parsed = new URL(base)
  } catch {
    throw new Error(`"${base}" isn't a valid Element Call URL.`)
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error('The Element Call URL must start with https://')
  const path = parsed.pathname.endsWith('/') ? parsed.pathname : `${parsed.pathname}/`
  return `${parsed.origin}${path}room${ELEMENT_CALL_PARAMS}`
}

export function elementCallWidget(chat: ChatSnapshot, roomID: RoomID, customBaseURL: string): RoomWidget {
  const room = chat.rooms[roomID]
  const state = chat.clientState
  return {
    id: CALL_WIDGET_ID,
    name: `Call in ${room?.meta.name ?? roomID}`,
    type: 'm.call',
    url: elementCallURL(customBaseURL),
    creatorUserId: selectOwnUserID(chat) ?? '',
    data: {
      perParticipantE2EE: !!room?.meta.encryption_event,
      homeserverBaseURL: state?.is_logged_in ? state.homeserver_url : '',
    },
  }
}

// ---- Forwarding events to open widgets ----

export interface WidgetEventListener {
  roomID: RoomID
  onEvent(evt: TimelineEvent): void
  onState(evt: TimelineEvent): void
  onToDevice(message: SyncToDevice): void
}

const listeners = new Set<WidgetEventListener>()
let listeningToDevice = false
let reconnectHooked = false

function setListening(listen: boolean) {
  listeningToDevice = listen
  client.setListenToDevice(listen).catch(err => console.error('Failed to toggle to-device events for widgets', err))
}

/** Registers an open widget; to-device events are requested from gomuks while any widget is open. */
export function addWidgetListener(listener: WidgetEventListener): () => void {
  listeners.add(listener)
  if (!reconnectHooked) {
    reconnectHooked = true
    // A restarted backend forgets the setting.
    client.events.on(({ evt }) => {
      if (evt.command === 'run_id' && listeningToDevice) setListening(true)
    })
  }
  if (!listeningToDevice) setListening(true)
  return () => {
    listeners.delete(listener)
    if (!listeners.size && listeningToDevice) setListening(false)
  }
}

syncListeners.add(data => {
  if (!listeners.size) return
  for (const message of data.to_device ?? []) for (const listener of listeners) listener.onToDevice(message)
  if (!data.rooms) return
  const { events } = useChat.getState()
  for (const [roomID, sync] of Object.entries(data.rooms)) {
    const roomListeners = [...listeners].filter(listener => listener.roomID === roomID)
    if (!roomListeners.length) continue
    for (const tuple of sync.timeline ?? []) {
      const evt = events[tuple.event_rowid]
      if (evt) for (const listener of roomListeners) listener.onEvent(evt)
    }
    for (const keys of Object.values(sync.state ?? {})) {
      for (const rowid of Object.values(keys)) {
        const evt = events[rowid]
        if (evt) for (const listener of roomListeners) listener.onState(evt)
      }
    }
  }
})

// ---- Permissions (remembered per widget on this device) ----

const PERMISSIONS_KEY = 'othermuks-widget-permissions'

interface SavedPermissions {
  granted: string[]
  /** Everything the user has answered for, so only new requests prompt again. */
  asked: string[]
}

function readSaved(): Record<string, SavedPermissions> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(PERMISSIONS_KEY) ?? '{}')
    return isRecord(parsed) ? (parsed as Record<string, SavedPermissions>) : {}
  } catch {
    return {}
  }
}

export const useWidgetPermissions = create<{ saved: Record<string, SavedPermissions> }>()(() => ({ saved: readSaved() }))

function writeSaved(saved: Record<string, SavedPermissions>) {
  useWidgetPermissions.setState({ saved })
  try {
    localStorage.setItem(PERMISSIONS_KEY, JSON.stringify(saved))
  } catch {
    // Not remembered; the widget still gets this session's answer.
  }
}

/** A widget's permissions are tied to its room, ID and URL: a changed URL asks again. */
export const widgetPermissionKey = (roomID: RoomID, widget: Pick<RoomWidget, 'id' | 'url'>) => `${roomID}|${widget.id}|${widget.url}`

/** Answers given this session (also when not remembered), so a widget reloaded after its prompt isn't asked again. */
const sessionAnswers = new Map<string, SavedPermissions>()

export function forgetWidgetPermissions(key: string) {
  sessionAnswers.delete(key)
  const saved = { ...useWidgetPermissions.getState().saved }
  delete saved[key]
  writeSaved(saved)
}

export interface PermissionRequest {
  widgetName: string
  widgetURL: string
  requested: string[]
  preselected: string[]
  resolve: (granted: string[], remember: boolean) => void
}

export const usePermissionPrompt = create<{ request: PermissionRequest | null }>()(() => ({ request: null }))

/**
 * Resolves a widget's capability request from remembered answers, or by asking. `onPrompt` is called
 * when the user actually gets asked, since widgets may time out waiting and need a reload afterwards.
 */
export function approveWidgetCapabilities(
  key: string,
  widgetName: string,
  widgetURL: string,
  requested: Set<string>,
  onPrompt?: () => void,
): Promise<Set<string>> {
  const list = [...requested]
  const saved = sessionAnswers.get(key) ?? useWidgetPermissions.getState().saved[key]
  if (saved && list.every(capability => saved.asked.includes(capability))) {
    return Promise.resolve(new Set(list.filter(capability => saved.granted.includes(capability))))
  }
  // A second prompt replaces a pending one, which counts as denied.
  usePermissionPrompt.getState().request?.resolve([], false)
  onPrompt?.()
  return new Promise(resolve => {
    usePermissionPrompt.setState({
      request: {
        widgetName,
        widgetURL,
        requested: list,
        preselected: saved ? list.filter(c => saved.granted.includes(c) || !saved.asked.includes(c)) : list,
        resolve: (granted, remember) => {
          usePermissionPrompt.setState({ request: null })
          const previous = saved
          const answer: SavedPermissions = {
            granted: [...new Set([...(previous?.granted.filter(c => !list.includes(c)) ?? []), ...granted])],
            asked: [...new Set([...(previous?.asked ?? []), ...list])],
          }
          sessionAnswers.set(key, answer)
          if (remember) writeSaved({ ...useWidgetPermissions.getState().saved, [key]: answer })
          resolve(new Set(granted))
        },
      },
    })
  })
}
