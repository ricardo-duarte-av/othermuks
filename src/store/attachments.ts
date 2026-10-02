// Files waiting in a composer. Attaching stages them instead of sending, so they can carry a caption
// and go out as a reply; dropping a file on the room view stages it in that room's composer too.
import { create } from 'zustand'
import type { EventID, RoomID } from '@/api/types'

/** One staging area per composer: the room's own, and one per open thread. */
export const attachmentKey = (roomID: RoomID, threadRoot?: EventID) => (threadRoot ? `${roomID}|${threadRoot}` : roomID)

const NO_FILES: File[] = []

export const useAttachments = create<{ staged: Record<string, File[]>; spoilerVersion: number }>()(() => ({ staged: {}, spoilerVersion: 0 }))

/**
 * Files to send as spoilers (MSC4193). Weak, and keyed by the File itself, so a mark survives the
 * files being cleared for sending and handed back on failure, and goes when the file does.
 */
const spoilers = new WeakSet<File>()

export const isSpoilerAttachment = (file: File) => spoilers.has(file)

/** Whether a staged file is marked as a spoiler; re-renders when any mark changes. */
export function useIsSpoilerAttachment(file: File): boolean {
  useAttachments(s => s.spoilerVersion)
  return spoilers.has(file)
}

export function setSpoilerAttachment(file: File, spoiler: boolean) {
  if (spoiler) spoilers.add(file)
  else spoilers.delete(file)
  useAttachments.setState(s => ({ spoilerVersion: s.spoilerVersion + 1 }))
}

export function useStagedFiles(key: string): File[] {
  return useAttachments(s => s.staged[key] ?? NO_FILES)
}

export function stageAttachments(key: string, files: File[]) {
  if (!files.length) return
  useAttachments.setState(s => ({ staged: { ...s.staged, [key]: [...(s.staged[key] ?? []), ...files] } }))
}

export function removeAttachment(key: string, index: number) {
  useAttachments.setState(s => {
    const files = s.staged[key]
    if (!files) return s
    const next = files.filter((_, i) => i !== index)
    const staged = { ...s.staged }
    if (next.length) staged[key] = next
    else delete staged[key]
    return { staged }
  })
}

export function clearAttachments(key: string) {
  useAttachments.setState(s => {
    if (!s.staged[key]) return s
    const staged = { ...s.staged }
    delete staged[key]
    return { staged }
  })
}
