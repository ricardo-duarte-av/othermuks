import { mediaURL } from '@/api/media'
import { withTone, type EmojiItem } from './items'

export const EMOJI_FONT = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Twemoji Mozilla", sans-serif'

/** A unicode emoji in the emoji font, or a custom emoji / sticker image. */
export function EmojiGlyph({ item, tone = 0, size }: { item: EmojiItem; tone?: number; size: number }) {
  if (item.kind === 'custom') {
    return (
      <img
        src={mediaURL(item.emoji.key)}
        alt={`:${item.emoji.shortcode}:`}
        loading="lazy"
        decoding="async"
        draggable={false}
        className="object-contain"
        style={{ width: size, height: size }}
      />
    )
  }
  return (
    <span aria-hidden className="block leading-none" style={{ fontSize: Math.round(size * 0.86), fontFamily: EMOJI_FONT }}>
      {item.text ?? withTone(item.emoji, tone)}
    </span>
  )
}
