import { log } from './log'

const logged = new Set<string>()

/** Logs a startup milestone once, relative to navigation start, so slow loads can be diagnosed from the console. */
export function markOnce(label: string, detail?: string) {
  if (logged.has(label)) return
  logged.add(label)
  log.info(`${label} at ${Math.round(performance.now())} ms${detail ? ` (${detail})` : ''}`)
}
