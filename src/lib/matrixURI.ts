// Parses Matrix links: https://matrix.to/#/<id>[/<event>][?via=…] and matrix: URIs (MSC2312),
// e.g. matrix:roomid/abc:example.org/e/def?via=example.org, matrix:r/alias:example.org, matrix:u/user:example.org.

export type MatrixTarget =
  | { kind: 'user'; userID: string }
  | { kind: 'room'; roomID?: string; alias?: string; eventID?: string; via: string[] }

/** matrix: URI path types and the sigil they stand for. */
const URI_SIGILS: Record<string, string> = { u: '@', roomid: '!', r: '#' }

function fromIdentifiers(id: string, eventID: string | undefined, via: string[]): MatrixTarget | null {
  if (id.length < 2) return null
  switch (id[0]) {
    case '@':
      return { kind: 'user', userID: id }
    case '!':
      return { kind: 'room', roomID: id, eventID, via }
    case '#':
      return { kind: 'room', alias: id, eventID, via }
  }
  return null
}

export function parseMatrixURI(href: string): MatrixTarget | null {
  try {
    if (/^matrix:/i.test(href)) {
      const [path = '', query = ''] = href.slice('matrix:'.length).replace(/^\/\/[^/]*\//, '').split('?')
      const parts = path.split('/').filter(Boolean).map(decodeURIComponent)
      const sigil = URI_SIGILS[parts[0]?.toLowerCase()]
      if (!sigil || !parts[1]) return null
      const eventID = parts[2] === 'e' && parts[3] ? `$${parts[3]}` : undefined
      return fromIdentifiers(`${sigil}${parts[1]}`, eventID, new URLSearchParams(query).getAll('via'))
    }
    const url = new URL(href)
    if (url.hostname !== 'matrix.to' || !url.hash.startsWith('#/')) return null
    const [path = '', query = ''] = url.hash.slice(2).split('?')
    const parts = path.split('/').filter(Boolean).map(decodeURIComponent)
    if (!parts[0]) return null
    const eventID = parts[1]?.startsWith('$') ? parts[1] : undefined
    return fromIdentifiers(parts[0], eventID, new URLSearchParams(query).getAll('via'))
  } catch {
    return null
  }
}
