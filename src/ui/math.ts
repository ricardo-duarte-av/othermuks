// LaTeX in messages. gomuks turns a sender's data-mx-maths span into <hicli-math latex="…">, with
// the source in a <code> child as the fallback; sanitizeHTML keeps the tag so this custom element
// can upgrade it in place. KaTeX is a few hundred KB with its fonts, so it is fetched on the first
// message that actually has maths in it and the fallback stands in until it arrives.
import { log } from '@/lib/log'

export const MATH_TAG = 'hicli-math'

let katex: Promise<typeof import('katex').default> | null = null

const loadKatex = () =>
  (katex ??= Promise.all([import('katex'), import('katex/dist/katex.min.css')]).then(([module]) => module.default))

/** Rendering the same formula twice is common (an edit, a reply preview, a re-mount while scrolling). */
const cache = new Map<string, string>()
const CACHE_LIMIT = 500

class MathElement extends HTMLElement {
  /** Set once the fallback has been replaced, so scrolling back to a message doesn't re-render it. */
  #rendered = false

  connectedCallback() {
    if (this.#rendered) return
    const latex = this.getAttribute('latex')
    if (!latex) return
    const displayMode = this.getAttribute('displaymode') === 'block'
    const key = `${displayMode ? 'block' : 'inline'}\0${latex}`
    const cached = cache.get(key)
    if (cached !== undefined) {
      this.#render(cached)
      return
    }
    void loadKatex().then(katex => {
      // KaTeX escapes what it emits and \htmlClass and friends need trust, which stays off.
      const html = katex.renderToString(latex, { displayMode, throwOnError: true, strict: false })
      if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!)
      cache.set(key, html)
      this.#render(html)
    })
      // Invalid maths keeps the <code> fallback, which is the source the sender wrote anyway.
      .catch((err: unknown) => log.debug(`rendering maths failed: ${err}`))
  }

  #render(html: string) {
    this.#rendered = true
    this.innerHTML = html
  }
}

/** Defined once at startup: elements parsed from message HTML upgrade themselves on insertion. */
export function registerMath() {
  if (!customElements.get(MATH_TAG)) customElements.define(MATH_TAG, MathElement)
}
