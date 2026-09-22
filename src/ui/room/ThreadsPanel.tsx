// Every thread of the room in one list, newest activity first: threads are easy to lose in a busy
// timeline, and a reply only shows up there behind its root.
import { MessagesSquare, X } from 'lucide-react'
import { useEffect } from 'react'
import type { EventID, RoomID } from '@/api/types'
import { cn } from '@/lib/cn'
import { formatRoomTime } from '@/lib/format'
import { fetchEvent, useChat } from '@/store/chat'
import { displayNameOf, previewText } from '@/store/events'
import { useMember } from '@/store/hooks'
import { completeThread, useLatestReply, useRoomThreads, useThreadMentionsMe } from '@/store/threads'
import { closeRoomTool, openThread } from '@/store/ui'
import { Avatar, IconButton } from '@/ui/primitives'
import { PanelMessage } from './EventResults'

export function ThreadsPanel({ roomID }: { roomID: RoomID }) {
  const roots = useRoomThreads(roomID)

  return (
    <>
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4">
        <h2 className="text-sm font-semibold">Threads</h2>
        {roots.length > 0 && <span className="rounded-full bg-surface-2 px-1.5 py-px text-xs tabular-nums text-muted">{roots.length}</span>}
        <IconButton label="Close" shortcut="Esc" className="ml-auto" onClick={closeRoomTool}>
          <X size={16} />
        </IconButton>
      </div>
      <div className="threads-list min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-3">
        {roots.length === 0 ? (
          <PanelMessage
            icon={<MessagesSquare size={26} />}
            title="No threads yet"
            detail="Threads of this room appear here as their replies arrive. Reply in a thread from a message's menu."
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {roots.map(rootID => (
              <ThreadItem key={rootID} roomID={roomID} rootID={rootID} />
            ))}
          </ul>
        )}
      </div>
    </>
  )
}

function ThreadItem({ roomID, rootID }: { roomID: RoomID; rootID: EventID }) {
  const rootRowID = useChat(s => s.eventIDs[rootID])
  const root = useChat(s => (rootRowID === undefined ? undefined : s.events[rootRowID]))
  const count = useChat(s => s.threads[rootID]?.length ?? 0)
  const latestRowID = useLatestReply(rootID)
  const latest = useChat(s => (latestRowID === undefined ? undefined : s.events[latestRowID]))
  const mentionsMe = useThreadMentionsMe(rootID)
  const rootMember = useMember(roomID, root?.sender)
  const latestMember = useMember(roomID, latest?.sender)

  // The root itself is often outside the loaded timeline; the list needs it for the title.
  useEffect(() => {
    if (rootRowID === undefined) void fetchEvent(roomID, rootID)
  }, [roomID, rootID, rootRowID])

  // One known reply is enough to page the rest of the thread, so the count and the newest reply
  // below are the thread's own, not just the part the timeline had loaded.
  useEffect(() => {
    void completeThread(roomID, rootID)
  }, [roomID, rootID])

  const rootName = root ? displayNameOf(root.sender, rootMember) : ''
  const latestName = latest ? displayNameOf(latest.sender, latestMember) : ''

  return (
    <li>
      <button
        type="button"
        onClick={() => openThread(rootID)}
        className={cn(
          'thread-item flex w-full gap-2.5 rounded-xl border border-border bg-[var(--timeline-bg)] p-2.5 text-left transition-colors hover:bg-hover',
          mentionsMe && 'border-accent',
        )}
      >
        {root ? (
          <Avatar mxc={rootMember?.avatar_url} id={root.sender} name={rootName} size={28} />
        ) : (
          <span className="size-7 shrink-0 rounded-full bg-surface-2" />
        )}
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className="min-w-0 truncate text-[13px] font-medium">{root ? rootName : 'Thread'}</span>
            <time className="ml-auto shrink-0 text-[11px] text-muted" dateTime={new Date(latest?.timestamp ?? 0).toISOString()}>
              {formatRoomTime(latest?.timestamp ?? 0)}
            </time>
          </span>
          <span className="mt-0.5 block truncate text-xs text-fg/80">{root ? previewText(root) : 'Loading the first message…'}</span>
          <span className="mt-1 flex items-center gap-1.5 text-[11px] text-muted">
            <MessagesSquare size={12} className="shrink-0 text-accent" />
            <span className="shrink-0 font-medium text-accent">
              {count} {count === 1 ? 'reply' : 'replies'}
            </span>
            {latest && (
              <span className="min-w-0 truncate">
                · {latestName}: {previewText(latest)}
              </span>
            )}
            {mentionsMe && <span className="ml-auto shrink-0 rounded-full bg-accent px-1.5 py-px text-[10px] font-semibold text-accent-fg">@</span>}
          </span>
        </span>
      </button>
    </li>
  )
}
