// Tagged console logging. Routine traffic goes to console.debug, which Chrome only shows
// with the "Verbose" level enabled; summaries go to info, problems to warn/error.
const TAG = '%cothermuks'
const TAG_STYLE = 'color: #8b9cf7; font-weight: 600'

export const log = {
  debug: (...args: unknown[]) => console.debug(TAG, TAG_STYLE, ...args),
  info: (...args: unknown[]) => console.info(TAG, TAG_STYLE, ...args),
  warn: (...args: unknown[]) => console.warn(TAG, TAG_STYLE, ...args),
  error: (...args: unknown[]) => console.error(TAG, TAG_STYLE, ...args),
}

export function formatSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(2)} MB` : `${(bytes / 1024).toFixed(1)} KB`
}

export function formatMs(value: number): string {
  return `${value.toFixed(1)} ms`
}
