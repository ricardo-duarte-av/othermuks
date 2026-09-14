import * as ContextMenu from '@radix-ui/react-context-menu'
import * as Dialog from '@radix-ui/react-dialog'
import { ArrowDownToLine, ArrowUpFromLine, Bell, BellOff, CheckCheck, LogOut, Star, StarOff } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { RoomID } from '@/api/types'
import { cn } from '@/lib/cn'
import { useChat } from '@/store/chat'
import {
  FAVOURITE_TAG,
  isRoomMuted,
  isRoomUnread,
  leaveRoom,
  LOW_PRIORITY_TAG,
  markRoomAsRead,
  requestLeaveRoom,
  roomTagsOf,
  toggleRoomMute,
  toggleRoomTag,
  useLeaveRoomDialog,
} from '@/store/roomActions'
import { showToast } from '@/store/ui'
import { Spinner } from '@/ui/primitives'

const itemClass =
  'flex cursor-default select-none items-center gap-2.5 rounded-md px-2 py-1.5 text-sm outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-40 data-[highlighted]:bg-hover'

function Item({ icon, onSelect, disabled, danger, children }: { icon: ReactNode; onSelect: () => void; disabled?: boolean; danger?: boolean; children: ReactNode }) {
  return (
    <ContextMenu.Item onSelect={onSelect} disabled={disabled} className={cn(itemClass, danger && 'text-danger')}>
      <span className={cn('text-muted', danger && 'text-danger')}>{icon}</span>
      {children}
    </ContextMenu.Item>
  )
}

/** Menu entries; only mounted while the menu is open, so closed menus cost nothing per room row. */
function RoomMenuItems({ roomID }: { roomID: RoomID }) {
  const unread = useChat(s => isRoomUnread(s, roomID))
  const favourite = useChat(s => FAVOURITE_TAG in roomTagsOf(s, roomID))
  const lowPriority = useChat(s => LOW_PRIORITY_TAG in roomTagsOf(s, roomID))
  const muted = useChat(s => isRoomMuted(s, roomID))

  return (
    <>
      <Item icon={<CheckCheck size={15} />} onSelect={() => markRoomAsRead(roomID)} disabled={!unread}>
        Mark as read
      </Item>
      <Item icon={favourite ? <StarOff size={15} /> : <Star size={15} />} onSelect={() => toggleRoomTag(roomID, FAVOURITE_TAG)}>
        {favourite ? 'Remove from favourites' : 'Add to favourites'}
      </Item>
      <Item
        icon={lowPriority ? <ArrowUpFromLine size={15} /> : <ArrowDownToLine size={15} />}
        onSelect={() => toggleRoomTag(roomID, LOW_PRIORITY_TAG)}
      >
        {lowPriority ? 'Remove low priority' : 'Set low priority'}
      </Item>
      <Item icon={muted ? <Bell size={15} /> : <BellOff size={15} />} onSelect={() => toggleRoomMute(roomID)}>
        {muted ? 'Unmute' : 'Mute'}
      </Item>
      <ContextMenu.Separator className="my-1 h-px bg-border" />
      <Item icon={<LogOut size={15} />} onSelect={() => requestAnimationFrame(() => requestLeaveRoom(roomID))} danger>
        Leave room
      </Item>
    </>
  )
}

/** Right-click (or the context menu key) on a room in the room list. */
export function RoomContextMenu({ roomID, children }: { roomID: RoomID; children: ReactNode }) {
  return (
    <ContextMenu.Root modal={false}>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content
          collisionPadding={8}
          className="room-menu z-50 min-w-56 rounded-lg border border-border bg-surface p-1 text-fg shadow-xl"
        >
          <RoomMenuItems roomID={roomID} />
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  )
}

export function LeaveRoomDialog() {
  const roomID = useLeaveRoomDialog(s => s.roomID)
  const name = useChat(s => (roomID ? (s.rooms[roomID]?.meta.name ?? roomID) : ''))
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const close = () => {
    useLeaveRoomDialog.setState({ roomID: null })
    setReason('')
    setBusy(false)
  }

  const confirm = async () => {
    if (!roomID) return
    setBusy(true)
    try {
      await leaveRoom(roomID, reason.trim())
      close()
    } catch (err) {
      showToast(`Couldn't leave the room: ${err instanceof Error ? err.message : String(err)}`)
      setBusy(false)
    }
  }

  return (
    <Dialog.Root open={!!roomID} onOpenChange={open => !open && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[2px]" />
        <Dialog.Content
          aria-describedby={undefined}
          className="leave-room-dialog fixed left-1/2 top-1/2 z-50 flex w-[min(460px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-xl border border-border bg-surface p-5 text-fg shadow-2xl outline-none"
        >
          <Dialog.Title className="text-base font-semibold">Leave {name}?</Dialog.Title>
          <p className="text-sm text-muted">If the room isn't public, you'll need a new invite to rejoin.</p>
          <input
            value={reason}
            onChange={e => setReason(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && void confirm()}
            placeholder="Reason (optional)"
            autoFocus
            className="h-10 rounded-lg border border-border bg-bg px-3 text-sm outline-none placeholder:text-muted focus:border-accent"
          />
          <div className="flex justify-end gap-2">
            <Dialog.Close className="rounded-lg px-3 py-2 text-sm hover:bg-hover">Cancel</Dialog.Close>
            <button
              type="button"
              onClick={() => void confirm()}
              disabled={busy}
              className="flex items-center gap-2 rounded-lg bg-danger px-3 py-2 text-sm font-medium text-white transition hover:brightness-110 disabled:opacity-60"
            >
              {busy && <Spinner size={14} />}
              Leave room
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
