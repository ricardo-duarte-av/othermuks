// Global Matrix profiles (get_profile), cached per user. Per-room names/avatars come from room state instead.
import { create } from 'zustand'
import { client } from '@/api/client'
import type { GetProfileResponse, UserID } from '@/api/types'

export interface ProfileEntry {
  loading: boolean
  profile?: GetProfileResponse['profile']
  bio?: GetProfileResponse['bio']
  error?: string
  fetchedAt?: number
}

export const useProfiles = create<{ profiles: Record<UserID, ProfileEntry> }>()(() => ({ profiles: {} }))

function patch(userID: UserID, entry: Partial<ProfileEntry>) {
  useProfiles.setState(s => ({ profiles: { ...s.profiles, [userID]: { ...(s.profiles[userID] ?? { loading: false }), ...entry } } }))
}

const FRESH_MS = 30_000

export async function loadProfile(userID: UserID, force = false) {
  const current = useProfiles.getState().profiles[userID]
  if (current?.loading) return
  if (!force && current?.fetchedAt && Date.now() - current.fetchedAt < FRESH_MS) return
  patch(userID, { loading: true, error: undefined })
  try {
    const resp = await client.exec<GetProfileResponse>('get_profile', { user_id: userID })
    patch(userID, { loading: false, profile: resp.profile, bio: resp.bio, fetchedAt: Date.now() })
  } catch (err) {
    patch(userID, { loading: false, error: err instanceof Error ? err.message : String(err) })
  }
}
