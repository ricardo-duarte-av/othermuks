// Slash commands: gomuks' built-in commands, its text formatting prefixes, and MSC4391 bot commands.
//
// Built-in commands and bot commands share one shape (MSC4391 command descriptions). The composer parses
// "/name args…" against the description into typed arguments and sends them as an
// org.matrix.msc4391.command block, mentioning whoever owns the command: gomuks runs its own when the
// only mention is the fake "@gomuks" sender, and anything else goes to the room as a message for the bot.
// Text formatting prefixes (/me, /rainbow, …) aren't structured: gomuks reads them from the text itself.
//
// The argument syntax and parser follow gomuks web (web/src/api/types/commands.ts, AGPL-3.0-or-later),
// so a command typed here means the same thing it does there.
import type { EventID, RoomID, UserID } from '@/api/types'
import { parseMatrixURI } from '@/lib/matrixURI'
import type { ChatSnapshot } from './chat'

export const GOMUKS_SENDER: UserID = '@gomuks'
export const COMMAND_DESCRIPTION_TYPES = ['org.matrix.msc4391.command_description', 'm.bot.command_description'] as const
export const COMMAND_CONTENT_KEY = 'org.matrix.msc4391.command'

export interface ExtensibleText {
  body: string
  mimetype?: string
}

export interface ExtensibleTextContainer {
  'm.text': ExtensibleText[]
}

export type PrimitiveType = 'string' | 'integer' | 'boolean' | 'server_name' | 'user_id' | 'room_id' | 'room_alias' | 'event_id'

export interface RoomIDArgument {
  type: 'room_id'
  id: RoomID
  via?: string[]
}

export interface EventIDArgument {
  type: 'event_id'
  id: RoomID
  event_id: EventID
  via?: string[]
}

export type SingleArgument = null | string | number | boolean | RoomIDArgument | EventIDArgument
export type ArgumentValue = SingleArgument | SingleArgument[]

type PrimitiveSchema = { schema_type: 'primitive'; type: PrimitiveType }
type LiteralSchema = { schema_type: 'literal'; value: string | number | boolean | RoomIDArgument | EventIDArgument }
type UnionSchema = { schema_type: 'union'; variants: (PrimitiveSchema | LiteralSchema)[] }
type ArraySchema = { schema_type: 'array'; items: PrimitiveSchema | LiteralSchema | UnionSchema }
export type ParameterSchema = PrimitiveSchema | LiteralSchema | UnionSchema | ArraySchema

export interface CommandParameter {
  key: string
  schema: ParameterSchema
  optional?: boolean
  description?: ExtensibleTextContainer
  'fi.mau.default_value'?: ArgumentValue
}

export interface CommandSpec {
  command: string
  aliases?: string[]
  parameters: CommandParameter[]
  description?: ExtensibleTextContainer
  /** gomuks extension: this parameter takes the rest of the input even if it's optional. */
  'fi.mau.tail_parameter'?: string
  /** Whose command it is: a bot's user ID, or GOMUKS_SENDER for built-in ones. */
  source: UserID
  /** Text formatting prefixes, which gomuks parses from the message text rather than a command block. */
  format?: boolean
}

// ---- Built-in commands, as gomuks defines them (pkg/hicli/cmdspec) ----

const text = (body: string): ExtensibleTextContainer => ({ 'm.text': [{ body }] })
const primitive = (type: PrimitiveType): PrimitiveSchema => ({ schema_type: 'primitive', type })
const param = (key: string, type: PrimitiveType | ParameterSchema, description: string, extra: Partial<CommandParameter> = {}): CommandParameter => ({
  key,
  schema: typeof type === 'string' ? primitive(type) : type,
  description: text(description),
  ...extra,
})

type BuiltinDefinition = Omit<CommandSpec, 'source' | 'description' | 'parameters'> & { description: string; parameters?: CommandParameter[] }

const BUILTIN_DEFINITIONS: BuiltinDefinition[] = [
  { command: 'meow', description: 'Meow', parameters: [param('meow', 'string', 'Meow')] },
  { command: 'version', description: 'Get the running version of the gomuks backend' },
  {
    command: 'join',
    aliases: ['open', 'jump'],
    description: 'Jump to a room, message or user by ID, alias or link, joining the room if needed',
    parameters: [
      param('room_reference', 'string', 'Room identifier'),
      param('reason', 'string', 'Reason for joining', { optional: true }),
      param('via', { schema_type: 'array', items: primitive('server_name') }, 'Via server', { optional: true }),
    ],
    'fi.mau.tail_parameter': 'reason',
  },
  { command: 'leave', aliases: ['part'], description: 'Leave the current room' },
  {
    command: 'invite',
    description: 'Invite a user to the current room',
    parameters: [param('user_id', 'user_id', 'User ID'), param('reason', 'string', 'Reason for invite', { optional: true })],
    'fi.mau.tail_parameter': 'reason',
  },
  {
    command: 'kick',
    description: 'Kick a user from the current room',
    parameters: [param('user_id', 'user_id', 'User ID'), param('reason', 'string', 'Reason for kick', { optional: true })],
    'fi.mau.tail_parameter': 'reason',
  },
  {
    command: 'ban',
    description: 'Ban a user from the current room',
    parameters: [param('user_id', 'user_id', 'User ID'), param('reason', 'string', 'Reason for ban', { optional: true })],
    'fi.mau.tail_parameter': 'reason',
  },
  {
    command: 'myroomnick',
    aliases: ['roomnick'],
    description: 'Set your display name in the current room',
    parameters: [param('name', 'string', 'New display name')],
  },
  { command: 'myroomavatar', description: 'Set your avatar in the current room (attach an image)' },
  {
    command: 'globalnick',
    aliases: ['globalname'],
    description: 'Set your global display name',
    parameters: [param('name', 'string', 'New display name')],
  },
  { command: 'globalavatar', description: 'Set your global avatar (attach an image)' },
  { command: 'roomname', description: 'Set the current room name', parameters: [param('name', 'string', 'New room name')] },
  { command: 'roomavatar', description: 'Set the current room avatar (attach an image)' },
  {
    command: 'redact',
    description: 'Redact an event',
    parameters: [param('event_id', 'event_id', 'Event ID or link'), param('reason', 'string', 'Reason for redaction', { optional: true })],
    'fi.mau.tail_parameter': 'reason',
  },
  {
    command: 'raw',
    description: 'Send a raw timeline event to the current room',
    parameters: [param('event_type', 'string', 'Event type'), param('json', 'string', 'Event content as JSON', { 'fi.mau.default_value': '{}' })],
  },
  {
    command: 'unencryptedraw',
    description: 'Send an unencrypted raw timeline event to the current room',
    parameters: [param('event_type', 'string', 'Event type'), param('json', 'string', 'Event content as JSON', { 'fi.mau.default_value': '{}' })],
  },
  {
    command: 'rawstate',
    description: 'Send a raw state event to the current room',
    parameters: [
      param('event_type', 'string', 'Event type'),
      param('state_key', 'string', 'State key'),
      param('json', 'string', 'Event content as JSON', { 'fi.mau.default_value': '{}' }),
    ],
  },
  { command: 'discardsession', description: 'Discard the outbound Megolm session in the current room' },
  { command: 'devtools', description: 'Open the room state explorer' },
  {
    command: 'alias add',
    aliases: ['alias create'],
    description: 'Add a room alias to the current room. Does not update the canonical alias event.',
    parameters: [param('name', 'string', 'Room alias name to add (without the # and domain)')],
  },
  {
    command: 'alias del',
    aliases: ['alias remove', 'alias rm', 'alias delete'],
    description: 'Remove a room alias from the current room. Does not update the canonical alias event.',
    parameters: [param('name', 'string', 'Room alias name to remove (without the # and domain)')],
  },
  {
    command: 'converttodm',
    description: 'Mark the current room as a DM',
    parameters: [param('other_user', 'user_id', 'The other user in the DM', { optional: true })],
    'fi.mau.tail_parameter': 'other_user',
  },
  { command: 'converttoroom', description: 'Remove marking the current room as a DM' },
  {
    command: 'powerlevel',
    description: 'Change a power level in the current room',
    parameters: [
      param(
        'thing',
        { schema_type: 'union', variants: [primitive('string'), primitive('user_id')] },
        'The user ID, event type or top-level key of the power level to change',
      ),
      param('value', 'integer', 'The new power level for the thing'),
    ],
  },
  {
    command: 'poll',
    description: 'Create a new poll',
    parameters: [
      param('question', 'string', 'The question to ask in the poll'),
      param('max_selections', 'integer', 'The maximum number of answers a user can select', { 'fi.mau.default_value': 1 }),
      param('options', { schema_type: 'array', items: primitive('string') }, 'The possible answers to the poll'),
    ],
  },
]

const formatCommand = (command: string, description: string, ...extra: CommandParameter[]): CommandSpec => ({
  command,
  description: text(description),
  parameters: [...extra, param('text', 'string', 'Message')],
  source: GOMUKS_SENDER,
  format: true,
})

/** Prefixes gomuks applies to the message text itself; the first five can be combined with the others. */
const FORMAT_COMMANDS: CommandSpec[] = [
  formatCommand('me', 'Send an emote (m.emote)'),
  formatCommand('notice', 'Send a notice (m.notice)'),
  formatCommand('unencrypted', 'Send the message unencrypted even if the room is encrypted'),
  formatCommand('rawinputbody', 'Use the input text as the body as-is, rather than re-parsing generated HTML'),
  formatCommand('timestamp', 'Send a message with a custom timestamp', param('timestamp', 'integer', 'Timestamp in milliseconds')),
  formatCommand('plain', 'Send a plain text message without any formatting'),
  formatCommand('html', 'Send a formatted message with only HTML (no markdown)'),
  formatCommand('htmlmd', 'Send a formatted message that allows both HTML and markdown'),
  formatCommand('rainbow', 'Send a message with rainbow colors (markdown allowed)'),
]

export const BUILTIN_COMMANDS: CommandSpec[] = [
  ...BUILTIN_DEFINITIONS.map(({ description, parameters, ...rest }) => ({
    ...rest,
    description: text(description),
    parameters: parameters ?? [],
    source: GOMUKS_SENDER,
  })),
  ...FORMAT_COMMANDS,
]

/** Built-in commands that set an avatar from the image attached to the command. */
export const AVATAR_COMMANDS = new Set(['myroomavatar', 'globalavatar', 'roomavatar'])

// ---- Bot commands from room state ----

function isValidSchema(schema: unknown, parent?: string): schema is ParameterSchema {
  if (typeof schema !== 'object' || schema === null) return false
  const s = schema as Record<string, unknown>
  switch (s.schema_type) {
    case 'primitive':
      return ['string', 'integer', 'boolean', 'server_name', 'user_id', 'room_id', 'room_alias', 'event_id'].includes(s.type as string)
    case 'literal':
      return (
        ['string', 'number', 'boolean'].includes(typeof s.value) ||
        (typeof s.value === 'object' && s.value !== null && ['room_id', 'event_id'].includes((s.value as { type?: string }).type ?? ''))
      )
    case 'union':
      return (parent === undefined || parent === 'array') && Array.isArray(s.variants) && s.variants.every(v => isValidSchema(v, 'union'))
    case 'array':
      return parent === undefined && isValidSchema(s.items, 'array')
    default:
      return false
  }
}

/** A bot's command description, or null if it's malformed (MSC4391 says to hide those). */
export function sanitizeCommand(source: UserID, content: Record<string, unknown> | undefined): CommandSpec | null {
  if (!content || typeof content.command !== 'string' || !content.command.trim()) return null
  const rawParams = content.parameters ?? []
  if (!Array.isArray(rawParams)) return null
  const keys = new Set<string>()
  const parameters: CommandParameter[] = []
  for (const raw of rawParams as Record<string, unknown>[]) {
    if (typeof raw?.key !== 'string' || keys.has(raw.key) || !isValidSchema(raw.schema)) return null
    keys.add(raw.key)
    parameters.push(raw as unknown as CommandParameter)
  }
  const tail = content['fi.mau.tail_parameter']
  return {
    command: content.command.trim(),
    aliases: Array.isArray(content.aliases) ? content.aliases.filter((alias): alias is string => typeof alias === 'string') : undefined,
    parameters,
    description: content.description as ExtensibleTextContainer | undefined,
    'fi.mau.tail_parameter': typeof tail === 'string' ? tail : undefined,
    source,
  }
}

/** Commands described in the room's state by bots that are still in it. */
export function roomBotCommands(s: ChatSnapshot, roomID: RoomID): CommandSpec[] {
  const room = s.rooms[roomID]
  if (!room) return []
  const members = room.state['m.room.member'] ?? {}
  const out: CommandSpec[] = []
  for (const type of COMMAND_DESCRIPTION_TYPES) {
    for (const rowid of Object.values(room.state[type] ?? {})) {
      const evt = s.events[rowid]
      if (!evt || evt.redacted_by || evt.sender === GOMUKS_SENDER) continue
      const memberRowID = members[evt.sender]
      const membership = memberRowID === undefined ? undefined : s.events[memberRowID]?.content.membership
      // Hidden once the bot leaves; kept while its membership just isn't loaded yet.
      if (membership !== undefined ? membership !== 'join' : room.membersLoaded) continue
      const spec = sanitizeCommand(evt.sender, evt.content)
      if (spec) out.push(spec)
    }
  }
  return out
}

export const describe = (container?: ExtensibleTextContainer) =>
  container?.['m.text']?.find(item => !item.mimetype || item.mimetype === 'text/plain')?.body ?? ''

/** "/name {param} {list...}" as shown in suggestions and hints. */
export function commandSignature(spec: CommandSpec): string[] {
  return spec.parameters.map(p => `${p.key}${p.schema.schema_type === 'array' ? '…' : ''}`)
}

// ---- Parsing "/name args" ----

const ARRAY_OPENER = '<'
const ARRAY_CLOSER = '>'

/** Takes one argument off the input: a bare word, or a "quoted string" with \ escapes. */
export function parseQuoted(val: string): [string | null, string, boolean] {
  if (!val) return ['', '', false]
  if (!val.startsWith('"')) {
    const spaceIdx = val.search(/\s/)
    if (spaceIdx === -1) return [val, '', false]
    return [val.slice(0, spaceIdx), val.slice(spaceIdx).trimStart(), false]
  }
  val = val.slice(1)
  const out: string[] = []
  for (;;) {
    const quoteIdx = val.indexOf('"')
    const escapeIdx = val.slice(0, quoteIdx === -1 ? val.length : quoteIdx).indexOf('\\')
    if (escapeIdx >= 0) {
      out.push(val.slice(0, escapeIdx), val.charAt(escapeIdx + 1))
      val = val.slice(escapeIdx + 2)
    } else if (quoteIdx >= 0) {
      out.push(val.slice(0, quoteIdx))
      val = val.slice(quoteIdx + 1)
      break
    } else if (!out.length) {
      // Unterminated quote with no escapes: the rest is the value.
      return [val, '', true]
    } else {
      out.push(val)
      val = ''
      break
    }
  }
  return [out.join(''), val.trimStart(), true]
}

const isUserID = (v: string) => /^@[^:\s]+:[^\s]+$/.test(v)
const isRoomAlias = (v: string) => /^#[^:\s]+:[^\s]+$/.test(v)
// Room v12 IDs have no server part.
const isRoomID = (v: string) => /^![^\s:]+(:[^\s]+)?$/.test(v)
const isEventID = (v: string) => /^\$[^\s]+$/.test(v)
const isServerName = (v: string) => /^(\[[0-9a-fA-F:.]+\]|[a-zA-Z0-9.-]+)(:\d{1,5})?$/.test(v)

const nonEmpty = <T,>(arr: T[]): T[] | undefined => (arr.length ? arr : undefined)

interface ParseContext {
  /** The room the command is typed in: a bare $event ID refers to an event there. */
  roomID: RoomID
}

function identifierArgument(type: PrimitiveType, val: string, ctx: ParseContext): SingleArgument {
  // Mention pills from the composer's @ autocomplete arrive as markdown links.
  const link = /^\[.+]\(([^)]+)\)$/.exec(val)
  if (link) val = link[1]
  let identifier = val
  let eventID: string | undefined
  let via: string[] = []
  if (/^matrix:/i.test(val) || val.startsWith('https://matrix.to/')) {
    const target = parseMatrixURI(val)
    if (!target) return null
    if (target.kind === 'user') identifier = target.userID
    else {
      identifier = target.roomID ?? target.alias ?? ''
      eventID = target.eventID
      via = target.via
    }
  }
  switch (type) {
    case 'user_id':
      return isUserID(identifier) ? identifier : null
    case 'room_alias':
      return isRoomAlias(identifier) ? identifier : null
    case 'room_id':
      return isRoomID(identifier) ? { type: 'room_id', id: identifier, via: nonEmpty(via) } : null
    case 'event_id':
      if (isEventID(identifier)) return { type: 'event_id', id: ctx.roomID, event_id: identifier }
      return isRoomID(identifier) && eventID && isEventID(eventID)
        ? { type: 'event_id', id: identifier, event_id: eventID, via: nonEmpty(via) }
        : null
    default:
      return null
  }
}

function parseBoolean(val: string): boolean | null {
  switch (val.toLowerCase()) {
    case 't':
    case 'true':
    case 'y':
    case 'yes':
    case '1':
      return true
    case 'f':
    case 'false':
    case 'n':
    case 'no':
    case '0':
      return false
  }
  return null
}

function parseInteger(val: string): number | null {
  return /^[+-]?\d+$/.test(val.trim()) ? parseInt(val, 10) : null
}

function primitiveArgument(type: PrimitiveType, val: string, ctx: ParseContext): SingleArgument {
  switch (type) {
    case 'string':
      return val
    case 'boolean':
      return parseBoolean(val)
    case 'integer':
      return parseInteger(val)
    case 'server_name':
      return isServerName(val) ? val : null
    default:
      return identifierArgument(type, val, ctx)
  }
}

function literalMatches(expected: LiteralSchema['value'], val: string, ctx: ParseContext): boolean {
  if (typeof expected === 'string') return expected === val
  if (typeof expected === 'number') return parseInteger(val) === expected
  if (typeof expected === 'boolean') return parseBoolean(val) === expected
  const parsed = identifierArgument(expected.type, val, ctx) as RoomIDArgument | EventIDArgument | null
  return (
    !!parsed &&
    parsed.type === expected.type &&
    parsed.id === expected.id &&
    (parsed.type !== 'event_id' || parsed.event_id === (expected as EventIDArgument).event_id)
  )
}

function stringToArgument(schema: ParameterSchema, val: string | null, ctx: ParseContext): SingleArgument {
  if (val === null) return null
  switch (schema.schema_type) {
    case 'literal':
      return literalMatches(schema.value, val, ctx) ? schema.value : null
    case 'primitive':
      return primitiveArgument(schema.type, val, ctx)
    case 'union':
      for (const variant of schema.variants) {
        const value = stringToArgument(variant, val, ctx)
        if (value !== null) return value
      }
      return null
    case 'array':
      return stringToArgument(schema.items, val, ctx)
  }
}

function defaultForSchema(schema: ParameterSchema): ArgumentValue {
  switch (schema.schema_type) {
    case 'literal':
      return schema.value
    case 'primitive':
      return schema.type === 'boolean' ? false : schema.type === 'integer' ? 0 : ''
    case 'union':
      return defaultForSchema(schema.variants[0])
    case 'array':
      return []
  }
}

const defaultArgument = (p: CommandParameter): ArgumentValue => p['fi.mau.default_value'] ?? (p.optional ? null : defaultForSchema(p.schema))

function allowsBoolean(schema: ParameterSchema): boolean {
  if (schema.schema_type === 'primitive') return schema.type === 'boolean'
  if (schema.schema_type === 'union') return schema.variants.some(allowsBoolean)
  if (schema.schema_type === 'array') return allowsBoolean(schema.items)
  return false
}

/**
 * Arguments are positional and space separated; quote values with spaces ("like this"). The last
 * parameter (or the tail parameter) takes the rest of the input. Lists go in <a b c> unless they're
 * last. Optional parameters are only set by name: --key value, --key=value, or --flag for booleans.
 */
export function parseArguments(spec: CommandSpec, input: string, ctx: ParseContext): ParsedArguments {
  const args: Record<string, ArgumentValue> = {}
  const provided = new Set<string>()
  const params = spec.parameters

  const processParam = (p: CommandParameter, isLast: boolean, isTail: boolean, isNamed: boolean) => {
    let nextVal: string | null
    let wasQuoted: boolean
    const origInput = input
    if (p.schema.schema_type === 'array') {
      const hasOpener = input.startsWith(ARRAY_OPENER)
      let closed = false
      if (hasOpener) {
        input = input.slice(1)
        if (input.startsWith(ARRAY_CLOSER)) {
          input = input.slice(1).trimStart()
          closed = true
        }
      }
      const items: SingleArgument[] = []
      while (input.length > 0 && !closed) {
        ;[nextVal, input, wasQuoted] = parseQuoted(input)
        if (!wasQuoted && hasOpener && nextVal?.endsWith(ARRAY_CLOSER)) {
          nextVal = nextVal.slice(0, -1)
          closed = true
        } else if (hasOpener && input.startsWith(ARRAY_CLOSER)) {
          input = input.slice(1).trimStart()
          closed = true
        } else if (!hasOpener && !isLast) {
          // A list in the middle without <> takes one item.
          closed = true
        }
        const value = stringToArgument(p.schema, nextVal, ctx)
        if (value !== null) items.push(value)
      }
      if (items.length) provided.add(p.key)
      args[p.key] = items.length ? items : defaultArgument(p)
      return
    }
    ;[nextVal, input, wasQuoted] = parseQuoted(input)
    if ((isLast || isTail) && !wasQuoted && input) {
      // An unquoted last argument is the rest of the input, as typed.
      nextVal += ' ' + input
      input = ''
    }
    if (!nextVal && !wasQuoted) {
      // Nothing typed: a bare --flag is true, anything else falls back to its default.
      if (isNamed && allowsBoolean(p.schema)) {
        args[p.key] = true
        provided.add(p.key)
      } else {
        args[p.key] = defaultArgument(p)
      }
      return
    }
    const value = stringToArgument(p.schema, nextVal, ctx)
    if (value !== null) provided.add(p.key)
    args[p.key] = value ?? defaultArgument(p)
    // A value that doesn't fit a parameter that can do without one is handed on to the next parameter.
    const skippable = p.optional || p['fi.mau.default_value'] !== undefined
    if (value === null && skippable && !isLast && !isNamed) input = origInput.trimStart()
  }

  const named = new Set<string>()
  const readNamed = () => {
    while (input.startsWith('--')) {
      const match = /^--([^\s=]+)/.exec(input)
      const p = match && params.find(candidate => candidate.key === match[1])
      if (!match || !p) return
      input = input.slice(match[0].length)
      // "--key=value", or "--key value" except for booleans, where a bare "--flag" means true.
      if (input.startsWith('=')) input = input.slice(1)
      else if (!allowsBoolean(p.schema)) input = input.replace(/^[ \t]+/, '')
      named.add(p.key)
      processParam(p, false, false, true)
    }
  }

  params.forEach((p, i) => {
    readNamed()
    const isTail = p.key === spec['fi.mau.tail_parameter']
    // Optional parameters that weren't named are left out, as MSC4391 allows.
    if (named.has(p.key) || (p.optional && !isTail)) return
    processParam(p, i === params.length - 1, isTail, false)
  })
  readNamed()
  for (const p of params) if (p.optional && args[p.key] === null) delete args[p.key]
  return { args, provided }
}

export interface ParsedArguments {
  args: Record<string, ArgumentValue>
  /** Parameters that were given a value, as opposed to falling back to a default. */
  provided: Set<string>
}

// ---- Resolving what's typed ----

export type ResolvedInput =
  /** Not a command: sent as an ordinary message. */
  | { kind: 'none' }
  /** A text formatting prefix, sent as text for gomuks to apply. */
  | { kind: 'format'; spec: CommandSpec }
  | { kind: 'command'; spec: CommandSpec; name: string; args: Record<string, ArgumentValue>; missing: string[] }
  | { kind: 'unknown'; name: string }
  | { kind: 'ambiguous'; name: string; sources: UserID[] }

/** Command names and aliases a spec answers to. */
export const namesOf = (spec: CommandSpec) => [spec.command, ...(spec.aliases ?? [])]

const isMissing = (p: CommandParameter, provided: Set<string>) => !p.optional && p['fi.mau.default_value'] === undefined && !provided.has(p.key)

/**
 * Matches "/name" (or "/name@bot:server", to pick one bot's command) against the known commands. The
 * longest name wins, so "/alias add" beats a bare "/alias". Built-in commands take precedence over bot
 * commands with the same name, as MSC4391 recommends; a bot's clashing command needs its @suffix.
 */
export function resolveInput(input: string, commands: CommandSpec[], roomID: RoomID): ResolvedInput {
  if (!input.startsWith('/') || input.startsWith('//')) return { kind: 'none' }
  const body = input.slice(1)
  const lower = body.toLowerCase()
  let best: { spec: CommandSpec; name: string; rest: string; explicit: boolean }[] = []
  let bestLength = -1
  for (const spec of commands) {
    for (const name of namesOf(spec)) {
      const lowerName = name.toLowerCase()
      if (!lower.startsWith(lowerName) || lowerName.length < bestLength) continue
      let rest = body.slice(name.length)
      let explicit = false
      if (rest.startsWith('@')) {
        if (!rest.startsWith(spec.source)) continue
        rest = rest.slice(spec.source.length)
        explicit = true
      }
      if (rest && !/^\s/.test(rest)) continue
      if (lowerName.length > bestLength) {
        best = []
        bestLength = lowerName.length
      }
      best.push({ spec, name, rest: rest.trimStart(), explicit })
    }
  }
  if (!best.length) return { kind: 'unknown', name: /^\S*/.exec(body)?.[0] ?? '' }
  const explicit = best.filter(match => match.explicit)
  const candidates = explicit.length ? explicit : best
  const builtin = candidates.find(match => match.spec.source === GOMUKS_SENDER)
  const sources = [...new Set(candidates.map(match => match.spec.source))]
  if (!builtin && sources.length > 1) return { kind: 'ambiguous', name: candidates[0].name, sources }
  const match = builtin ?? candidates[0]
  if (match.spec.format) return { kind: 'format', spec: match.spec }
  const { args, provided } = parseArguments(match.spec, match.rest, { roomID })
  const missing = match.spec.parameters.filter(p => isMissing(p, provided)).map(p => p.key)
  return { kind: 'command', spec: match.spec, name: match.name, args, missing }
}

/** The parameter the caret is on while arguments are being typed, for highlighting in the hint. */
export function activeParameter(spec: CommandSpec, argsText: string): string | undefined {
  const positional = spec.parameters.filter(p => !p.optional || p.key === spec['fi.mau.tail_parameter'])
  // A token only counts as done once something (a space) follows it.
  const take = (text: string): [string | null, string, boolean] => {
    const [value, remaining] = parseQuoted(text)
    return [value, remaining, !!remaining || /\s$/.test(text)]
  }
  let rest = argsText.trimStart()
  let complete = 0
  while (rest) {
    const flag = /^--([^\s=]*)(=?)/.exec(rest)
    if (flag) {
      const p = spec.parameters.find(candidate => candidate.key === flag[1])
      let done: boolean
      ;[, rest, done] = take(rest)
      if (!done) return spec.parameters.find(candidate => candidate.key.startsWith(flag[1]))?.key
      // "--key value" names a value unless the parameter is a boolean flag.
      if (p && !flag[2] && !allowsBoolean(p.schema)) {
        if (!rest) return p.key
        ;[, rest, done] = take(rest)
        if (!done) return p.key
      }
      continue
    }
    const [, remaining, done] = take(rest)
    if (!done) break
    complete++
    rest = remaining
  }
  return positional.length ? positional[Math.min(complete, positional.length - 1)].key : undefined
}

export interface CommandSuggestion {
  spec: CommandSpec
  /** The name to insert: the command itself or the alias that matched. */
  name: string
  /** Whether "@source" has to follow the name to reach this command. */
  needsSource: boolean
}

/**
 * Commands for the "/…" typed so far: names starting with it first, then names containing it. A bot
 * command whose name a built-in (or another bot) also uses is listed with its @source.
 */
export function suggestCommands(query: string, commands: CommandSpec[]): CommandSuggestion[] {
  const q = query.toLowerCase()
  const owners = new Map<string, Set<UserID>>()
  for (const spec of commands) {
    for (const name of namesOf(spec)) {
      const key = name.toLowerCase()
      if (!owners.has(key)) owners.set(key, new Set())
      owners.get(key)!.add(spec.source)
    }
  }
  const scored: { suggestion: CommandSuggestion; score: number }[] = []
  for (const spec of commands) {
    let best: { name: string; score: number } | null = null
    namesOf(spec).forEach((name, index) => {
      const lower = name.toLowerCase()
      const at = lower.indexOf(q)
      if (at === -1) return
      // Prefix matches of the real name first, then of aliases, then anywhere.
      const score = (at === 0 ? 0 : 2) + (index === 0 ? 0 : 1)
      if (!best || score < best.score) best = { name: index === 0 || at !== 0 ? spec.command : name, score }
    })
    if (!best) continue
    const { name, score } = best as { name: string; score: number }
    const sharing = owners.get(name.toLowerCase())
    const needsSource = spec.source !== GOMUKS_SENDER && !!sharing && (sharing.has(GOMUKS_SENDER) || sharing.size > 1)
    scored.push({ suggestion: { spec, name, needsSource }, score })
  }
  scored.sort(
    (a, b) =>
      a.score - b.score ||
      Number(a.suggestion.spec.source !== GOMUKS_SENDER) - Number(b.suggestion.spec.source !== GOMUKS_SENDER) ||
      a.suggestion.name.localeCompare(b.suggestion.name),
  )
  return scored.map(entry => entry.suggestion)
}

// ---- Sending ----

/** A room or event reference as a matrix: URI, which gomuks' own commands accept in place of an ID. */
function referenceURI(value: RoomIDArgument | EventIDArgument): string {
  let uri = `matrix:roomid/${encodeURIComponent(value.id.slice(1))}`
  if (value.type === 'event_id') uri += `/e/${encodeURIComponent(value.event_id.slice(1))}`
  if (value.via?.length) uri += '?' + new URLSearchParams(value.via.map(server => ['via', server])).toString()
  return uri
}

/**
 * gomuks' own command handlers read room and event references as strings (an event ID in the current
 * room, or a link), not the MSC4391 objects bots get, so those are flattened for built-in commands.
 */
export function argumentsForSource(spec: CommandSpec, args: Record<string, ArgumentValue>, roomID: RoomID): Record<string, ArgumentValue> {
  if (spec.source !== GOMUKS_SENDER) return args
  const flatten = (value: SingleArgument): SingleArgument => {
    if (value === null || typeof value !== 'object') return value
    if (value.type === 'event_id' && value.id === roomID) return value.event_id
    return referenceURI(value)
  }
  return Object.fromEntries(Object.entries(args).map(([key, value]) => [key, Array.isArray(value) ? value.map(flatten) : flatten(value)]))
}
