// Ignored users (m.ignored_user_list account data). The homeserver stops sending an ignored user's events
// and invites; messages from them that are already loaded are hidden client-side too.
import { client } from '@/api/client'
import type { UserID } from '@/api/types'
import { useChat, type ChatSnapshot } from './chat'

export const IGNORED_USERS_TYPE = 'm.ignored_user_list'

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)

const contentOf = (chat: ChatSnapshot) => chat.accountData[IGNORED_USERS_TYPE]?.content

export function ignoredUsersOf(content: Record<string, unknown> | undefined): UserID[] {
  const users = content?.ignored_users
  return isObject(users) ? Object.keys(users).filter(userID => userID.startsWith('@')) : []
}

let cache: { content: unknown; set: ReadonlySet<UserID> } | null = null

export function ignoredUserSet(chat: ChatSnapshot): ReadonlySet<UserID> {
  const content = contentOf(chat)
  if (cache && cache.content === content) return cache.set
  cache = { content, set: new Set(ignoredUsersOf(content)) }
  return cache.set
}

export const useIgnoredUsers = () => useChat(ignoredUserSet)

export const useIsIgnored = (userID: UserID) => useChat(s => ignoredUserSet(s).has(userID))

/** Adds or removes a user, keeping everything else in the account data event. */
export async function setIgnored(userID: UserID, ignored: boolean) {
  const content = contentOf(useChat.getState()) ?? {}
  const users = { ...(isObject(content.ignored_users) ? content.ignored_users : {}) }
  if (ignored === userID in users) return
  if (ignored) users[userID] = {}
  else delete users[userID]
  await client.setAccountData(IGNORED_USERS_TYPE, { ...content, ignored_users: users })
}
