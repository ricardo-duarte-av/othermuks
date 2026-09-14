import { Lock, PanelRight, Search, Upload } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { memo, useEffect, useRef, useState, type DragEvent } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { RoomID, UserID } from '@/api/types'
import { formatNames } from '@/lib/format'
import { loadRoomState, selectOwnUserID, uploadAndSend, useChat } from '@/store/chat'
import { displayNameOf } from '@/store/events'
import { useMember } from '@/store/hooks'
import { closeEventContext, useEventContext } from '@/store/navigation'
import { useUI } from '@/store/ui'
import { Avatar, IconButton } from '@/ui/primitives'
import { ContextTimeline } from '@/ui/timeline/ContextTimeline'
import { Timeline } from '@/ui/timeline/Timeline'
import { Composer } from './Composer'

function RoomHeader({ roomID }: { roomID: RoomID }) {
  const meta = useChat(s => s.rooms[roomID]?.meta)
  const detailsVisible = useUI(s => s.drawerOpen && !s.threadRoot && !s.profileUserID)
  if (!meta) return null
  return (
    <header className="room-header flex h-14 shrink-0 items-center gap-3 border-b border-border px-4">
      <Avatar mxc={meta.avatar} id={meta.dm_user_id ?? roomID} name={meta.name} size={32} />
      <div className="min-w-0 flex-1 leading-tight">
        <h1 className="flex items-center gap-1.5 truncate text-[15px] font-semibold">
          {meta.name ?? roomID}
          {meta.encryption_event && <Lock size={12} className="shrink-0 text-muted" aria-label="Encrypted" />}
        </h1>
        {meta.topic && <p className="truncate text-xs text-muted">{meta.topic}</p>}
      </div>
      <IconButton label="Search" shortcut="Ctrl K" onClick={() => useUI.setState({ paletteOpen: true })}>
        <Search size={17} />
      </IconButton>
      <IconButton
        label="Room details"
        shortcut="Ctrl ."
        data-active={detailsVisible || undefined}
        onClick={() => useUI.setState({ drawerOpen: !detailsVisible, threadRoot: null, profileUserID: null })}
      >
        <PanelRight size={17} />
      </IconButton>
    </header>
  )
}

const NO_USERS: UserID[] = []
const MAX_TYPING_AVATARS = 5

const TypingAvatar = memo(function TypingAvatar({ roomID, userID }: { roomID: RoomID; userID: UserID }) {
  const member = useMember(roomID, userID)
  return (
    <motion.span
      layout
      initial={{ opacity: 0, scale: 0.5 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.5 }}
      transition={{ type: 'spring', stiffness: 460, damping: 32 }}
      className="block rounded-full ring-2 ring-[var(--timeline-bg)]"
      title={userID}
    >
      <Avatar mxc={member?.avatar_url} id={userID} name={displayNameOf(userID, member)} size={18} />
    </motion.span>
  )
})

function TypingIndicator({ roomID }: { roomID: RoomID }) {
  const typing = useChat(
    useShallow(s => {
      const room = s.rooms[roomID]
      const own = selectOwnUserID(s)
      return room?.typing.length ? room.typing.filter(userID => userID !== own) : NO_USERS
    }),
  )
  const names = useChat(
    useShallow(s => {
      const room = s.rooms[roomID]
      return typing.map(userID => {
        const rowid = room?.state['m.room.member']?.[userID]
        return displayNameOf(userID, rowid === undefined ? undefined : (s.events[rowid]?.content as { displayname?: unknown }))
      })
    }),
  )
  const description =
    typing.length > 4 ? `${typing.length} people are typing` : `${formatNames(names)} ${typing.length === 1 ? 'is' : 'are'} typing`

  return (
    <div className="typing-indicator flex h-6 shrink-0 items-center px-5 text-xs text-muted" aria-live="polite">
      <AnimatePresence>
        {typing.length > 0 && (
          <motion.div
            key="typing"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.15 }}
            className="flex min-w-0 items-center gap-2"
          >
            <span className="flex shrink-0 -space-x-1.5">
              <AnimatePresence initial={false}>
                {typing.slice(0, MAX_TYPING_AVATARS).map(userID => (
                  <TypingAvatar key={userID} roomID={roomID} userID={userID} />
                ))}
              </AnimatePresence>
            </span>
            <span className="truncate">{description}</span>
            <span className="typing-dots flex shrink-0 items-end gap-0.5 pb-0.5" aria-hidden>
              <i />
              <i />
              <i />
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export function RoomView({ roomID }: { roomID: RoomID }) {
  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)
  const showContext = useEventContext(s => s.view?.roomID === roomID)

  useEffect(() => {
    void loadRoomState(roomID)
    // A context view left open for another room shouldn't come back later.
    const view = useEventContext.getState().view
    if (view && view.roomID !== roomID) closeEventContext()
  }, [roomID])

  const hasFiles = (e: DragEvent) => e.dataTransfer.types.includes('Files')

  return (
    <div
      className="room-view relative flex min-h-0 flex-1 flex-col"
      onDragEnter={e => {
        if (!hasFiles(e)) return
        dragDepth.current++
        setDragging(true)
      }}
      onDragOver={e => {
        if (hasFiles(e)) e.preventDefault()
      }}
      onDragLeave={e => {
        if (!hasFiles(e)) return
        dragDepth.current = Math.max(0, dragDepth.current - 1)
        if (dragDepth.current === 0) setDragging(false)
      }}
      onDrop={e => {
        if (!hasFiles(e)) return
        e.preventDefault()
        dragDepth.current = 0
        setDragging(false)
        uploadAndSend(roomID, Array.from(e.dataTransfer.files)).catch(err => console.error('Upload failed', err))
      }}
    >
      <RoomHeader roomID={roomID} />
      <div className="relative flex min-h-0 flex-1 flex-col">
        <Timeline roomID={roomID} />
        <AnimatePresence>{showContext && <ContextTimeline key="event-context" roomID={roomID} />}</AnimatePresence>
      </div>
      <TypingIndicator roomID={roomID} />
      <Composer roomID={roomID} />
      <AnimatePresence>
        {dragging && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            className="drop-overlay pointer-events-none absolute inset-3 z-30 grid place-items-center rounded-2xl border-2 border-dashed border-accent bg-bg/80 backdrop-blur-sm"
          >
            <div className="flex flex-col items-center gap-2 text-accent">
              <Upload size={32} />
              <span className="text-sm font-medium">Drop files to upload</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
