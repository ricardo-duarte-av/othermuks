// Who reacted with what, loaded on demand with get_related_events (m.annotation / m.reaction).
import { create } from 'zustand'
import { client } from '@/api/client'
import type { EventID, RoomID, UserID } from '@/api/types'
import type { TimelineEvent } from './events'

export interface Reactor {
  userID: UserID
  /** The reaction event, needed to remove one's own reaction. */
  eventID: EventID
  timestamp: number
  /** com.beeper.reaction.shortcode, for custom emoji reactions. */
  shortcode?: string
}

interface ReactionDetails {
  /** The reaction counts these details were loaded for; a change means they're stale. */
  signature: string
  loading: boolean
  byKey?: Record<string, Reactor[]>
  error?: string
}

export const useReactionDetails = create<{ entries: Record<EventID, ReactionDetails> }>()(() => ({ entries: {} }))

export const reactionSignature = (evt: TimelineEvent) => JSON.stringify(evt.reactions ?? {})

const inflight = new Map<string, Promise<Record<string, Reactor[]>>>()

function patch(eventID: EventID, entry: ReactionDetails) {
  useReactionDetails.setState(s => ({ entries: { ...s.entries, [eventID]: entry } }))
}

export async function loadReactionDetails(roomID: RoomID, evt: TimelineEvent): Promise<Record<string, Reactor[]>> {
  const signature = reactionSignature(evt)
  const current = useReactionDetails.getState().entries[evt.event_id]
  if (current?.signature === signature && current.byKey) return current.byKey

  const flightKey = `${evt.event_id}|${signature}`
  const existing = inflight.get(flightKey)
  if (existing) return existing

  const request = (async () => {
    patch(evt.event_id, { signature, loading: true, byKey: current?.byKey })
    try {
      const related = await client.getRelatedEvents(roomID, evt.event_id, 'm.annotation', 'm.reaction')
      const byKey: Record<string, Reactor[]> = {}
      for (const reaction of related) {
        if (reaction.redacted_by || reaction.type !== 'm.reaction') continue
        const key = (reaction.content['m.relates_to'] as { key?: unknown } | undefined)?.key
        if (typeof key !== 'string') continue
        const shortcode = reaction.content['com.beeper.reaction.shortcode']
        ;(byKey[key] ??= []).push({
          userID: reaction.sender,
          eventID: reaction.event_id,
          timestamp: reaction.timestamp,
          shortcode: typeof shortcode === 'string' ? shortcode : undefined,
        })
      }
      for (const reactors of Object.values(byKey)) reactors.sort((a, b) => a.timestamp - b.timestamp)
      patch(evt.event_id, { signature, loading: false, byKey })
      return byKey
    } catch (err) {
      patch(evt.event_id, { signature, loading: false, error: err instanceof Error ? err.message : String(err) })
      throw err
    } finally {
      inflight.delete(flightKey)
    }
  })()
  inflight.set(flightKey, request)
  return request
}
