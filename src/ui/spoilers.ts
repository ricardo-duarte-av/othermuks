// Inline spoilers in message HTML. gomuks rewrites <span data-mx-spoiler="reason"> into a
// span.spoiler-reason label followed by span.hicli-spoiler; HTML it doesn't touch (profile bios) keeps
// the original attribute. Either is hidden until clicked, and a click hides it again. The HTML is
// injected as a string, so the state lives on the elements (data-revealed) and, for messages, in a
// session-wide record: the timeline only renders rows on screen, and a spoiler revealed in a row
// that scrolls away and back should still be revealed.
import type { KeyboardEvent, MouseEvent } from 'react'

export const SPOILER_SELECTOR = 'span.hicli-spoiler, span[data-mx-spoiler]'

/** Revealed spoilers per message, by their position in its HTML. */
const revealed = new Map<string, Set<number>>()

function setRevealed(spoiler: HTMLElement, on: boolean) {
  spoiler.toggleAttribute('data-revealed', on)
  spoiler.setAttribute('aria-expanded', String(on))
}

/** Puts back the spoilers revealed earlier, after the HTML is (re)mounted. */
export function restoreSpoilers(container: HTMLElement | null, key: string | undefined) {
  const indices = key ? revealed.get(key) : undefined
  if (!container || !indices?.size) return
  container.querySelectorAll<HTMLElement>(SPOILER_SELECTOR).forEach((spoiler, index) => {
    if (indices.has(index)) setRevealed(spoiler, true)
  })
}

function toggle(container: HTMLElement, spoiler: HTMLElement, key: string | undefined) {
  const on = !spoiler.hasAttribute('data-revealed')
  setRevealed(spoiler, on)
  if (!key) return
  const index = Array.from(container.querySelectorAll(SPOILER_SELECTOR)).indexOf(spoiler)
  const indices = revealed.get(key) ?? new Set<number>()
  if (on) indices.add(index)
  else indices.delete(index)
  if (indices.size) revealed.set(key, indices)
  else revealed.delete(key)
}

/**
 * Handles a click inside message HTML if it landed on a spoiler: a hidden one reveals (a link in it
 * doesn't fire), a revealed one hides again unless the click was on a link in it. Returns whether
 * the click was the spoiler's, so the caller leaves it alone (and a reply preview doesn't jump).
 */
export function handleSpoilerClick(e: MouseEvent<HTMLElement>, key?: string): boolean {
  const spoiler = (e.target as HTMLElement).closest<HTMLElement>(SPOILER_SELECTOR)
  if (!spoiler || !e.currentTarget.contains(spoiler)) return false
  const onLink = !!(e.target as HTMLElement).closest('a')
  if (spoiler.hasAttribute('data-revealed') && onLink) return false
  e.preventDefault()
  e.stopPropagation()
  toggle(e.currentTarget, spoiler, key)
  return true
}

/** Enter or Space on a focused spoiler toggles it, as a click would. */
export function handleSpoilerKey(e: KeyboardEvent<HTMLElement>, key?: string) {
  if (e.key !== 'Enter' && e.key !== ' ') return
  const spoiler = e.target as HTMLElement
  if (!spoiler.matches?.(SPOILER_SELECTOR) || !e.currentTarget.contains(spoiler)) return
  e.preventDefault()
  e.stopPropagation()
  toggle(e.currentTarget, spoiler, key)
}
