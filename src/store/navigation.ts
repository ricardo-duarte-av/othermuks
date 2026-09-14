import type { EventID, RoomID } from '@/api/types'
import { useChat } from './chat'
import { threadRootOf } from './events'
import { openThread, showToast, useUI } from './ui'

const HIGHLIGHT_MS = 2600
let nonce = 0

/**
 * Scrolls to a message and briefly highlights it. Works for messages loaded in the room timeline;
 * thread replies open their thread first. Older, unloaded messages just get a notice.
 */
export function jumpToEvent(roomID: RoomID, eventID: EventID) {
  const s = useChat.getState()
  const rowid = s.eventIDs[eventID]
  const evt = rowid === undefined ? undefined : s.events[rowid]
  const room = s.rooms[roomID]
  if (!evt || !room) {
    showToast("That message isn't loaded")
    return
  }

  const threadRoot = threadRootOf(evt)
  if (threadRoot) {
    if (useUI.getState().threadRoot !== threadRoot) openThread(threadRoot)
  } else if (!room.timeline.some(tuple => tuple.event_rowid === rowid) && !room.pending.includes(rowid)) {
    showToast('That message is too far back to be loaded in the timeline')
    return
  }

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
