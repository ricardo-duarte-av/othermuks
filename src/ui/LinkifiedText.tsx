import { Fragment } from 'react'

/** http(s) URLs and matrix: URIs in plain text; trailing punctuation isn't part of the link. */
const LINK_PATTERN = /\b(?:https?:\/\/|matrix:)[^\s<>"]+[^\s<>".,;:!?)\]}'"]/gi

export interface TextPart {
  text: string
  href?: string
}

export function linkifyText(text: string): TextPart[] {
  const parts: TextPart[] = []
  let last = 0
  for (const match of text.matchAll(LINK_PATTERN)) {
    const start = match.index ?? 0
    if (start > last) parts.push({ text: text.slice(last, start) })
    parts.push({ text: match[0], href: match[0] })
    last = start + match[0].length
  }
  if (last < text.length) parts.push({ text: text.slice(last) })
  return parts
}

/** Plain text (e.g. a room topic) with its links clickable; matrix links open inside othermuks (see matrixLinks). */
export function LinkifiedText({ text }: { text: string }) {
  return (
    <>
      {linkifyText(text).map((part, i) =>
        part.href ? (
          <a
            key={i}
            href={part.href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent hover:underline"
          >
            {part.text}
          </a>
        ) : (
          <Fragment key={i}>{part.text}</Fragment>
        ),
      )}
    </>
  )
}
