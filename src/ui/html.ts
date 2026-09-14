// gomuks already sanitizes message HTML (local_content.sanitized_html); this second pass
// is defense in depth plus client-side rewrites: mxc:// and gomuks media URLs pointed at the
// current backend, matrix.to pills, external images blocked (no tracking pixels), links opened
// in a new tab, and literal newlines kept as line breaks.
import DOMPurify from 'dompurify'
import { gomuksMediaURL, isGomuksMediaURL, mediaURL } from '@/api/media'
import { parseMatrixURI } from '@/lib/matrixURI'

const purify = DOMPurify(window)
const RELATIVE_GOMUKS_MEDIA = /^\/?_gomuks\/(media\/.+)$/

purify.addHook('uponSanitizeElement', (node, data) => {
  if (data.tagName === 'mx-reply') node.parentNode?.removeChild(node)
})

purify.addHook('uponSanitizeAttribute', (_node, data) => {
  if (data.attrName === 'src' && data.attrValue.startsWith('mxc://')) {
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
  }
})

const BLOCK_TAGS = new Set([
  'ADDRESS', 'BLOCKQUOTE', 'BR', 'DD', 'DETAILS', 'DIV', 'DL', 'DT', 'FIGURE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'HR', 'LI', 'OL', 'P', 'PRE', 'SUMMARY', 'TABLE', 'TBODY', 'TD', 'TFOOT', 'TH', 'THEAD', 'TR', 'UL',
])

const isBlock = (node: Node | null) => node?.nodeType === Node.ELEMENT_NODE && BLOCK_TAGS.has((node as Element).tagName)

/**
 * Some senders put literal newlines in formatted bodies (bot captions, for instance), which browsers
 * collapse into spaces. Turn them into <br>, except whitespace around block elements (normal for
 * markdown output) and anything inside <pre>/<code>.
 */
function preserveLineBreaks(root: DocumentFragment) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const textNodes: Text[] = []
  for (let node = walker.nextNode(); node; node = walker.nextNode()) textNodes.push(node as Text)

  for (const text of textNodes) {
    if (!text.data.includes('\n') || text.parentElement?.closest('pre, code')) continue
    let value = text.data
    if (!text.previousSibling || isBlock(text.previousSibling)) value = value.replace(/^[ \t]*\n\s*/, '')
    if (!text.nextSibling || isBlock(text.nextSibling)) value = value.replace(/\s*\n[ \t]*$/, '')
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

export function sanitizeHTML(html: string): string {
  let clean = cache.get(html)
  if (clean === undefined) {
    const fragment = purify.sanitize(html, {
      ADD_ATTR: ['target'],
      FORBID_TAGS: ['style', 'form', 'input'],
      RETURN_DOM_FRAGMENT: true,
    })
    preserveLineBreaks(fragment)
    const container = document.createElement('div')
    container.append(fragment)
    clean = container.innerHTML
    if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!)
    cache.set(html, clean)
  }
  return clean
}
