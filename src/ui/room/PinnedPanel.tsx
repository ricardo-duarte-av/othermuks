import { CornerDownRight, Pin, PinOff, TriangleAlert, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { EventID, RoomID } from '@/api/types'
import { fetchEvent, useChat } from '@/store/chat'
import { jumpToEvent, loadEventContext } from '@/store/navigation'
import { setPinned, useCanPin, usePinnedEvents } from '@/store/pins'
import { closePins, showToast } from '@/store/ui'
import { IconButton, Spinner } from '@/ui/primitives'
import { TimelineRow } from '@/ui/timeline/TimelineRow'

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err))

export function PinnedPanel({ roomID }: { roomID: RoomID }) {
  const pins = usePinnedEvents(roomID)
  const canPin = useCanPin(roomID)
  // Newest pin first.
  const ordered = [...pins].reverse()

  return (
    <>
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4">
        <h2 className="text-sm font-semibold">Pinned messages</h2>
        {pins.length > 0 && <span className="rounded-full bg-surface-2 px-1.5 py-px text-xs tabular-nums text-muted">{pins.length}</span>}
        <IconButton label="Close" shortcut="Esc" className="ml-auto" onClick={closePins}>
          <X size={16} />
        </IconButton>
      </div>
      <div className="pinned-list min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-3">
        {ordered.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center">
            <span className="mb-3 grid size-14 place-items-center rounded-2xl bg-surface-2 text-muted">
              <Pin size={26} />
            </span>
            <p className="text-sm font-medium">No pinned messages</p>
            <p className="mt-1 text-xs leading-relaxed text-muted">
              {canPin
                ? "Pin important messages from a message's menu (More options → Pin message)."
                : 'People with enough power in this room can pin important messages here.'}
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {ordered.map(eventID => (
              <PinnedItem key={eventID} roomID={roomID} eventID={eventID} canPin={canPin} />
            ))}
          </ul>
        )}
      </div>
    </>
  )
}

function PinnedItem({ roomID, eventID, canPin }: { roomID: RoomID; eventID: EventID; canPin: boolean }) {
  const rowid = useChat(s => s.eventIDs[eventID])
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (rowid !== undefined) return
    let cancelled = false
    fetchEvent(roomID, eventID).then(
      () => {
        if (!cancelled && useChat.getState().eventIDs[eventID] === undefined) setFailed(true)
      },
      () => !cancelled && setFailed(true),
    )
    return () => {
      cancelled = true
    }
  }, [roomID, eventID, rowid])

  const unpin = async () => {
    setBusy(true)
    try {
      await setPinned(roomID, eventID, false)
    } catch (err) {
      showToast(`Couldn't unpin the message: ${errorText(err)}`)
      setBusy(false)
    }
  }

  return (
    <li className="pinned-item overflow-hidden rounded-xl border border-border bg-[var(--timeline-bg)]">
      <div className="flex items-center gap-1 border-b border-border/60 px-2 py-1">
        <Pin size={12} className="ml-1 shrink-0 text-accent" />
        <button
          type="button"
          onClick={() => jumpToEvent(roomID, eventID)}
          className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted transition-colors hover:bg-hover hover:text-fg"
        >
          <CornerDownRight size={12} /> Jump to message
        </button>
        {canPin && (
          <button
            type="button"
            onClick={() => void unpin()}
            disabled={busy}
            className="ml-auto flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted transition-colors hover:bg-hover hover:text-danger disabled:opacity-60"
          >
            {busy ? <Spinner size={12} /> : <PinOff size={12} />} Unpin
          </button>
        )}
      </div>
      <div
        className={rowid !== undefined ? 'pinned-body cursor-pointer py-1.5' : 'py-1.5'}
        title={rowid !== undefined ? 'Show in timeline' : undefined}
        onClick={e => {
          if (rowid === undefined) return
          // Links, reactions, media and the message menu keep their own clicks; so does selecting text.
          if ((e.target as Element).closest('a, button, input, textarea, video, audio, [role="button"], [role="menu"]')) return
          if (window.getSelection()?.toString()) return
          void loadEventContext(roomID, eventID, 'pin')
        }}
      >
        {rowid !== undefined ? (
          <TimelineRow roomID={roomID} rowid={rowid} compact={false} newDay={false} />
        ) : failed ? (
          <p className="flex items-center gap-2 px-4 py-2 text-xs text-muted">
            <TriangleAlert size={13} className="shrink-0" /> This message couldn't be loaded. It may have been removed, or be from before you joined.
          </p>
        ) : (
          <div className="flex justify-center py-3 text-muted">
            <Spinner size={16} />
          </div>
        )}
      </div>
    </li>
  )
}
