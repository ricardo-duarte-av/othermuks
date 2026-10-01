// Top-level space order (MSC3230): each space's own room account data holds an "order" string, and
// spaces sort by it, those without one last. gomuks computes top_level_spaces that way and sends a
// fresh list whenever the account data changes, so reordering is just rewriting those strings.
import { client } from '@/api/client'
import type { RoomID } from '@/api/types'
import { useChat } from './chat'

export const SPACE_ORDER_TYPE = 'org.matrix.msc3230.space_order'

/** Fixed-width digits: string order is numeric order, and the gaps leave other clients room to insert. */
const orderKey = (index: number) => String((index + 1) * 100).padStart(6, '0')

/**
 * Saves `spaces` as the top-level order. Only spaces whose order string changes are written, all at
 * once so they tend to land in one sync; the rail shows the new order straight away rather than
 * waiting for gomuks to send it back.
 */
export async function saveSpaceOrder(spaces: RoomID[]) {
  const s = useChat.getState()
  const writes = spaces.flatMap((spaceID, index) => {
    const current = s.rooms[spaceID]?.accountData[SPACE_ORDER_TYPE]?.content ?? {}
    const order = orderKey(index)
    return current.order === order ? [] : [client.setAccountData(SPACE_ORDER_TYPE, { ...current, order }, spaceID)]
  })
  await Promise.all(writes)
  useChat.setState({ topLevelSpaces: spaces })
}
