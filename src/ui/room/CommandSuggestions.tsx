// "/" autocomplete for the composer: the commands matching what's typed, then a hint for the arguments
// of the command being written.
import { SquareTerminal } from 'lucide-react'
import { useEffect, useMemo, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { RoomID, UserID } from '@/api/types'
import { cn } from '@/lib/cn'
import { loadRoomState, useChat } from '@/store/chat'
import {
  activeParameter,
  BUILTIN_COMMANDS,
  COMMAND_DESCRIPTION_TYPES,
  describe,
  GOMUKS_SENDER,
  roomBotCommands,
  type CommandParameter,
  type CommandSpec,
  type CommandSuggestion,
} from '@/store/commands'
import { useDisplayName, useMember } from '@/store/hooks'
import { Avatar } from '@/ui/primitives'

/** Built-in commands plus the ones bots in the room describe (MSC4391). */
export function useRoomCommands(roomID: RoomID, wanted: boolean): CommandSpec[] {
  // Bot descriptions and memberships live in state that may not be loaded until it's asked for.
  useEffect(() => {
    if (wanted) void loadRoomState(roomID)
  }, [wanted, roomID])
  const inputs = useChat(
    useShallow(s => {
      const room = s.rooms[roomID]
      return [...COMMAND_DESCRIPTION_TYPES.map(type => room?.state[type]), room?.state['m.room.member'], room?.membersLoaded]
    }),
  )
  return useMemo(() => {
    void inputs
    return [...BUILTIN_COMMANDS, ...roomBotCommands(useChat.getState(), roomID)]
  }, [inputs, roomID])
}

function SourceBadge({ roomID, source }: { roomID: RoomID; source: UserID }) {
  const member = useMember(roomID, source === GOMUKS_SENDER ? undefined : source)
  const name = useDisplayName(roomID, source === GOMUKS_SENDER ? undefined : source)
  if (source === GOMUKS_SENDER) {
    return (
      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-surface-2 text-muted" title="Built-in command">
        <SquareTerminal size={14} />
      </span>
    )
  }
  return (
    <span title={source} className="shrink-0">
      <Avatar mxc={member?.avatar_url} id={source} name={name} size={24} />
    </span>
  )
}

const paramLabel = (p: CommandParameter, tail?: string) => {
  const name = `${p.key}${p.schema.schema_type === 'array' ? '…' : ''}`
  return p.optional && p.key !== tail ? `[--${name}]` : p.optional ? `[${name}]` : `{${name}}`
}

function Signature({ spec, name, active }: { spec: CommandSpec; name: string; active?: string }) {
  return (
    <code className="font-mono text-[13px]">
      <span className="font-semibold">/{name}</span>
      {spec.parameters.map(p => (
        <span key={p.key} className={cn(p.key === active ? 'text-accent' : 'text-muted')}>
          {' '}
          {paramLabel(p, spec['fi.mau.tail_parameter'])}
        </span>
      ))}
    </code>
  )
}

interface CommandSuggestionsProps {
  roomID: RoomID
  items: CommandSuggestion[]
  active: number
  onHover: (index: number) => void
  onPick: (item: CommandSuggestion) => void
}

export function CommandSuggestions({ roomID, items, active, onHover, onPick }: CommandSuggestionsProps) {
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [active])
  return (
    <div
      role="listbox"
      aria-label="Commands"
      className="command-suggestions absolute inset-x-4 bottom-full z-30 mb-1 flex max-h-80 flex-col overflow-hidden rounded-xl border border-border bg-surface p-1 shadow-xl"
    >
      <div className="flex shrink-0 items-center justify-between px-2 pb-1 pt-0.5 text-[10px] font-medium uppercase tracking-wide text-muted">
        <span>Commands</span>
        <span className="normal-case tracking-normal">↑↓ choose · Enter or Tab insert · Esc dismiss</span>
      </div>
      <div ref={listRef} className="min-h-0 overflow-y-auto">
        {items.map((item, index) => (
          <button
            key={`${item.spec.source}|${item.spec.command}`}
            type="button"
            role="option"
            aria-selected={index === active}
            onMouseDown={e => e.preventDefault()}
            onMouseEnter={() => onHover(index)}
            onClick={() => onPick(item)}
            className={cn('flex w-full items-center gap-2.5 rounded-lg px-2 py-1 text-left text-sm transition-colors', index === active && 'bg-hover')}
          >
            <SourceBadge roomID={roomID} source={item.spec.source} />
            <span className="min-w-0 flex-1">
              <span className="block truncate">
                <Signature spec={item.spec} name={item.needsSource ? `${item.name}${item.spec.source}` : item.name} />
              </span>
              <span className="block truncate text-xs text-muted">
                {describe(item.spec.description) || 'No description'}
                {item.spec.source !== GOMUKS_SENDER && <> · {item.spec.source}</>}
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

interface CommandHintProps {
  roomID: RoomID
  spec: CommandSpec
  name: string
  /** What's typed after the command name. */
  argsText: string
}

/** The command being typed, with the parameter the caret is on picked out and described. */
export function CommandHint({ roomID, spec, name, argsText }: CommandHintProps) {
  const active = activeParameter(spec, argsText)
  const param = spec.parameters.find(p => p.key === active)
  const botName = useDisplayName(roomID, spec.source === GOMUKS_SENDER ? undefined : spec.source)
  return (
    <div
      role="status"
      className="command-hint absolute inset-x-4 bottom-full z-20 mb-1 flex items-start gap-2.5 rounded-xl border border-border bg-surface px-3 py-2 shadow-lg"
    >
      <SourceBadge roomID={roomID} source={spec.source} />
      <div className="min-w-0 flex-1">
        <div className="truncate">
          <Signature spec={spec} name={name} active={active} />
        </div>
        <p className="text-xs text-muted">
          {param ? (
            <>
              <span className="font-mono text-fg/80">{param.key}</span>
              {describe(param.description) ? ` — ${describe(param.description)}` : ''}
              {param.schema.schema_type === 'array' && ' (several go in <a b c> unless last)'}
            </>
          ) : (
            describe(spec.description)
          )}
          {spec.source !== GOMUKS_SENDER && ` · sent to ${botName}`}
        </p>
      </div>
    </div>
  )
}
