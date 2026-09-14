// gomuks already sanitizes message HTML (local_content.sanitized_html); this second pass
// is defense in depth plus client-side rewrites: mxc:// and gomuks media URLs pointed at the
// current backend, matrix.to pills, external images blocked (no tracking pixels), and links
// opened in a new tab.
import DOMPurify from 'dompurify'
import { gomuksMediaURL, isGomuksMediaURL, mediaURL } from '@/api/media'

const purify = DOMPurify(window)
const MATRIX_TO = /^https:\/\/matrix\.to\/#\/[@!#]/
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
    if (MATRIX_TO.test(node.getAttribute('href') ?? '')) node.classList.add('mention-pill')
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

const cache = new Map<string, string>()
const CACHE_LIMIT = 2000

export function sanitizeHTML(html: string): string {
  let clean = cache.get(html)
  if (clean === undefined) {
    clean = purify.sanitize(html, { ADD_ATTR: ['target'], FORBID_TAGS: ['style', 'form', 'input'] })
    if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!)
    cache.set(html, clean)
  }
  return clean
}
