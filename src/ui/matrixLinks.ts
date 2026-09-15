// matrix: and matrix.to links open inside othermuks wherever they appear: messages, profile bios, room
// topics, dialogs. Without this, a matrix: link outside the message body would be handed to the browser,
// which usually has nothing registered for the scheme and silently does nothing.
import { parseMatrixURI } from '@/lib/matrixURI'
import { openMatrixTarget } from '@/store/navigation'

let installed = false

export function handleMatrixLinkClick(event: MouseEvent) {
  // Handled already, e.g. by the message body click handler.
  if (event.defaultPrevented || event.button !== 0) return
  const link = (event.target as Element | null)?.closest?.('a[href]')
  if (!link) return
  const href = link.getAttribute('href') ?? ''
  const target = parseMatrixURI(href)
  if (!target) return
  // Modified clicks on https matrix.to links keep the browser default (e.g. open in a new tab).
  const modified = event.ctrlKey || event.metaKey || event.shiftKey || event.altKey
  if (modified && !/^matrix:/i.test(href)) return
  event.preventDefault()
  void openMatrixTarget(target)
}

export function installMatrixLinkHandler() {
  if (installed) return
  installed = true
  document.addEventListener('click', handleMatrixLinkClick)
}
