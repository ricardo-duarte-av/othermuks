import { normalizeShortcode, type CustomEmoji, type PackEntry } from '@/store/emoji'
import type { UnicodeData, UnicodeEmoji } from './unicode'

export type PickerTab = 'emoji' | 'stickers'

export type PickerSelection =
  | { kind: 'unicode'; text: string }
  | { kind: 'custom'; emoji: CustomEmoji }
  | { kind: 'sticker'; emoji: CustomEmoji }

/** One cell in the picker or autocomplete. `text` pins a specific variant (e.g. a recently used skin tone). */
export type EmojiItem = { kind: 'unicode'; emoji: UnicodeEmoji; text?: string } | { kind: 'custom'; emoji: CustomEmoji }

export const withTone = (emoji: UnicodeEmoji, tone: number) => (tone > 0 && emoji.skins?.[tone - 1]) || emoji.unicode

export const itemKey = (item: EmojiItem) =>
  item.kind === 'custom' ? `c:${item.emoji.packID}:${item.emoji.key}` : `u:${item.text ?? item.emoji.unicode}`

export const itemShortcode = (item: EmojiItem) => {
  const code = item.kind === 'custom' ? item.emoji.shortcode : item.emoji.shortcodes[0]
  return code ? `:${code}:` : ''
}

export const itemName = (item: EmojiItem) => {
  const name = item.kind === 'custom' ? item.emoji.title : item.emoji.label
  return name ? name[0].toUpperCase() + name.slice(1) : ''
}

/** Every custom emoji (or sticker) across packs, once per image. */
export function uniqueCustom(packs: PackEntry[], kind: 'emojis' | 'stickers'): CustomEmoji[] {
  const seen = new Set<string>()
  const out: CustomEmoji[] = []
  for (const { pack } of packs) {
    for (const emoji of pack[kind]) {
      if (seen.has(emoji.key)) continue
      seen.add(emoji.key)
      out.push(emoji)
    }
  }
  return out
}

function matchIndex(search: string[], query: string): number {
  let best = -1
  for (const term of search) {
    const index = term.indexOf(query)
    if (index !== -1 && (best === -1 || index < best)) best = index
  }
  return best
}

/** Shortcode search, ranked by how early the match starts, then by how often it's used (like gomuks). */
export function searchEmoji(
  query: string,
  unicode: UnicodeData | null,
  custom: CustomEmoji[],
  frequent: Map<string, number>,
  limit: number,
): EmojiItem[] {
  // ":name:" and "name" search the same.
  const q = normalizeShortcode(query.trim().replace(/^:+|:+$/g, ''))
  if (!q) return []
  const scored: { item: EmojiItem; index: number; uses: number }[] = []
  for (const emoji of custom) {
    const index = matchIndex(emoji.search, q)
    if (index !== -1) scored.push({ item: { kind: 'custom', emoji }, index, uses: frequent.get(emoji.key) ?? 0 })
  }
  for (const group of unicode?.groups ?? []) {
    for (const emoji of group.emojis) {
      const index = matchIndex(emoji.search, q)
      if (index !== -1) scored.push({ item: { kind: 'unicode', emoji }, index, uses: frequent.get(emoji.unicode) ?? 0 })
    }
  }
  scored.sort((a, b) => a.index - b.index || b.uses - a.uses)
  return scored.slice(0, limit).map(entry => entry.item)
}

/** The most used emoji that are still available (custom ones need their pack). */
export function frequentItems(frequent: Map<string, number>, unicode: UnicodeData | null, custom: CustomEmoji[], limit = 27): EmojiItem[] {
  const byKey = new Map(custom.map(emoji => [emoji.key, emoji]))
  const items: EmojiItem[] = []
  for (const key of frequent.keys()) {
    if (items.length >= limit) break
    if (key.startsWith('mxc://')) {
      const emoji = byKey.get(key)
      if (emoji) items.push({ kind: 'custom', emoji })
    } else {
      const emoji = unicode?.byUnicode.get(key)
      if (emoji) items.push({ kind: 'unicode', emoji, text: key })
    }
  }
  return items
}
