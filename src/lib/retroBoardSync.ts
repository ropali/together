import * as Y from 'yjs'

export type RetroColumn = {
  id: string
  title: string
  color: 'mint' | 'peach' | 'lavender' | 'blue' | 'yellow'
}

export type RetroComment = {
  id: string
  author: string
  text: string
  createdAt: number
}

export type RetroNote = {
  id: string
  columnId: string
  text: string
  author: string
  anonymous: boolean
  votes: number
  voteIds: string[]
  reactions: Record<string, string[]>
  createdAt: number
  comments: RetroComment[]
  done: boolean
  priority?: 'high' | 'normal'
  dueDate?: string
  assignees?: string[]
  badgeEmoji?: string
  typingPresence?: string
  priorityBorder?: 'error' | 'tertiary' | 'secondary'
}

export type RetroTimer = {
  durationMinutes: number
  remainingSeconds: number
  endsAt: number | null
}

export type RetroBoard = {
  id: string
  title: string
  updatedAt: number
  retentionDays: number
  columns: RetroColumn[]
  notes: RetroNote[]
  locked: boolean
  timer: RetroTimer
}

const ROOT_NAME = 'together-retro'
const META_FIELDS = ['id', 'title', 'updatedAt', 'retentionDays', 'locked'] as const
const DEFAULT_TIMER: RetroTimer = { durationMinutes: 10, remainingSeconds: 10 * 60, endsAt: null }

function getNestedMap(parent: Y.Map<unknown>, key: string): Y.Map<unknown> {
  const current = parent.get(key)
  if (current instanceof Y.Map) return current
  const created = new Y.Map<unknown>()
  parent.set(key, created)
  return created
}

function setIfChanged(map: Y.Map<unknown>, key: string, value: unknown): void {
  if (map.has(key) && Object.is(map.get(key), value)) return
  map.set(key, value)
}

function isRetroTimer(value: unknown): value is RetroTimer {
  return typeof value === 'object' && value !== null &&
    'durationMinutes' in value && typeof value.durationMinutes === 'number' && Number.isSafeInteger(value.durationMinutes) && value.durationMinutes > 0 &&
    'remainingSeconds' in value && typeof value.remainingSeconds === 'number' &&
    Number.isSafeInteger(value.remainingSeconds) && value.remainingSeconds >= 0 &&
    'endsAt' in value && (value.endsAt === null || (typeof value.endsAt === 'number' && Number.isFinite(value.endsAt)))
}

function isColumn(value: unknown): value is RetroColumn {
  if (typeof value !== 'object' || value === null) return false
  return 'id' in value && typeof value.id === 'string' &&
    'title' in value && typeof value.title === 'string' &&
    'color' in value && ['mint', 'peach', 'lavender', 'blue', 'yellow'].includes(String(value.color))
}

function isNote(value: unknown): value is RetroNote {
  if (typeof value !== 'object' || value === null) return false
  return 'id' in value && typeof value.id === 'string' &&
    'columnId' in value && typeof value.columnId === 'string' &&
    'text' in value && typeof value.text === 'string' &&
    'author' in value && typeof value.author === 'string' &&
    'anonymous' in value && typeof value.anonymous === 'boolean' &&
    'votes' in value && typeof value.votes === 'number' &&
    'voteIds' in value && Array.isArray(value.voteIds) && value.voteIds.every((id) => typeof id === 'string') &&
    'reactions' in value && typeof value.reactions === 'object' && value.reactions !== null &&
    Object.entries(value.reactions).every(([emoji, actors]) =>
      emoji.length > 0 && emoji.length <= 8 && Array.isArray(actors) && actors.every((actor) => typeof actor === 'string'),
    ) &&
    'createdAt' in value && typeof value.createdAt === 'number' &&
    'comments' in value && Array.isArray(value.comments) &&
    value.comments.every((comment: unknown) => isRetroComment(comment)) &&
    'done' in value && typeof value.done === 'boolean'
}

function isRetroComment(value: unknown): value is RetroComment {
  if (typeof value !== 'object' || value === null) return false
  return 'id' in value && typeof value.id === 'string' &&
    'author' in value && typeof value.author === 'string' &&
    'text' in value && typeof value.text === 'string' &&
    'createdAt' in value && typeof value.createdAt === 'number'
}

export function writeRetroBoard(doc: Y.Doc, board: RetroBoard): void {
  doc.transact(() => {
    const root = doc.getMap<unknown>(ROOT_NAME)
    const meta = getNestedMap(root, 'meta')
    for (const key of META_FIELDS) {
      setIfChanged(meta, key, board[key])
    }

    const timer = getNestedMap(root, 'timer')
    setIfChanged(timer, 'durationMinutes', board.timer.durationMinutes)
    setIfChanged(timer, 'remainingSeconds', board.timer.remainingSeconds)
    setIfChanged(timer, 'endsAt', board.timer.endsAt)

    const columns = getNestedMap(root, 'columns')
    const liveColumnIds = new Set(board.columns.map((column) => column.id))
    for (const [id, value] of columns) {
      if (!liveColumnIds.has(id)) columns.delete(id)
      else if (!(value instanceof Y.Map)) columns.delete(id)
    }
    for (const column of board.columns) {
      const sharedColumn = getNestedMap(columns, column.id)
      setIfChanged(sharedColumn, 'id', column.id)
      setIfChanged(sharedColumn, 'title', column.title)
      setIfChanged(sharedColumn, 'color', column.color)
    }

    const order = root.get('columnOrder')
    const sharedOrder = order instanceof Y.Array ? order as Y.Array<string> : new Y.Array<string>()
    if (!(order instanceof Y.Array)) root.set('columnOrder', sharedOrder)
    const currentOrder = sharedOrder.toArray()
    if (currentOrder.length !== board.columns.length || currentOrder.some((id, index) => id !== board.columns[index]?.id)) {
      sharedOrder.delete(0, sharedOrder.length)
      if (board.columns.length > 0) sharedOrder.insert(0, board.columns.map((column) => column.id))
    }

    const notes = getNestedMap(root, 'notes')
    const liveNoteIds = new Set(board.notes.map((note) => note.id))
    for (const [id, value] of notes) {
      if (!liveNoteIds.has(id)) notes.delete(id)
      else if (!(value instanceof Y.Map)) notes.delete(id)
    }
    for (const note of board.notes) {
      const sharedNote = getNestedMap(notes, note.id)
      setIfChanged(sharedNote, 'id', note.id)
      setIfChanged(sharedNote, 'columnId', note.columnId)
      setIfChanged(sharedNote, 'text', note.text)
      setIfChanged(sharedNote, 'author', note.author)
      setIfChanged(sharedNote, 'anonymous', note.anonymous)
      setIfChanged(sharedNote, 'createdAt', note.createdAt)
      setIfChanged(sharedNote, 'done', note.done)
      if (note.priority !== undefined) setIfChanged(sharedNote, 'priority', note.priority)
      if (note.dueDate !== undefined) setIfChanged(sharedNote, 'dueDate', note.dueDate)
      if (note.badgeEmoji !== undefined) setIfChanged(sharedNote, 'badgeEmoji', note.badgeEmoji)
      if (note.typingPresence !== undefined) setIfChanged(sharedNote, 'typingPresence', note.typingPresence)
      if (note.priorityBorder !== undefined) setIfChanged(sharedNote, 'priorityBorder', note.priorityBorder)
      if (Array.isArray(note.assignees)) {
        const assigneesMap = getNestedMap(sharedNote, 'assignees')
        const currentAssignees = new Set(note.assignees)
        for (const key of assigneesMap.keys()) {
          if (!currentAssignees.has(key)) assigneesMap.delete(key)
        }
        for (const a of note.assignees) setIfChanged(assigneesMap, a, true)
      }
      const comments = getNestedMap(sharedNote, 'comments')
      const liveCommentIds = new Set(note.comments.map((comment) => comment.id))
      for (const id of comments.keys()) {
        if (!liveCommentIds.has(id)) comments.delete(id)
      }
      for (const comment of note.comments) {
        const sharedComment = getNestedMap(comments, comment.id)
        setIfChanged(sharedComment, 'id', comment.id)
        setIfChanged(sharedComment, 'author', comment.author)
        setIfChanged(sharedComment, 'text', comment.text)
        setIfChanged(sharedComment, 'createdAt', comment.createdAt)
      }
      const voteCollection = getNestedMap(sharedNote, 'voteIds')
      for (const voteId of note.voteIds) setIfChanged(voteCollection, voteId, true)
      const reactionCollection = getNestedMap(sharedNote, 'reactions')
      for (const [emoji, value] of reactionCollection) {
        if (!(value instanceof Y.Map)) {
          reactionCollection.delete(emoji)
          continue
        }
        const actors = new Set(note.reactions[emoji] ?? [])
        for (const actorId of value.keys()) {
          if (!actors.has(actorId)) value.delete(actorId)
        }
        if (value.size === 0 && !Object.hasOwn(note.reactions, emoji)) reactionCollection.delete(emoji)
      }
      for (const [emoji, actorIds] of Object.entries(note.reactions)) {
        const actors = getNestedMap(reactionCollection, emoji)
        for (const actorId of actorIds) setIfChanged(actors, actorId, true)
      }
    }
  })
}

export function readRetroBoard(doc: Y.Doc): RetroBoard | null {
  const root = doc.getMap<unknown>(ROOT_NAME)
  const meta = root.get('meta')
  const columns = root.get('columns')
  const notes = root.get('notes')
  const timer = root.get('timer')
  const order = root.get('columnOrder')
  if (!(meta instanceof Y.Map) || !(columns instanceof Y.Map) ||
    !(notes instanceof Y.Map) || !(order instanceof Y.Array)) return null

  const orderedColumns = order.toArray()
    .map((id) => columns.get(id))
    .filter((value): value is Y.Map<unknown> => value instanceof Y.Map)
    .map((column) => ({
      id: column.get('id'),
      title: column.get('title'),
      color: column.get('color'),
    }))
    .filter(isColumn)
  const boardNotes = [...notes.values()]
    .filter((value): value is Y.Map<unknown> => value instanceof Y.Map)
    .map((note): unknown => ({
      id: note.get('id'),
      columnId: note.get('columnId'),
      text: note.get('text'),
      author: note.get('author'),
      anonymous: note.get('anonymous'),
      votes: note.get('voteIds') instanceof Y.Map ? (note.get('voteIds') as Y.Map<unknown>).size : Number(note.get('votes') ?? 0),
      voteIds: note.get('voteIds') instanceof Y.Map
        ? [...(note.get('voteIds') as Y.Map<unknown>).keys()]
        : Array.from({ length: Number(note.get('votes') ?? 0) }, (_, index) => `${String(note.get('id'))}-legacy-vote-${index}`),
      reactions: note.get('reactions') instanceof Y.Map
        ? Object.fromEntries(
            [...(note.get('reactions') as Y.Map<unknown>).entries()]
              .filter((entry): entry is [string, Y.Map<unknown>] => entry[1] instanceof Y.Map)
              .map(([emoji, actors]) => [emoji, [...actors.keys()]]),
          )
        : {},
      createdAt: note.get('createdAt'),
      comments: note.get('comments') instanceof Y.Map
        ? [...(note.get('comments') as Y.Map<unknown>).values()]
            .filter((value): value is Y.Map<unknown> => value instanceof Y.Map)
            .map((comment) => ({
              id: comment.get('id'),
              author: comment.get('author'),
              text: comment.get('text'),
              createdAt: comment.get('createdAt'),
            }))
            .filter(isRetroComment)
            .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id))
        : [],
      done: note.get('done') === true,
      priority: typeof note.get('priority') === 'string' ? note.get('priority') as 'high' | 'normal' : undefined,
      dueDate: typeof note.get('dueDate') === 'string' ? note.get('dueDate') as string : undefined,
      badgeEmoji: typeof note.get('badgeEmoji') === 'string' ? note.get('badgeEmoji') as string : undefined,
      typingPresence: typeof note.get('typingPresence') === 'string' ? note.get('typingPresence') as string : undefined,
      priorityBorder: typeof note.get('priorityBorder') === 'string' ? note.get('priorityBorder') as 'error' | 'tertiary' | 'secondary' : undefined,
      assignees: note.get('assignees') instanceof Y.Map ? [...(note.get('assignees') as Y.Map<unknown>).keys()] : undefined,
    }))
    .filter(isNote)
    .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id))

  const timerState = timer instanceof Y.Map
    ? {
        durationMinutes: timer.get('durationMinutes'),
        remainingSeconds: timer.get('remainingSeconds'),
        endsAt: timer.get('endsAt'),
      }
    : DEFAULT_TIMER
  const board: unknown = {
    id: meta.get('id'),
    title: meta.get('title'),
    updatedAt: meta.get('updatedAt'),
    retentionDays: meta.get('retentionDays'),
    locked: meta.get('locked'),
    columns: orderedColumns,
    notes: boardNotes,
    timer: timerState,
  }
  if (
    typeof board !== 'object' || board === null ||
    !('id' in board) || typeof board.id !== 'string' ||
    !('title' in board) || typeof board.title !== 'string' ||
    !('updatedAt' in board) || typeof board.updatedAt !== 'number' ||
    !('retentionDays' in board) || typeof board.retentionDays !== 'number' ||
    !('locked' in board) || typeof board.locked !== 'boolean' ||
    !('columns' in board) || !Array.isArray(board.columns) || board.columns.length === 0 ||
    !('notes' in board) || !Array.isArray(board.notes) ||
    !('timer' in board) || !isRetroTimer(board.timer)
  ) return null
  return board as RetroBoard
}

export function observeRetroBoard(doc: Y.Doc, onChange: (board: RetroBoard) => void): () => void {
  const root = doc.getMap<unknown>(ROOT_NAME)
  const observer = () => {
    const board = readRetroBoard(doc)
    if (board) onChange(board)
  }
  root.observeDeep(observer)
  observer()
  return () => root.unobserveDeep(observer)
}
