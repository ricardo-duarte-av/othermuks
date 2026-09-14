import { Lock, PanelRight, Search, Upload } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState, type DragEvent } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { RoomID } from '@/api/types'
import { formatNames } from '@/lib/format'
import { loadRoomState, selectOwnUserID, uploadAndSend, useChat } from '@/store/chat'
import { useUI } from '@/store/ui'
import { Avatar, IconButton } from '@/ui/primitives'
import { Timeline } from '@/ui/timeline/Timeline'
import { Composer } from './Composer'

function RoomHeader({ roomID }: { roomID: RoomID }) {
  const meta = useChat(s => s.rooms[roomID]?.meta)
  const drawerOpen = useUI(s => s.drawerOpen)
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
        data-active={drawerOpen || undefined}
        onClick={() => useUI.setState({ drawerOpen: !drawerOpen })}
      >
        <PanelRight size={17} />
      </IconButton>
    </header>
  )
}

const NO_NAMES: string[] = []

function TypingIndicator({ roomID }: { roomID: RoomID }) {
  const names = useChat(
    useShallow(s => {
      const room = s.rooms[roomID]
      const own = selectOwnUserID(s)
      if (!room?.typing.length) return NO_NAMES
      return room.typing
        .filter(userID => userID !== own)
        .map(userID => {
          const rowid = room.state['m.room.member']?.[userID]
          const name = rowid === undefined ? undefined : s.events[rowid]?.content.displayname
          return typeof name === 'string' && name ? name : userID
        })
    }),
  )
  return (
    <div className="typing-indicator h-5 shrink-0 truncate px-5 text-xs text-muted" aria-live="polite">
      {names.length > 0 && `${formatNames(names)} ${names.length === 1 ? 'is' : 'are'} typing…`}
    </div>
  )
}

export function RoomView({ roomID }: { roomID: RoomID }) {
  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)

  useEffect(() => {
    void loadRoomState(roomID)
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
      <Timeline roomID={roomID} />
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
