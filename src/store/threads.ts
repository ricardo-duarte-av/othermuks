// The threads of a room, derived from the replies the client already knows about: gomuks has no
// thread-list RPC, so a thread shows up here once any of its replies has arrived (sync, backfill,
// or opening the thread once). One such reply is enough to then page the whole thread with
// paginate_manual, which is what makes the list's reply counts real rather than "what we happened
// to have loaded".
import { useShallow } from 'zustand/react/shallow'
import type { EventID, EventRowID, RoomID } from '@/api/types'
import { loadThreadPage, selectOwnUserID, useChat } from './chat'
import { mentionsUser } from './events'

/** Thread roots of the room, most recently replied to first. */
export function useRoomThreads(roomID: RoomID): EventID[] {
  return useChat(
    useShallow(s => {
      const latestPerRoot: [EventID, number][] = []
      for (const rootID in s.threads) {
        let latest = 0
        for (const rowid of s.threads[rootID]) {
          const evt = s.events[rowid]
          if (evt?.room_id === roomID && evt.timestamp > latest) latest = evt.timestamp
        }
        if (latest) latestPerRoot.push([rootID, latest])
      }
      return latestPerRoot.sort((a, b) => b[1] - a[1]).map(([rootID]) => rootID)
    }),
  )
}

/** The newest reply in a thread, which is what the list previews. */
export function useLatestReply(rootID: EventID): EventRowID | undefined {
  return useChat(s => {
    let latest: EventRowID | undefined
    let ts = -1
    for (const rowid of s.threads[rootID] ?? []) {
      const evt = s.events[rowid]
      if (evt && evt.timestamp > ts) {
        ts = evt.timestamp
        latest = rowid
      }
    }
    return latest
  })
}

/**
 * Pages a thread to its first reply, so its count and newest reply are the real ones.
 * paginate_manual walks the thread's replies backwards and drops next_batch when there are no more;
 * the root itself is never among them, so callers fetch it separately.
 */
const MAX_PAGES = 10

/** Threads already walked to the end this session, and the one page walk in flight. */
const completed = new Set<EventID>()
const queued = new Set<EventID>()
let queue: Promise<void> = Promise.resolve()

/**
 * Queues a full walk of the thread, at most one at a time: opening the panel on a room with many
 * threads shouldn't fire a request per thread at once. Resolves when this thread is done.
 */
export function completeThread(roomID: RoomID, rootID: EventID): Promise<void> {
  if (completed.has(rootID) || queued.has(rootID)) return queue
  queued.add(rootID)
  queue = queue.then(async () => {
    try {
      let since = ''
      for (let page = 0; page < MAX_PAGES; page++) {
        const next = await loadThreadPage(roomID, rootID, since)
        if (!next) {
          completed.add(rootID)
          break
        }
        since = next
      }
    } catch (err) {
      console.warn('Failed to load the whole thread', rootID, err)
    } finally {
      queued.delete(rootID)
    }
  })
  return queue
}

/** Whether any reply in the thread calls the local user out, so the list can flag it. */
export function useThreadMentionsMe(rootID: EventID): boolean {
  return useChat(s => {
    const own = selectOwnUserID(s)
    return (s.threads[rootID] ?? []).some(rowid => {
      const evt = s.events[rowid]
      return !!evt && mentionsUser(evt, own)
    })
  })
}
