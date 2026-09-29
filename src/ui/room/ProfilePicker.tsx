import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Check, UserCog } from 'lucide-react'
import type { RoomID } from '@/api/types'
import { cn } from '@/lib/cn'
import { selectOwnUserID, useChat } from '@/store/chat'
import { displayNameOf } from '@/store/events'
import { useMember } from '@/store/hooks'
import {
  describeTrigger,
  pickProfile,
  setRoomDefaultProfile,
  useGlobalProfiles,
  useRoomProfiles,
  type StoredProfile,
} from '@/store/perMessageProfiles'
import { openSettings, showToast } from '@/store/ui'
import { Avatar } from '@/ui/primitives'

const itemClass = 'flex cursor-default select-none items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-hover'

/** Radio values stand in for null ("follow the global default") and "" (no profile), which no ID can take. */
const FOLLOW_GLOBAL = '\0global'
const NO_PROFILE = '\0none'

/**
 * Who the composer's message goes out as, and the room's default. gomuks picks the profile when it
 * sends, from a trigger in the text or the default; this shows the same pick live, so a trigger
 * typed at the start of a message visibly switches the avatar before it's sent. Hidden until the
 * user has a profile stored, so the composer stays as it was for everyone else.
 */
export function ProfilePicker({ roomID, text }: { roomID: RoomID; text: string }) {
  const global = useGlobalProfiles()
  const room = useRoomProfiles(roomID)
  const ownUserID = useChat(selectOwnUserID)
  const ownMember = useMember(roomID, ownUserID)
  const profiles = [...room.profiles, ...global.profiles.filter(p => !room.profiles.some(r => r.id === p.id))]
  if (!profiles.length || !ownUserID) return null

  const ownName = displayNameOf(ownUserID, ownMember)
  const ownAvatar = typeof ownMember?.avatar_url === 'string' ? ownMember.avatar_url : undefined
  const pick = pickProfile(global, room, text)
  const globalDefault = global.default_profile_id ? global.profiles.find(p => p.id === global.default_profile_id) : undefined
  const roomValue = room.default_profile_id == null ? FOLLOW_GLOBAL : room.default_profile_id || NO_PROFILE

  const label = pick
    ? `Sending as ${pick.profile.displayname || ownName}${pick.trigger ? ` (typed ${describeTrigger(pick.trigger)})` : ''}`
    : `Sending as ${ownName}`

  const setDefault = (value: string) => {
    setRoomDefaultProfile(roomID, value === FOLLOW_GLOBAL ? null : value === NO_PROFILE ? '' : value).catch(err =>
      showToast(`Couldn't change the room's profile: ${err instanceof Error ? err.message : String(err)}`),
    )
  }

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        aria-label={label}
        title={label}
        className={cn(
          'profile-picker grid size-8 shrink-0 place-items-center rounded-full outline-none transition focus-visible:ring-2 focus-visible:ring-accent data-[state=open]:ring-2 data-[state=open]:ring-accent/60',
          pick?.trigger && 'ring-2 ring-accent',
        )}
      >
        <ProfileAvatar profile={pick?.profile} ownUserID={ownUserID} ownName={ownName} ownAvatar={ownAvatar} size={26} />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          side="top"
          align="start"
          sideOffset={8}
          collisionPadding={12}
          className="profile-menu z-50 max-h-[60vh] min-w-60 overflow-y-auto rounded-lg border border-border bg-surface p-1 text-fg shadow-xl"
        >
          <DropdownMenu.Label className="px-2 py-1.5 text-xs text-muted">Send as, in this room</DropdownMenu.Label>
          <DropdownMenu.RadioGroup value={roomValue} onValueChange={setDefault}>
            <DropdownMenu.RadioItem value={FOLLOW_GLOBAL} className={itemClass}>
              <span className="grid size-5 place-items-center text-muted">·</span>
              <span className="min-w-0 flex-1 truncate">
                Your usual default
                <span className="text-muted"> ({globalDefault?.displayname || (globalDefault ? globalDefault.id : ownName)})</span>
              </span>
              <Indicator />
            </DropdownMenu.RadioItem>
            <DropdownMenu.RadioItem value={NO_PROFILE} className={itemClass}>
              <Avatar mxc={ownAvatar} id={ownUserID} name={ownName} size={20} />
              <span className="min-w-0 flex-1 truncate">{ownName}</span>
              <Indicator />
            </DropdownMenu.RadioItem>
            {profiles.map(profile => (
              <DropdownMenu.RadioItem key={profile.id} value={profile.id} className={itemClass}>
                <ProfileAvatar profile={profile} ownUserID={ownUserID} ownName={ownName} ownAvatar={ownAvatar} size={20} />
                <span className="min-w-0 flex-1 truncate">
                  {profile.displayname || profile.id}
                  {!!profile.triggers?.length && <span className="ml-1.5 font-mono text-[11px] text-muted">{describeTrigger(profile.triggers[0])}</span>}
                </span>
                <Indicator />
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
          <DropdownMenu.Separator className="my-1 h-px bg-border" />
          <DropdownMenu.Item onSelect={() => requestAnimationFrame(() => openSettings(roomID, 'profiles'))} className={itemClass}>
            <UserCog size={15} className="text-muted" />
            Manage profiles…
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

const Indicator = () => (
  <DropdownMenu.ItemIndicator className="ml-auto text-accent">
    <Check size={14} />
  </DropdownMenu.ItemIndicator>
)

/** A stored profile's avatar, or the user's own where the profile keeps it (as a message would show). */
export function ProfileAvatar({
  profile,
  ownUserID,
  ownName,
  ownAvatar,
  size,
}: {
  profile?: StoredProfile
  ownUserID: string
  ownName: string
  ownAvatar?: string
  size: number
}) {
  if (!profile) return <Avatar mxc={ownAvatar} id={ownUserID} name={ownName} size={size} />
  const avatar = profile.avatar_url === '' ? undefined : profile.avatar_url?.startsWith('mxc://') ? profile.avatar_url : ownAvatar
  return <Avatar mxc={avatar} id={profile.id} name={profile.displayname || ownName} size={size} />
}
