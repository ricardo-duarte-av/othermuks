// Moving around the timeline: jumping to a message, showing messages around one that isn't loaded
// (get_event_context), and following matrix.to / matrix: links.
import { create } from 'zustand'
import { client } from '@/api/client'
import type { EventID, EventRowID, RoomID } from '@/api/types'
import type { MatrixTarget } from '@/lib/matrixURI'
import { storeEvents, useChat } from './chat'
import { threadRootOf } from './events'
import { openProfile, openRoom, openThread, showToast, useUI } from './ui'

const HIGHLIGHT_MS = 2600
const CONTEXT_LIMIT = 20
let nonce = 0

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err))

/** Briefly highlights a message row wherever it's rendered (timeline, thread, or context view). */
function flashHighlight(rowid: EventRowID) {
  const id = ++nonce
  // Clear first so jumping to the same message twice replays the highlight.
  useUI.setState({ highlight: null })
  requestAnimationFrame(() => {
    useUI.setState({ highlight: { rowid, nonce: id } })
    setTimeout(() => {
      if (useUI.getState().highlight?.nonce === id) useUI.setState({ highlight: null })
    }, HIGHLIGHT_MS)
  })
}

/** A temporary timeline of messages around an event that isn't in the room's loaded timeline. */
export interface EventContextView {
  roomID: RoomID
  eventID: EventID
  status: 'loading' | 'ready' | 'error'
  /** Chronological. */
  rowids: EventRowID[]
  targetRowID?: EventRowID
  error?: string
}

export const useEventContext = create<{ view: EventContextView | null }>()(() => ({ view: null }))

export function closeEventContext() {
  if (useEventContext.getState().view) useEventContext.setState({ view: null })
}

export async function loadEventContext(roomID: RoomID, eventID: EventID) {
  useEventContext.setState({ view: { roomID, eventID, status: 'loading', rowids: [] } })
  const stillWanted = () => {
    const view = useEventContext.getState().view
    return view?.roomID === roomID && view.eventID === eventID
  }
  try {
    const resp = await client.getEventContext(roomID, eventID, CONTEXT_LIMIT)
    const raws = [...resp.before, resp.event, ...resp.after]
    storeEvents(raws)
    if (!stillWanted()) return
    const s = useChat.getState()
    const rowids = [...new Set(raws.map(raw => s.eventIDs[raw.event_id]).filter((rowid): rowid is EventRowID => rowid !== undefined))].sort(
      (a, b) => (s.events[a]?.timestamp ?? 0) - (s.events[b]?.timestamp ?? 0),
    )
    const targetRowID = s.eventIDs[eventID]
    useEventContext.setState({ view: { roomID, eventID, status: 'ready', rowids, targetRowID } })
    if (targetRowID !== undefined) flashHighlight(targetRowID)
  } catch (err) {
    if (stillWanted()) useEventContext.setState({ view: { roomID, eventID, status: 'error', rowids: [], error: errorText(err) } })
  }
}

/**
 * Scrolls to a message and highlights it: in the thread panel for thread replies, in the room timeline
 * when it's loaded there (or in the open context view), and otherwise in a context view built with
 * get_event_context.
 */
export function jumpToEvent(roomID: RoomID, eventID: EventID) {
  const s = useChat.getState()
  const room = s.rooms[roomID]
  if (!room) {
    showToast("You haven't joined that room")
    return
  }
  const rowid = s.eventIDs[eventID]
  const evt = rowid === undefined ? undefined : s.events[rowid]
  if (evt && rowid !== undefined) {
    const threadRoot = threadRootOf(evt)
    if (threadRoot) {
      if (useUI.getState().threadRoot !== threadRoot) openThread(threadRoot)
      flashHighlight(rowid)
      return
    }
    const view = useEventContext.getState().view
    if (view?.roomID === roomID && view.rowids.includes(rowid)) {
      flashHighlight(rowid)
      return
    }
    if (room.timeline.some(tuple => tuple.event_rowid === rowid) || room.pending.includes(rowid)) {
      closeEventContext()
      flashHighlight(rowid)
      return
    }
  }
  void loadEventContext(roomID, eventID)
}

/** Follows a matrix.to or matrix: link inside the client. */
export async function openMatrixTarget(target: MatrixTarget) {
  if (target.kind === 'user') {
    openProfile(target.userID)
    return
  }

  let roomID = target.roomID
  if (!roomID && target.alias) {
    const alias = target.alias
    roomID = Object.values(useChat.getState().rooms).find(room => room.meta.canonical_alias === alias)?.meta.room_id
    if (!roomID) {
      try {
        roomID = (await client.resolveAlias(alias)).room_id
      } catch (err) {
        showToast(`Couldn't find ${alias}: ${errorText(err)}`)
        return
      }
    }
  }
  if (!roomID) return
  if (!useChat.getState().rooms[roomID]) {
    showToast("You haven't joined that room")
    return
  }

  if (useUI.getState().activeRoomID !== roomID) {
    closeEventContext()
    openRoom(roomID)
  }
  if (target.eventID) jumpToEvent(roomID, target.eventID)
}
