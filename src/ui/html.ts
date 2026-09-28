// gomuks already sanitizes message HTML (local_content.sanitized_html); this second pass
// is defense in depth plus client-side rewrites: mxc:// and gomuks media URLs pointed at the
// current backend, matrix.to pills, external images blocked (no tracking pixels), links opened
// in a new tab, inline images sized as the sender asked, and literal newlines kept as line breaks.
import DOMPurify from 'dompurify'
import { gomuksMediaURL, isGomuksMediaURL, mediaURL } from '@/api/media'
import { parseMatrixURI } from '@/lib/matrixURI'
import { MATH_TAG } from './math'

const purify = DOMPurify(window)
const RELATIVE_GOMUKS_MEDIA = /^\/?_gomuks\/(media\/.+)$/
const MAX_EMOJI_SIZE = 64
const MAX_INLINE_HEIGHT = 320

interface SizeHint {
  width?: number
  height?: number
  emoticon: boolean
}

/** Per-call state for the hooks below (sanitize runs synchronously). */
let currentHints: Map<string, SizeHint> | null = null
const originalSources = new WeakMap<Element, string>()

const positiveInt = (value: string | null) => {
  const n = value ? Number.parseInt(value, 10) : NaN
  return Number.isFinite(n) && n > 0 ? n : undefined
}

/**
 * gomuks's sanitized_html drops the width/height of inline images (custom emoji get a fixed class),
 * so the sizes are read back from the original formatted_body, keyed by mxc URI.
 */
function parseSizeHints(formattedBody: string): Map<string, SizeHint> | null {
  if (!formattedBody.includes('<img')) return null
  const doc = new DOMParser().parseFromString(formattedBody, 'text/html')
  const hints = new Map<string, SizeHint>()
  for (const img of doc.querySelectorAll('img')) {
    const src = img.getAttribute('src')
    const width = positiveInt(img.getAttribute('width'))
    const height = positiveInt(img.getAttribute('height'))
    if (!src || hints.has(src) || (!width && !height)) continue
    hints.set(src, { width, height, emoticon: img.hasAttribute('data-mx-emoticon') })
  }
  return hints.size ? hints : null
}

const clamp = (value: number, max: number) => Math.round(Math.min(value, max))

function applySize(img: Element, hint: SizeHint) {
  const emoji = hint.emoticon || img.classList.contains('hicli-custom-emoji') || img.hasAttribute('data-mx-emoticon')
  const { width, height } = hint
  let style = ''
  if (emoji) {
    if (height) style = `height: ${clamp(height, MAX_EMOJI_SIZE)}px; width: auto;`
    else if (width) style = `width: ${clamp(width, MAX_EMOJI_SIZE)}px; height: auto;`
  } else if (width && height) {
    // Width plus aspect ratio lets CSS shrink it to --max-image-width without distortion.
    style = `width: ${width}px; aspect-ratio: ${width} / ${height};`
    img.setAttribute('data-mx-sized', '')
  } else if (height) {
    style = `height: ${clamp(height, MAX_INLINE_HEIGHT)}px; width: auto;`
  } else if (width) {
    style = `width: ${width}px;`
    img.setAttribute('data-mx-sized', '')
  }
  if (style) img.setAttribute('style', style)
}

purify.addHook('uponSanitizeElement', (node, data) => {
  if (data.tagName === 'mx-reply') node.parentNode?.removeChild(node)
})

purify.addHook('uponSanitizeAttribute', (node, data) => {
  if (data.attrName === 'src' && data.attrValue.startsWith('mxc://')) {
    originalSources.set(node, data.attrValue)
    data.attrValue = mediaURL(data.attrValue) ?? ''
  }
})

purify.addHook('afterSanitizeAttributes', node => {
  if (node.tagName === 'A') {
    // Links to a user or a room render as pills; links to a specific message stay regular links.
    const target = parseMatrixURI(node.getAttribute('href') ?? '')
    if (target && (target.kind === 'user' || !target.eventID)) node.classList.add('mention-pill')
    node.setAttribute('target', '_blank')
    node.setAttribute('rel', 'noopener noreferrer')
  } else if (node.tagName === 'IMG') {
    const src = node.getAttribute('src') ?? ''
    const relative = RELATIVE_GOMUKS_MEDIA.exec(src)
    if (relative) node.setAttribute('src', gomuksMediaURL(relative[1]))
    else if (!isGomuksMediaURL(src)) node.removeAttribute('src')
    node.setAttribute('loading', 'lazy')

    const mxc = originalSources.get(node)
    const fromBody = mxc ? currentHints?.get(mxc) : undefined
    // HTML that wasn't rewritten by gomuks (e.g. profile bios) still carries its own attributes.
    const width = positiveInt(node.getAttribute('width'))
    const height = positiveInt(node.getAttribute('height'))
    const hint = fromBody ?? (width || height ? { width, height, emoticon: node.hasAttribute('data-mx-emoticon') } : undefined)
    if (hint) applySize(node, hint)
  }
})

const BLOCK_TAGS = new Set([
  'ADDRESS', 'BLOCKQUOTE', 'BR', 'DD', 'DETAILS', 'DIV', 'DL', 'DT', 'FIGURE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'HR', 'LI', 'OL', 'P', 'PRE', 'SUMMARY', 'TABLE', 'TBODY', 'TD', 'TFOOT', 'TH', 'THEAD', 'TR', 'UL',
])

const BLOCK_SELECTOR = [...BLOCK_TAGS].join(',').toLowerCase()

/**
 * Whether the sender's newlines mean anything. HTML collapses whitespace, so a body that lays
 * itself out with real markup (a list, a paragraph, a <br>) is using newlines to indent its source,
 * the way mautrix bridges pretty-print their templates — honouring those would break every line.
 * A body with no structure at all has nothing but newlines to break lines with.
 */
const usesNewlines = (root: DocumentFragment) => !root.querySelector(BLOCK_SELECTOR)

/**
 * Turns the literal newlines of such a body into <br>, leaving anything inside <pre>/<code> alone
 * and dropping the ones that only pad the start or end of a run of text.
 */
function preserveLineBreaks(root: DocumentFragment) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const textNodes: Text[] = []
  for (let node = walker.nextNode(); node; node = walker.nextNode()) textNodes.push(node as Text)

  for (const text of textNodes) {
    if (!text.data.includes('\n') || text.parentElement?.closest('pre, code')) continue
    let value = text.data
    if (!text.previousSibling) value = value.replace(/^[ \t]*\n\s*/, '')
    if (!text.nextSibling) value = value.replace(/\s*\n[ \t]*$/, '')
    if (!value.includes('\n')) {
      if (value !== text.data) text.data = value
      continue
    }
    const lines = document.createDocumentFragment()
    value.split('\n').forEach((line, i) => {
      if (i > 0) lines.append(document.createElement('br'))
      if (line) lines.append(line)
    })
    text.replaceWith(lines)
  }
}

const cache = new Map<string, string>()
const CACHE_LIMIT = 2000

/**
 * Sanitizes message HTML. Pass the event's original formatted_body so inline images keep the size
 * the sender gave them.
 */
export function sanitizeHTML(html: string, formattedBody?: string): string {
  const hints = formattedBody && html.includes('<img') ? parseSizeHints(formattedBody) : null
  const key = hints ? `${html}\0${formattedBody}` : html
  let clean = cache.get(key)
  if (clean === undefined) {
    currentHints = hints
    try {
      const fragment = purify.sanitize(html, {
        // hicli-math carries the LaTeX source gomuks parsed out; ui/math renders it from there.
        ADD_TAGS: [MATH_TAG],
        ADD_ATTR: ['target', 'latex', 'displaymode'],
        FORBID_TAGS: ['style', 'form', 'input'],
        RETURN_DOM_FRAGMENT: true,
      })
      if (usesNewlines(fragment)) preserveLineBreaks(fragment)
      const container = document.createElement('div')
      container.append(fragment)
      clean = container.innerHTML
    } finally {
      currentHints = null
    }
    if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!)
    cache.set(key, clean)
  }
  return clean
}
