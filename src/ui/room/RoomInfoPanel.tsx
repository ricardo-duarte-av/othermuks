import { ArrowLeft, ArrowRight, Braces, Copy, X } from 'lucide-react'
import type { ReactNode } from 'react'
import type { RoomID, UserID } from '@/api/types'
import { formatFull } from '@/lib/format'
import { useChat } from '@/store/chat'
import { displayNameOf } from '@/store/events'
import { useMember } from '@/store/hooks'
import { followRoomUpgrade, openRoomPreview } from '@/store/membership'
import { closeRoomTool, openProfile, openRoom, openStateExplorer, showToast } from '@/store/ui'
import { IconButton } from '@/ui/primitives'

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err))
const str = (value: unknown) => (typeof value === 'string' && value ? value : undefined)
const serverOf = (id: string) => (id.includes(':') ? id.slice(id.indexOf(':') + 1) : undefined)

const JOIN_RULES: Record<string, string> = {
  public: 'Anyone can join',
  invite: 'Invite only',
  knock: 'Anyone can ask to join',
  restricted: 'Members of allowed rooms',
  knock_restricted: 'Members of allowed rooms, or ask to join',
  private: 'Private',
}

const HISTORY_VISIBILITY: Record<string, string> = {
  world_readable: 'Anyone, even without joining',
  shared: 'Members, including history from before they joined',
  invited: 'Members, from when they were invited',
  joined: 'Members, from when they joined',
}

/** The content of a room's state event with an empty state key, as the store currently has it. */
function useStateContent(roomID: RoomID, type: string) {
  return useChat(s => {
    const rowid = s.rooms[roomID]?.state[type]?.['']
    return rowid === undefined ? undefined : s.events[rowid]
  })
}

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text)
    showToast(`${what} copied`)
  } catch (err) {
    showToast(`Couldn't copy: ${errorText(err)}`)
  }
}

/** Opens a room we're in, or the join screen for one we're not. */
function goToRoom(roomID: RoomID, viaFrom: string) {
  if (useChat.getState().rooms[roomID]) openRoom(roomID)
  else void openRoomPreview({ roomID, via: [serverOf(viaFrom)].filter((s): s is string => !!s) })
}

/**
 * The room's technical details in one place: its ID and addresses (each a click from the clipboard),
 * version and creation, who can join and read, and where it was upgraded from or to. Everything
 * else is one step away in the state explorer.
 */
export function RoomInfoPanel({ roomID }: { roomID: RoomID }) {
  const meta = useChat(s => s.rooms[roomID]?.meta)
  const create = useStateContent(roomID, 'm.room.create')
  const aliases = useStateContent(roomID, 'm.room.canonical_alias')
  const joinRules = useStateContent(roomID, 'm.room.join_rules')
  const history = useStateContent(roomID, 'm.room.history_visibility')
  const guests = useStateContent(roomID, 'm.room.guest_access')
  const encryption = useStateContent(roomID, 'm.room.encryption')
  const tombstone = useStateContent(roomID, 'm.room.tombstone')
  if (!meta) return null

  const canonical = str(aliases?.content.alias)
  const altAliases = Array.isArray(aliases?.content.alt_aliases)
    ? (aliases.content.alt_aliases as unknown[]).filter((a): a is string => typeof a === 'string' && a !== canonical)
    : []
  const createContent = create?.content ?? {}
  const roomType = str(createContent.type)
  const additionalCreators = Array.isArray(createContent.additional_creators)
    ? (createContent.additional_creators as unknown[]).filter((u): u is string => typeof u === 'string')
    : []
  const predecessor = createContent.predecessor as { room_id?: unknown } | undefined
  const predecessorID = str(predecessor?.room_id)
  const replacement = str(tombstone?.content.replacement_room)
  const joinRule = str(joinRules?.content.join_rule)
  const allowRooms = Array.isArray(joinRules?.content.allow)
    ? (joinRules.content.allow as { room_id?: unknown }[]).map(a => str(a?.room_id)).filter((id): id is string => !!id)
    : []
  const visibility = str(history?.content.history_visibility)
  const summary = meta.lazy_load_summary
  const link = `https://matrix.to/#/${encodeURIComponent(canonical ?? roomID)}`

  return (
    <>
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4">
        <h2 className="text-sm font-semibold">Room info</h2>
        <IconButton label="Close" shortcut="Esc" className="ml-auto" onClick={closeRoomTool}>
          <X size={16} />
        </IconButton>
      </div>
      <div className="room-info min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4 text-sm">
        <Section title="Identity">
          <Row label="Room ID">
            <Copyable value={roomID} what="Room ID" />
          </Row>
          <Row label="Main address">{canonical ? <Copyable value={canonical} what="Address" /> : <None>No published address</None>}</Row>
          {altAliases.length > 0 && (
            <Row label="Other addresses">
              {altAliases.map(alias => (
                <Copyable key={alias} value={alias} what="Address" />
              ))}
            </Row>
          )}
          <Row label="Link">
            <Copyable value={link} what="Link" />
          </Row>
        </Section>

        <Section title="Room">
          <Row label="Type">
            {roomType === 'm.space' ? 'Space' : roomType === 'org.matrix.msc3417.call' ? 'Call room' : roomType ? <Mono>{roomType}</Mono> : 'Room'}
          </Row>
          <Row label="Version">{str(createContent.room_version) ?? '1'}</Row>
          {create && (
            <Row label="Created">
              <span className="block">
                by <UserName roomID={roomID} userID={create.sender} />
                {additionalCreators.map(userID => (
                  <span key={userID}>
                    , <UserName roomID={roomID} userID={userID} />
                  </span>
                ))}
              </span>
              <span className="block text-xs text-muted">{formatFull(create.timestamp)}</span>
            </Row>
          )}
          {createContent['m.federate'] === false && <Row label="Federation">Only users on {serverOf(create?.sender ?? '') ?? 'its server'}</Row>}
          {summary && (
            <Row label="Members">
              {summary['m.joined_member_count'] ?? 0} joined
              {!!summary['m.invited_member_count'] && `, ${summary['m.invited_member_count']} invited`}
            </Row>
          )}
        </Section>

        <Section title="Access">
          <Row label="Who can join">
            {joinRule ? (JOIN_RULES[joinRule] ?? <Mono>{joinRule}</Mono>) : <None>Unknown</None>}
            {allowRooms.map(id => (
              <Mono key={id} className="block text-xs">
                {id}
              </Mono>
            ))}
          </Row>
          <Row label="Who can read history">{visibility ? (HISTORY_VISIBILITY[visibility] ?? <Mono>{visibility}</Mono>) : <None>Unknown</None>}</Row>
          <Row label="Guests">{guests?.content.guest_access === 'can_join' ? 'Can join' : 'Not allowed'}</Row>
          <Row label="Encryption">{encryption ? <Mono>{str(encryption.content.algorithm) ?? 'Enabled'}</Mono> : 'Not encrypted'}</Row>
        </Section>

        {(predecessorID || replacement) && (
          <Section title="Upgrades">
            {predecessorID && (
              <Row label="Upgraded from">
                <RoomLink roomID={predecessorID} onClick={() => goToRoom(predecessorID, create?.sender ?? roomID)} back />
              </Row>
            )}
            {replacement && tombstone && (
              <Row label="Replaced by">
                <RoomLink
                  roomID={replacement}
                  onClick={() =>
                    void followRoomUpgrade(roomID, replacement, tombstone.sender).catch(err => showToast(`Couldn't join the new room: ${errorText(err)}`))
                  }
                />
              </Row>
            )}
          </Section>
        )}

        <button
          type="button"
          onClick={() => openStateExplorer(roomID)}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium text-muted transition-colors hover:bg-hover hover:text-fg"
        >
          <Braces size={14} /> Explore room state
        </button>
      </div>
    </>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">{title}</h3>
      <dl className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">{children}</dl>
    </section>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="px-3 py-2">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 min-w-0 break-words">{children}</dd>
    </div>
  )
}

const None = ({ children }: { children: ReactNode }) => <span className="text-muted">{children}</span>

const Mono = ({ children, className }: { children: ReactNode; className?: string }) => (
  <span className={`font-mono text-[13px] ${className ?? ''}`}>{children}</span>
)

/** A value shown in full (IDs are long; wrapping beats truncating something people copy), copied on click. */
function Copyable({ value, what }: { value: string; what: string }) {
  return (
    <button
      type="button"
      onClick={() => void copy(value, what)}
      title={`Copy ${what.toLowerCase()}`}
      className="group/copy flex w-full items-start gap-1.5 text-left"
    >
      <span className="min-w-0 flex-1 break-all font-mono text-[13px]">{value}</span>
      <Copy size={13} className="mt-0.5 shrink-0 text-muted opacity-0 transition-opacity group-hover/copy:opacity-100" />
    </button>
  )
}

function UserName({ roomID, userID }: { roomID: RoomID; userID: UserID }) {
  const member = useMember(roomID, userID)
  return (
    <button type="button" onClick={() => openProfile(userID)} title={userID} className="font-medium hover:underline">
      {displayNameOf(userID, member)}
    </button>
  )
}

function RoomLink({ roomID, onClick, back }: { roomID: RoomID; onClick: () => void; back?: boolean }) {
  const name = useChat(s => s.rooms[roomID]?.meta.name)
  return (
    <button type="button" onClick={onClick} className="flex w-full items-start gap-1.5 text-left text-accent hover:underline">
      {back ? <ArrowLeft size={14} className="mt-0.5 shrink-0" /> : <ArrowRight size={14} className="mt-0.5 shrink-0" />}
      <span className="min-w-0 break-all">{name ?? <Mono>{roomID}</Mono>}</span>
    </button>
  )
}
