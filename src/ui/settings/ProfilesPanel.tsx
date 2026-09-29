import { ImagePlus, Plus, RotateCcw, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { client } from '@/api/client'
import { cn } from '@/lib/cn'
import { selectOwnUserID, useChat } from '@/store/chat'
import { displayNameOf } from '@/store/events'
import { saveGlobalProfiles, useGlobalProfiles, type ProfileTrigger, type StoredProfile, type StoredProfiles } from '@/store/perMessageProfiles'
import { showToast } from '@/store/ui'
import { Spinner } from '@/ui/primitives'
import { ProfileAvatar } from '@/ui/room/ProfilePicker'

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err))

/** MSC4144 caps the name at 255 bytes of UTF-8. */
const MAX_NAME_BYTES = 255
const byteLength = (text: string) => new TextEncoder().encode(text).length

/** Opaque and stable: messages sent under a profile are grouped by it, so it never changes once made. */
const newProfileID = () => `p-${crypto.randomUUID().slice(0, 8)}`

/** A trigger with neither a prefix nor a suffix would match every message, so it isn't saved. */
const isUsableTrigger = (t: ProfileTrigger) => !!t.prefix || !!t.suffix

function cleanTrigger({ prefix, suffix, keep_trigger, ...rest }: ProfileTrigger): ProfileTrigger {
  return { ...rest, ...(prefix ? { prefix } : {}), ...(suffix ? { suffix } : {}), ...(keep_trigger ? { keep_trigger } : {}) }
}

function cleanProfile(profile: StoredProfile): StoredProfile {
  const { triggers, displayname, ...rest } = profile
  const usable = (triggers ?? []).filter(isUsableTrigger).map(cleanTrigger)
  return { ...rest, ...(displayname?.trim() ? { displayname: displayname.trim() } : {}), ...(usable.length ? { triggers: usable } : {}) }
}

/**
 * The profiles in global account data (MSC4461), edited as a draft and saved in one write: it's a single
 * event, so saving each keystroke would race itself. Per-room defaults are picked from the composer.
 */
export function ProfilesPanel() {
  const saved = useGlobalProfiles()
  const ownUserID = useChat(selectOwnUserID) ?? ''
  const ownName = displayNameOf(ownUserID, undefined)
  const [draft, setDraft] = useState<StoredProfiles>(saved)
  const [saving, setSaving] = useState(false)
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved)

  // Another client's change shows up here unless there's unsaved work in the way.
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty
  useEffect(() => {
    if (!dirtyRef.current) setDraft(saved)
  }, [saved])

  const update = (index: number, change: Partial<StoredProfile>) =>
    setDraft(d => ({ ...d, profiles: d.profiles.map((p, i) => (i === index ? { ...p, ...change } : p)) }))
  const remove = (index: number) =>
    setDraft(d => {
      const removed = d.profiles[index]
      return {
        ...d,
        profiles: d.profiles.filter((_, i) => i !== index),
        default_profile_id: d.default_profile_id === removed.id ? null : d.default_profile_id,
      }
    })
  const add = () => setDraft(d => ({ ...d, profiles: [...d.profiles, { id: newProfileID(), displayname: '', triggers: [{ prefix: '' }] }] }))

  const tooLong = draft.profiles.find(p => byteLength(p.displayname ?? '') > MAX_NAME_BYTES)
  const save = async () => {
    setSaving(true)
    try {
      const cleaned = { ...draft, profiles: draft.profiles.map(cleanProfile) }
      await saveGlobalProfiles(() => cleaned)
      // What was saved, dropped triggers and all, so the sync echoing it back finds nothing unsaved.
      setDraft(cleaned)
      showToast('Profiles saved')
    } catch (err) {
      showToast(`Couldn't save profiles: ${errorText(err)}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <p className="shrink-0 px-4 pt-3 text-xs text-muted">
        Send individual messages under another name and avatar. Start a message with a profile's trigger to use it for that message, or
        make one the default. Everyone can still see the messages came from your account. Saved on your account, so gomuks web uses them
        too; pick a different default for one room from the button beside the message box.
      </p>

      <div className="per-message-profiles min-h-0 flex-1 space-y-3 overflow-auto px-4 pb-4 pt-3">
        {draft.profiles.length === 0 && (
          <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted">You have no profiles yet.</p>
        )}
        {draft.profiles.map((profile, index) => (
          <ProfileCard
            key={profile.id}
            profile={profile}
            ownUserID={ownUserID}
            ownName={ownName}
            isDefault={draft.default_profile_id === profile.id}
            onDefault={on => setDraft(d => ({ ...d, default_profile_id: on ? profile.id : null }))}
            onChange={change => update(index, change)}
            onRemove={() => remove(index)}
          />
        ))}
        <button
          type="button"
          onClick={add}
          className="flex items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-2 text-sm text-muted transition-colors hover:bg-hover hover:text-fg"
        >
          <Plus size={15} /> Add profile
        </button>
      </div>

      {dirty && (
        <footer className="flex shrink-0 items-center gap-2 border-t border-border px-4 py-2.5">
          {tooLong && <span className="text-xs text-danger">“{tooLong.displayname?.slice(0, 20)}…” is too long a name</span>}
          <button
            type="button"
            onClick={() => setDraft(saved)}
            disabled={saving}
            className="ml-auto rounded-lg px-3 py-1.5 text-xs text-muted transition-colors hover:bg-hover hover:text-fg"
          >
            Discard
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || !!tooLong}
            className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg transition hover:brightness-110 disabled:opacity-60"
          >
            {saving && <Spinner size={12} />} Save changes
          </button>
        </footer>
      )}
    </>
  )
}

interface CardProps {
  profile: StoredProfile
  ownUserID: string
  ownName: string
  isDefault: boolean
  onDefault: (on: boolean) => void
  onChange: (change: Partial<StoredProfile>) => void
  onRemove: () => void
}

function ProfileCard({ profile, ownUserID, ownName, isDefault, onDefault, onChange, onRemove }: CardProps) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const triggers = profile.triggers ?? []
  const setTrigger = (index: number, change: Partial<ProfileTrigger>) =>
    onChange({ triggers: triggers.map((t, i) => (i === index ? { ...t, ...change } : t)) })

  const upload = async (file: File) => {
    setUploading(true)
    try {
      // Unencrypted: the avatar goes out with messages in any room, encrypted or not.
      const content = await client.upload(file, false)
      if (content.url) onChange({ avatar_url: content.url })
    } catch (err) {
      showToast(`Couldn't upload the avatar: ${errorText(err)}`)
    } finally {
      setUploading(false)
    }
  }

  const customAvatar = typeof profile.avatar_url === 'string' && profile.avatar_url.startsWith('mxc://')

  return (
    <section className="profile-card rounded-lg border border-border bg-surface p-3">
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          title="Upload an avatar"
          aria-label="Upload an avatar"
          className="group/avatar relative shrink-0 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <ProfileAvatar profile={profile} ownUserID={ownUserID} ownName={ownName} size={48} />
          <span className="absolute inset-0 grid place-items-center rounded-full bg-black/50 text-white opacity-0 transition-opacity group-hover/avatar:opacity-100">
            {uploading ? <Spinner size={16} /> : <ImagePlus size={18} />}
          </span>
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={e => {
            const file = e.target.files?.[0]
            if (file) void upload(file)
            e.target.value = ''
          }}
        />
        <div className="min-w-0 flex-1 space-y-1.5">
          <input
            value={profile.displayname ?? ''}
            onChange={e => onChange({ displayname: e.target.value })}
            placeholder={`Name (blank keeps “${ownName}”)`}
            aria-label="Profile name"
            className={cn(
              'h-8 w-full rounded-md border bg-bg px-2 text-sm outline-none placeholder:text-muted focus:border-accent',
              byteLength(profile.displayname ?? '') > MAX_NAME_BYTES ? 'border-danger' : 'border-border',
            )}
          />
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
            <span className="font-mono" title="Profile ID">
              {profile.id}
            </span>
            {customAvatar ? (
              <button type="button" onClick={() => onChange({ avatar_url: undefined })} className="flex items-center gap-1 hover:text-fg">
                <RotateCcw size={11} /> Use my avatar
              </button>
            ) : (
              <span>Uses your avatar</span>
            )}
            <label className="flex cursor-pointer items-center gap-1.5">
              <input type="checkbox" checked={isDefault} onChange={e => onDefault(e.target.checked)} className="accent-accent" />
              Default everywhere
            </label>
          </div>
        </div>
        <button
          type="button"
          onClick={onRemove}
          aria-label="Delete profile"
          title="Delete profile"
          className="shrink-0 rounded-md p-1.5 text-muted transition-colors hover:bg-hover hover:text-danger"
        >
          <Trash2 size={15} />
        </button>
      </div>

      <div className="mt-3 space-y-1.5">
        <div className="text-xs font-medium text-muted">Triggers</div>
        {triggers.map((trigger, index) => (
          <div key={index} className="profile-trigger flex flex-wrap items-center gap-1.5 text-xs">
            <input
              value={trigger.prefix ?? ''}
              onChange={e => setTrigger(index, { prefix: e.target.value })}
              placeholder="Starts with, e.g. cat: "
              aria-label="Prefix"
              spellCheck={false}
              className="h-7 w-40 rounded-md border border-border bg-bg px-1.5 font-mono outline-none placeholder:font-sans placeholder:text-muted focus:border-accent"
            />
            <span className="text-muted">message</span>
            <input
              value={trigger.suffix ?? ''}
              onChange={e => setTrigger(index, { suffix: e.target.value })}
              placeholder="Ends with (optional)"
              aria-label="Suffix"
              spellCheck={false}
              className="h-7 w-40 rounded-md border border-border bg-bg px-1.5 font-mono outline-none placeholder:font-sans placeholder:text-muted focus:border-accent"
            />
            <label className="flex cursor-pointer items-center gap-1 text-muted" title="Send the prefix and suffix as part of the message">
              <input
                type="checkbox"
                checked={!!trigger.keep_trigger}
                onChange={e => setTrigger(index, { keep_trigger: e.target.checked })}
                className="accent-accent"
              />
              Keep in message
            </label>
            <button
              type="button"
              onClick={() => onChange({ triggers: triggers.filter((_, i) => i !== index) })}
              aria-label="Remove trigger"
              className="rounded p-0.5 text-muted hover:bg-hover hover:text-fg"
            >
              <X size={13} />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => onChange({ triggers: [...triggers, { prefix: '' }] })}
          className="flex items-center gap-1 text-xs text-muted hover:text-fg"
        >
          <Plus size={12} /> Add trigger
        </button>
        <p className="text-[11px] text-muted">Triggers match exactly, spaces and case included. Empty ones are dropped on save.</p>
      </div>
    </section>
  )
}
