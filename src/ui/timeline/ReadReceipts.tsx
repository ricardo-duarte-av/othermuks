import { motion } from 'motion/react'
import { memo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { RoomID, UserID } from '@/api/types'
import { formatNames } from '@/lib/format'
import { useChat } from '@/store/chat'
import { displayNameOf } from '@/store/events'
import { useMember } from '@/store/hooks'
import { Avatar } from '@/ui/primitives'

const MAX_AVATARS = 5
const RECEIPT_AVATAR_SIZE = 16

const ReceiptAvatar = memo(function ReceiptAvatar({ roomID, userID }: { roomID: RoomID; userID: UserID }) {
  const member = useMember(roomID, userID)
  return <Avatar mxc={member?.avatar_url} id={userID} name={displayNameOf(userID, member)} size={RECEIPT_AVATAR_SIZE} />
})

/**
 * Avatars of people whose read receipt is on this message. Each avatar has a per-user layoutId, so
 * when someone's receipt moves to a newer message their avatar animates over instead of jumping.
 */
export const ReadReceipts = memo(function ReadReceipts({ roomID, readers }: { roomID: RoomID; readers: UserID[] }) {
  const names = useChat(
    useShallow(s => {
      const room = s.rooms[roomID]
      return readers.map(userID => {
        const rowid = room?.state['m.room.member']?.[userID]
        return displayNameOf(userID, rowid === undefined ? undefined : (s.events[rowid]?.content as { displayname?: unknown }))
      })
    }),
  )
  // Most recent readers are last; show those.
  const shown = readers.slice(-MAX_AVATARS)
  const hidden = readers.length - shown.length

  return (
    <div className="read-receipts flex shrink-0 items-center justify-end gap-1"title={`Read by ${formatNames(names)}`} aria-label={`Read by ${formatNames(names)}`}>
      {hidden > 0 && <span className="text-[10px] tabular-nums text-muted">+{hidden}</span>}
      <span className="flex -space-x-1">
        {shown.map(userID => (
          <motion.span
            key={userID}
            layoutId={`receipt:${roomID}:${userID}`}
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: 'spring', stiffness: 420, damping: 34 }}
            className="read-receipt block rounded-full ring-2 ring-[var(--timeline-bg)]"
          >
            <ReceiptAvatar roomID={roomID} userID={userID} />
          </motion.span>
        ))}
      </span>
    </div>
  )
})
