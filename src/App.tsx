import { useEffect, useRef, useState, type FormEvent, type ReactNode, type SetStateAction } from 'react'
import { P2PYjsRoom } from './lib/p2pYjs'
import { observeRetroBoard, writeRetroBoard, type RetroBoard, type RetroColumn, type RetroNote, type RetroTimer } from './lib/retroBoardSync'
import './App.css'

type Column = RetroColumn
type Note = RetroNote
type BoardData = RetroBoard
type IconName = 'spark' | 'plus' | 'users' | 'timer' | 'download' | 'lock' | 'unlock' | 'eye' | 'moon' | 'sun' | 'settings' | 'copy' | 'check' | 'close' | 'send' | 'arrow' | 'edit' | 'trash' | 'heart' | 'link' | 'refresh'
type Modal = 'note' | 'connect' | 'settings' | 'new-board' | 'guest-name' | null
type PeerRole = 'host' | 'guest'
type PeerState = 'idle' | 'connecting' | 'ready' | 'connected' | 'disconnected' | 'failed'
const TIMER_PRESETS = [5, 10, 15, 20, 30, 45, 60]
const NOTE_REACTIONS = ['👍', '❤️', '🎉', '😂', '🤔'] as const
const REACTION_ACTOR_KEY = 'together-retro-reaction-actor-v1'

function getReactionActorId(): string {
  const saved = localStorage.getItem(REACTION_ACTOR_KEY)
  if (saved) return saved
  const actorId = crypto.randomUUID()
  localStorage.setItem(REACTION_ACTOR_KEY, actorId)
  return actorId
}

const STORAGE_KEY = 'together-retro-boards-v1'
const LEGACY_STORAGE_KEY = 'together-retro-board-v1'
const ACTIVE_BOARD_KEY = 'together-retro-active-board-v1'
const DEFAULT_COLUMN_TITLES = ['What went well', 'What could be better', 'Action items']
const routeParams = new URLSearchParams(window.location.search)
const joinPeerId = routeParams.get('join')?.trim() ?? ''
const ownerPeerId = routeParams.get('owner')?.trim() ?? ''
const boardRouteDetails = (() => {
  const encoded = routeParams.get('setup')
  if (!encoded) return null
  try {
    const value: unknown = JSON.parse(encoded)
    if (typeof value !== 'object' || value === null || !('id' in value) || typeof value.id !== 'string' ||
      !('title' in value) || typeof value.title !== 'string' || !('columns' in value) || !Array.isArray(value.columns) ||
      value.columns.length < 2 || value.columns.length > 5 ||
      !value.columns.every((column: unknown) => typeof column === 'string' && column.trim().length > 0 && column.length <= 28)) return null
    return { id: value.id, title: value.title.slice(0, 60), columns: value.columns as string[] }
  } catch {
    return null
  }
})()
const sharedBoardId = routeParams.get('board')?.trim() || boardRouteDetails?.id || ''
const initialBoard: BoardData = {
  id: 'sprint-24',
  title: 'Sprint 24 retrospective',
  updatedAt: Date.now(),
  retentionDays: 0,
  columns: [
    { id: 'went-well', title: 'What went well', color: 'mint' },
    { id: 'to-improve', title: 'What can improve', color: 'peach' },
    { id: 'actions', title: 'Action items', color: 'lavender' },
  ],
  notes: [
    { id: 'n-1', columnId: 'went-well', text: 'The new onboarding flow shipped smoothly. Great pairing across the team!', author: 'Olivia', anonymous: false, votes: 3, voteIds: ['n1-v1', 'n1-v2', 'n1-v3'], reactions: {}, createdAt: 0 },
    { id: 'n-2', columnId: 'went-well', text: 'Daily check-ins kept everyone unblocked this sprint.', author: 'Sam', anonymous: false, votes: 1, voteIds: ['n2-v1'], reactions: {}, createdAt: 0 },
    { id: 'n-3', columnId: 'went-well', text: 'Loved seeing design and engineering collaborate early on the search experience.', author: 'Anonymous', anonymous: true, votes: 2, voteIds: ['n3-v1', 'n3-v2'], reactions: {}, createdAt: 0 },
    { id: 'n-4', columnId: 'to-improve', text: 'A couple of late scope changes made it tricky to estimate the last story.', author: 'Jamie', anonymous: false, votes: 2, voteIds: ['n4-v1', 'n4-v2'], reactions: {}, createdAt: 0 },
    { id: 'n-5', columnId: 'to-improve', text: 'Let’s leave a little more room for code review before the release cut.', author: 'Anonymous', anonymous: true, votes: 1, voteIds: ['n5-v1'], reactions: {}, createdAt: 0 },
    { id: 'n-6', columnId: 'actions', text: 'Add acceptance criteria to tickets before sprint planning.', author: 'Riley', anonymous: false, votes: 4, voteIds: ['n6-v1', 'n6-v2', 'n6-v3', 'n6-v4'], reactions: {}, createdAt: 0 },
    { id: 'n-7', columnId: 'actions', text: 'Try a 15-minute mid-sprint check on cross-team dependencies.', author: 'Alex', anonymous: false, votes: 2, voteIds: ['n7-v1', 'n7-v2'], reactions: {}, createdAt: 0 },
  ],
  locked: false,
  timer: { durationMinutes: 15, remainingSeconds: 15 * 60, endsAt: null },
}

function createBoardData(title: string, columnTitles: string[]): BoardData {
  return {
    ...initialBoard,
    id: crypto.randomUUID(),
    title,
    updatedAt: Date.now(),
    retentionDays: 0,
    columns: columnTitles.map((columnTitle, index) => ({
      id: crypto.randomUUID(),
      title: columnTitle,
      color: ['mint', 'peach', 'lavender', 'blue', 'yellow'][index] as Column['color'],
    })),
    notes: [],
    locked: false,
  }
}

const emptyBoard: BoardData = {
  ...initialBoard,
  id: sharedBoardId || 'joining-board',
  title: boardRouteDetails?.title || 'Connecting to board…',
  columns: (boardRouteDetails?.columns || DEFAULT_COLUMN_TITLES).map((title, index) => ({
    id: `joining-column-${index}-${title}`,
    title,
    color: ['mint', 'peach', 'lavender', 'blue', 'yellow'][index] as Column['color'],
  })),
  notes: [],
  locked: false,
}

function boardFromRouteDetails(): BoardData | undefined {
  if (!boardRouteDetails) return undefined
  return {
    ...initialBoard,
    id: boardRouteDetails.id,
    title: boardRouteDetails.title,
    updatedAt: Date.now(),
    notes: [],
    columns: boardRouteDetails.columns.map((title, index) => ({
      id: `${boardRouteDetails.id}-column-${index}`,
      title,
      color: ['mint', 'peach', 'lavender', 'blue', 'yellow'][index] as Column['color'],
    })),
  }
}

function stableHostPeerId(boardId: string): string {
  return `retro-${boardId}`
}

function getBoardTone(title: string): number {
  let hash = 0
  for (const character of title.trim().toLowerCase()) {
    hash = (hash * 31 + character.charCodeAt(0)) | 0
  }
  return Math.abs(hash) % 6
}

function updateBoardUrl(board: BoardData, role: 'owner' | 'invite', hostPeerId: string): string {
  const url = new URL(window.location.href)
  url.search = ''
  url.searchParams.set(role === 'owner' ? 'owner' : 'join', hostPeerId)
  url.searchParams.set('board', board.id)
  url.searchParams.set('setup', JSON.stringify({
    id: board.id,
    title: board.title,
    columns: board.columns.map((column) => column.title),
  }))
  return url.toString()
}

const icons: Record<IconName, ReactNode> = {
  spark: <><path d="m12 3 1.9 5.8L20 11l-6.1 2.2L12 19l-2-5.8L4 11l6-2.2L12 3Z" /><path d="m19 14 1.1 2.2L22 17l-1.9.8L19 20l-.8-2.2L16 17l2.2-.8L19 14Z" /></>,
  plus: <><path d="M12 5v14M5 12h14" /></>,
  users: <><path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="10" cy="7" r="4" /><path d="M20 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8" /></>,
  timer: <><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2.5 1.5M9 2h6M12 2v3" /></>,
  download: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m7 10 5 5 5-5M12 15V3" /></>,
  lock: <><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
  unlock: <><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 7.5-2" /></>,
  eye: <><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>,
  moon: <path d="M20.8 13A8.5 8.5 0 0 1 11 3.2 8.5 8.5 0 1 0 20.8 13Z" />,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="m19.4 15 .1.1 1.4 1.1-1.4 2.4-1.7-.7a8 8 0 0 1-1.5.9l-.3 1.8h-2.8l-.3-1.8a8 8 0 0 1-1.6-.9l-1.6.7-1.4-2.4 1.4-1.1a7 7 0 0 1 0-1.9l-1.4-1.2 1.4-2.4 1.7.7a8 8 0 0 1 1.5-.9l.3-1.8h2.8l.3 1.8a8 8 0 0 1 1.6.9l1.6-.7 1.4 2.4-1.4 1.2a7 7 0 0 1-.1 1.8Z" /></>,
  copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" /></>,
  check: <path d="m5 12 4 4L19 6" />,
  close: <><path d="m18 6-12 12M6 6l12 12" /></>,
  send: <><path d="m22 2-7 20-4-9-9-4 20-7ZM22 2 11 13" /></>,
  arrow: <><path d="M7 17 17 7M7 7h10v10" /></>,
  edit: <><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z" /></>,
  trash: <><path d="M3 6h18M8 6V4h8v2m3 0-1 14H6L5 6m4 4v6m6-6v6" /></>,
  heart: <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z" />,
  link: <><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7.1-7.1l-1.7 1.7" /><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7.1 7.1l1.7-1.7" /></>,
  refresh: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M5.6 9a7 7 0 0 1 11.6-2L20 12M4 12l2.8 5a7 7 0 0 0 11.6-2" /></>,
}

function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{icons[name]}</svg>
}

function readBoards(): BoardData[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      const parsed: unknown = JSON.parse(saved)
      if (Array.isArray(parsed)) {
      const validBoards = parsed.map(normalizeBoard).filter((board): board is BoardData => board !== null)
      return removeExpiredBoards(validBoards)
      }
    }
    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY)
    if (legacy) {
      const parsed: unknown = JSON.parse(legacy)
      if (typeof parsed === 'object' && parsed !== null && 'columns' in parsed && Array.isArray(parsed.columns) && 'notes' in parsed && Array.isArray(parsed.notes) && 'locked' in parsed && typeof parsed.locked === 'boolean') {
      const migrated = normalizeBoard({ ...initialBoard, columns: parsed.columns, notes: parsed.notes, locked: parsed.locked, updatedAt: Date.now() })
      if (migrated) return [migrated]
      }
    }
  } catch (error) {
    console.warn('Could not restore saved retro boards.', error)
  }
  return []
}

function normalizeBoard(value: unknown): BoardData | null {
  if (typeof value !== 'object' || value === null || !('notes' in value) || !Array.isArray(value.notes)) return null
  const normalized = {
    ...value,
    timer: 'timer' in value && isRetroTimer(value.timer)
      ? value.timer
      : { durationMinutes: 15, remainingSeconds: 15 * 60, endsAt: null },
    notes: value.notes.map((note: unknown) => {
      if (typeof note !== 'object' || note === null) return note
      const noteRecord = note as Record<string, unknown>
      return {
        ...noteRecord,
        createdAt: typeof noteRecord.createdAt === 'number' ? noteRecord.createdAt : 0,
        reactions: typeof noteRecord.reactions === 'object' && noteRecord.reactions !== null && !Array.isArray(noteRecord.reactions)
          ? noteRecord.reactions
          : {},
        voteIds: Array.isArray(noteRecord.voteIds)
          ? noteRecord.voteIds
          : Array.from({ length: typeof noteRecord.votes === 'number' ? noteRecord.votes : 0 }, (_, index) => `${String(noteRecord.id)}-legacy-vote-${index}`),
      }
    }),
  }
  return isBoardData(normalized) ? normalized : null
}

function isRetroTimer(value: unknown): value is RetroTimer {
  return typeof value === 'object' && value !== null &&
    'durationMinutes' in value && typeof value.durationMinutes === 'number' && TIMER_PRESETS.includes(value.durationMinutes) &&
    'remainingSeconds' in value && typeof value.remainingSeconds === 'number' &&
    Number.isSafeInteger(value.remainingSeconds) && value.remainingSeconds >= 0 &&
    'endsAt' in value && (value.endsAt === null || (typeof value.endsAt === 'number' && Number.isFinite(value.endsAt)))
}

function removeExpiredBoards(boards: BoardData[]): BoardData[] {
  const now = Date.now()
  return boards.filter((board) => board.retentionDays === 0 || now - board.updatedAt < board.retentionDays * 24 * 60 * 60 * 1000)
}

function isNote(value: unknown): value is Note {
  if (typeof value !== 'object' || value === null) return false
  return 'id' in value && typeof value.id === 'string' &&
    'columnId' in value && typeof value.columnId === 'string' &&
    'text' in value && typeof value.text === 'string' &&
    value.text.trim().length > 0 && value.text.length <= 500 &&
    'author' in value && typeof value.author === 'string' &&
    'anonymous' in value && typeof value.anonymous === 'boolean' &&
    'votes' in value && typeof value.votes === 'number' && Number.isSafeInteger(value.votes) && value.votes >= 0 &&
    'voteIds' in value && Array.isArray(value.voteIds) && value.voteIds.every((id) => typeof id === 'string') &&
    'reactions' in value && typeof value.reactions === 'object' && value.reactions !== null &&
    Object.entries(value.reactions).every(([emoji, actors]) =>
      NOTE_REACTIONS.includes(emoji as typeof NOTE_REACTIONS[number]) &&
      Array.isArray(actors) && actors.every((actor) => typeof actor === 'string'),
    ) &&
    'createdAt' in value && typeof value.createdAt === 'number'
}

function isBoardData(value: unknown): value is BoardData {
  if (typeof value !== 'object' || value === null || !('columns' in value) ||
    !('notes' in value) || !('locked' in value) || typeof value.locked !== 'boolean' ||
    !('timer' in value) || !isRetroTimer(value.timer) ||
    !('id' in value) || typeof value.id !== 'string' ||
    !('title' in value) || typeof value.title !== 'string' ||
    !('updatedAt' in value) || typeof value.updatedAt !== 'number' ||
    !('retentionDays' in value) || ![0, 7, 30, 90].includes(Number(value.retentionDays))) return false
  const columns = value.columns
  const notes = value.notes
  if (!Array.isArray(columns) || !Array.isArray(notes)) return false
  return columns.length > 0 && columns.length <= 5 &&
    columns.every((column: unknown) =>
    typeof column === 'object' && column !== null &&
    'id' in column && typeof column.id === 'string' &&
    'title' in column && typeof column.title === 'string' &&
    'color' in column && ['mint', 'peach', 'lavender', 'blue', 'yellow'].includes(String(column.color)),
    ) && notes.every((note: unknown) => isNote(note) && columns.some((column: unknown) => typeof column === 'object' && column !== null && 'id' in column && column.id === note.columnId))
}

function App() {
  const [boards, setBoards] = useState<BoardData[]>(readBoards)
  const [activeBoardId, setActiveBoardId] = useState(() => sharedBoardId || localStorage.getItem(ACTIVE_BOARD_KEY) || '')
  const board = boards.find((item) => item.id === activeBoardId) ??
    boardFromRouteDetails() ??
    (!joinPeerId && !ownerPeerId ? boards[0] : undefined) ??
    (joinPeerId || ownerPeerId ? emptyBoard : initialBoard)
  const setBoard = (update: SetStateAction<BoardData>) => {
    setBoards((current) => current.map((savedBoard) => {
      if (savedBoard.id !== board.id) return savedBoard
      const next = typeof update === 'function' ? update(savedBoard) : update
      return next === savedBoard ? savedBoard : { ...next, updatedAt: Date.now() }
    }))
  }
  const [modal, setModal] = useState<Modal>(joinPeerId ? 'guest-name' : null)
  const [dark, setDark] = useState(() => localStorage.getItem('together-retro-dark') === 'true')
  const [masked, setMasked] = useState(false)
  const [timerNow, setTimerNow] = useState(0)
  const [draft, setDraft] = useState('')
  const [anonymous, setAnonymous] = useState(false)
  const [noteColumn, setNoteColumn] = useState('')
  const [participantName, setParticipantName] = useState(() => localStorage.getItem('together-retro-name') || '')
  const [reactionActorId] = useState(getReactionActorId)
  const [guestName, setGuestName] = useState(() => localStorage.getItem('together-retro-name') || '')
  const [pendingPeerId, setPendingPeerId] = useState(joinPeerId)
  const [editName, setEditName] = useState(() => localStorage.getItem('together-retro-name') || 'You')
  const [editBoardTitle, setEditBoardTitle] = useState(board.title)
  const [newBoardTitle, setNewBoardTitle] = useState('')
  const [transferTarget, setTransferTarget] = useState('')
  const [notice, setNotice] = useState('')
  const [peerState, setPeerState] = useState<PeerState>(joinPeerId || ownerPeerId ? 'connecting' : 'idle')
  const [peerCount, setPeerCount] = useState(0)
  const [sharedBoardReceived, setSharedBoardReceived] = useState(!joinPeerId)
  const [isHost, setIsHost] = useState(() => !joinPeerId)
  const [participants, setParticipants] = useState<Record<string, string>>({})
  const [peerRole, setPeerRole] = useState<PeerRole>(joinPeerId ? 'guest' : 'host')
  const [signalText, setSignalText] = useState(joinPeerId)
  const [signalResult, setSignalResult] = useState('')
  const [signalStep, setSignalStep] = useState<'start' | 'offer'>('start')
  const [inviteCopied, setInviteCopied] = useState(false)
  const [newBoardColumns, setNewBoardColumns] = useState(DEFAULT_COLUMN_TITLES)
  const [boardCreatedThisVisit, setBoardCreatedThisVisit] = useState(false)
  const roomRef = useRef<P2PYjsRoom | null>(null)
  const autoHostStartedRef = useRef(false)
  const startOwnerRoomRef = useRef<(ownerBoard: BoardData) => Promise<boolean>>(async () => false)
  const announcedPeersRef = useRef(new Set<string>())
  const boardRef = useRef(board)
  const toastTimeout = useRef<number | undefined>(undefined)

  useEffect(() => {
    boardRef.current = board
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(boards))
      localStorage.setItem(ACTIVE_BOARD_KEY, board.id)
    } catch (error) {
      console.warn('Could not save retro boards in this browser.', error)
    }
    if (roomRef.current) {
      if (isHost || roomRef.current.peers.length > 0) {
        try {
          writeRetroBoard(roomRef.current.doc, board)
        } catch (error) {
          console.warn('Could not synchronize the board with peers.', error)
        }
      }
    }
    if (isHost && roomRef.current) {
      window.history.replaceState(null, '', updateBoardUrl(board, 'owner', roomRef.current.id))
    }
  }, [board, boards, peerState, isHost])

  useEffect(() => {
    const cleanup = window.setInterval(() => {
      const remaining = removeExpiredBoards(boards)
      if (remaining.length === boards.length && remaining.every((item, index) => item.id === boards[index]?.id)) return
      setBoards(remaining)
      if (!remaining.some((item) => item.id === activeBoardId)) {
        setActiveBoardId(remaining[0]?.id ?? '')
        roomRef.current?.destroy()
        roomRef.current = null
        setPeerState('idle')
      }
    }, 60_000)
    return () => window.clearInterval(cleanup)
  }, [activeBoardId, boards])

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    localStorage.setItem('together-retro-dark', String(dark))
  }, [dark])

  useEffect(() => {
    localStorage.setItem('together-retro-name', participantName)
  }, [participantName])

  useEffect(() => {
    const endsAt = board.timer.endsAt
    if (endsAt === null) return
    const initialRefresh = window.setTimeout(() => setTimerNow(Date.now()), 0)
    const timer = window.setInterval(() => {
      const now = Date.now()
      setTimerNow(now)
      if (now >= endsAt) window.clearInterval(timer)
    }, 250)
    return () => {
      window.clearTimeout(initialRefresh)
      window.clearInterval(timer)
    }
  }, [board.timer.endsAt])

  useEffect(() => () => {
    roomRef.current?.destroy()
    window.clearTimeout(toastTimeout.current)
  }, [])

  const toast = (message: string) => {
    setNotice(message)
    window.clearTimeout(toastTimeout.current)
    toastTimeout.current = window.setTimeout(() => setNotice(''), 3000)
  }

  const handleOwnerChanged = (peerId: string, displayName: string) => {
    const room = roomRef.current
    const becameOwner = room?.id === peerId
    setIsHost(becameOwner)
    setSignalResult(peerId)
    setSignalStep('offer')
    if (room) {
      window.history.replaceState(null, '', updateBoardUrl(
        boardRef.current,
        becameOwner ? 'owner' : 'invite',
        peerId,
      ))
    }
    toast(becameOwner ? 'You are now the board owner.' : `${displayName} is now the board owner.`)
  }

  const observeRoom = (room: P2PYjsRoom, owner: boolean) => {
    observeRetroBoard(room.doc, (remoteBoard) => {
      if (sharedBoardId && remoteBoard.id !== sharedBoardId) {
        toast('This invite does not match the board ID in its link.')
        return
      }
      setBoards((current) => current.some((item) => item.id === remoteBoard.id)
        ? current.map((item) => item.id === remoteBoard.id ? remoteBoard : item)
        : [...current, remoteBoard])
      setActiveBoardId(remoteBoard.id)
      setSharedBoardReceived(true)
      setPeerState(room.peers.length > 0 ? 'connected' : owner ? 'ready' : 'connecting')
    })
  }

  const startOwnerRoom = async (ownerBoard: BoardData, displayName = participantName.trim() || 'Owner'): Promise<boolean> => {
    roomRef.current?.destroy()
    roomRef.current = null
    setIsHost(true)
    setPeerCount(0)
    setPeerState('connecting')
    const hostPeerId = ownerPeerId && (!sharedBoardId || sharedBoardId === ownerBoard.id)
      ? ownerPeerId
      : stableHostPeerId(ownerBoard.id)
    window.history.replaceState(null, '', updateBoardUrl(ownerBoard, 'owner', hostPeerId))
    try {
      const room = await P2PYjsRoom.host({
        peerId: hostPeerId,
        displayName: displayName.trim() || 'Owner',
        topology: 'mesh',
        onPeerConnected: () => {
          setPeerCount(roomRef.current?.peers.length ?? 1)
          setPeerState('connected')
        },
        onPeerDisconnected: (peerId) => {
          const remaining = roomRef.current?.peers.length ?? 0
          setPeerCount(remaining)
          setPeerState(remaining ? 'connected' : 'ready')
          announcedPeersRef.current.delete(peerId)
          setParticipants((current) => {
            const next = { ...current }
            delete next[peerId]
            return next
          })
        },
        onPeerPresence: (peerId, displayName) => {
          const name = displayName.trim() || 'Participant'
          setParticipants((current) => ({ ...current, [peerId]: name }))
          if (!announcedPeersRef.current.has(peerId)) {
            announcedPeersRef.current.add(peerId)
            toast(`${name} joined the board.`)
          }
        },
        onOwnerChanged: handleOwnerChanged,
        onError: (error) => toast(error.message),
      })
      roomRef.current = room
      writeRetroBoard(room.doc, ownerBoard)
      observeRoom(room, true)
      setSignalResult(room.id)
      setSignalStep('offer')
      setPeerState('ready')
      return true
    } catch (error) {
      setPeerState('failed')
      toast(error instanceof Error ? error.message : 'Could not create a room invite.')
      return false
    }
  }
  useEffect(() => {
    startOwnerRoomRef.current = startOwnerRoom
  })

  const connectAsGuest = async (peerId: string, displayName = participantName.trim() || 'Participant') => {
    const remotePeerId = peerId.trim()
    if (!/^[A-Za-z0-9](?:[A-Za-z0-9_-]{0,126}[A-Za-z0-9])?$/.test(remotePeerId)) {
      setPeerState('failed')
      toast('Enter a valid PeerJS host ID.')
      return
    }
    roomRef.current?.destroy()
    roomRef.current = null
    setIsHost(false)
    setPeerCount(0)
    setSharedBoardReceived(false)
    setPeerState('connecting')
    setSignalStep('offer')
    try {
      const room = await P2PYjsRoom.join(remotePeerId, {
        topology: 'mesh',
        displayName,
        onPeerConnected: () => setPeerCount(roomRef.current?.peers.length ?? 1),
        onPeerDisconnected: (disconnectedPeerId) => {
          setPeerCount(roomRef.current?.peers.length ?? 0)
          setParticipants((current) => {
            const next = { ...current }
            delete next[disconnectedPeerId]
            return next
          })
          const room = roomRef.current
          if (room && disconnectedPeerId === room.hostPeerId) {
            const successor = room.electSuccessor()
            if (successor === room.id) room.promoteToOwner(participantName.trim() || 'Participant')
          }
        },
        onPeerPresence: (peerId, name) => {
          setParticipants((current) => ({ ...current, [peerId]: name.trim() || 'Owner' }))
        },
        onPeerSynced: () => setPeerState('connected'),
        onOwnerChanged: handleOwnerChanged,
        onError: (error) => toast(error.message),
      })
      roomRef.current = room
      observeRoom(room, false)
      setSignalStep('offer')
      setPeerState('connected')
    } catch (error) {
      setPeerState('failed')
      setSignalStep('start')
      toast(error instanceof Error ? error.message : 'Could not join that board.')
    }
  }

  const joinRoom = async (event: FormEvent) => {
    event.preventDefault()
    setPendingPeerId(signalText.trim())
    setGuestName(participantName)
    setModal('guest-name')
  }

  const confirmGuestName = async (event: FormEvent) => {
    event.preventDefault()
    const name = guestName.trim()
    if (!name || !pendingPeerId) return
    setParticipantName(name)
    await connectAsGuest(pendingPeerId, name)
    setModal(null)
  }

  const copySignal = async () => {
    try {
      const invite = new URL(window.location.href)
      invite.search = ''
      invite.searchParams.set('join', signalResult)
      invite.searchParams.set('board', board.id)
      invite.searchParams.set('setup', JSON.stringify({
        id: board.id,
        title: board.title,
        columns: board.columns.map((column) => column.title),
      }))
      await navigator.clipboard.writeText(invite.toString())
      setInviteCopied(true)
      setModal(null)
      toast('Board invite link copied to clipboard.')
    } catch {
      toast('Copy was blocked by the browser. Share the room ID shown instead.')
    }
  }

  const addNote = (event: FormEvent) => {
    event.preventDefault()
    if (!draft.trim() || board.locked) return
    const note: Note = {
      id: crypto.randomUUID(),
      columnId: noteColumn || board.columns[0]?.id || '',
      text: draft.trim(),
      author: anonymous ? 'Anonymous' : (participantName.trim() || 'You'),
      anonymous,
      votes: 0,
      voteIds: [],
      reactions: {},
      createdAt: Date.now(),
    }
    setBoard((current) => ({ ...current, notes: [...current.notes, note] }))
    setDraft('')
    setAnonymous(false)
    setModal(null)
    toast('Your thought has been added.')
  }

  const toggleReaction = (noteId: string, emoji: typeof NOTE_REACTIONS[number]) => {
    if (board.locked) return
    setBoard((current) => ({
      ...current,
      notes: current.notes.map((note) => {
        if (note.id !== noteId) return note
        const actors = note.reactions[emoji] ?? []
        const alreadyReacted = actors.includes(reactionActorId)
        return {
          ...note,
          reactions: {
            ...note.reactions,
            [emoji]: alreadyReacted
              ? actors.filter((actorId) => actorId !== reactionActorId)
              : [...actors, reactionActorId],
          },
        }
      }),
    }))
  }

  const deleteNote = (noteId: string) => {
    if (board.locked || (!isHost && board.notes.find((note) => note.id === noteId)?.author !== (participantName.trim() || 'You'))) return
    setBoard((current) => ({ ...current, notes: current.notes.filter((note) => note.id !== noteId) }))
  }

  const isGuest = !isHost

  const updateColumn = (id: string, title: string) => {
    setBoard((current) => ({ ...current, columns: current.columns.map((column) => column.id === id ? { ...column, title } : column) }))
  }

  const addColumn = () => {
    if (!isHost) return
    if (board.columns.length >= 5) return
    const id = `column-${Date.now()}`
    setBoard((current) => ({ ...current, columns: [...current.columns, { id, title: 'New column', color: ['mint', 'peach', 'lavender', 'blue', 'yellow'][current.columns.length] as Column['color'] }] }))
  }

  const timerSeconds = board.timer.endsAt === null
    ? board.timer.remainingSeconds
    : Math.max(0, Math.ceil((board.timer.endsAt - timerNow) / 1000))
  const timerRunning = board.timer.endsAt !== null && timerSeconds > 0
  const timerDuration = board.timer.durationMinutes
  const toggleTimer = () => {
    if (!isHost) return
    if (timerRunning) {
      setBoard((current) => ({
        ...current,
        timer: {
          ...current.timer,
          remainingSeconds: Math.max(0, Math.ceil(((current.timer.endsAt ?? Date.now()) - Date.now()) / 1000)),
          endsAt: null,
        },
      }))
      return
    }
    const seconds = timerSeconds > 0 ? timerSeconds : timerDuration * 60
    setBoard((current) => ({
      ...current,
      timer: { ...current.timer, remainingSeconds: seconds, endsAt: Date.now() + seconds * 1000 },
    }))
  }
  const changeTimerDuration = (durationMinutes: number) => {
    if (!isHost || !TIMER_PRESETS.includes(durationMinutes)) return
    setBoard((current) => ({
      ...current,
      timer: { durationMinutes, remainingSeconds: durationMinutes * 60, endsAt: null },
    }))
  }
  const resetTimer = () => {
    if (!isHost) return
    setBoard((current) => ({
      ...current,
      timer: { ...current.timer, remainingSeconds: current.timer.durationMinutes * 60, endsAt: null },
    }))
  }

  const setConnectionOpen = () => {
    setPeerRole(isHost ? 'host' : 'guest')
    setSignalStep(isHost && roomRef.current || !isHost && peerState === 'connecting' ? 'offer' : 'start')
    setSignalText(roomRef.current?.hostPeerId || joinPeerId)
    setSignalResult(roomRef.current?.id ?? '')
    setInviteCopied(false)
    setModal('connect')
    if (isHost && !roomRef.current) void startOwnerRoom(board)
  }

  const openSettings = () => {
    setEditName(participantName || 'You')
    setEditBoardTitle(board.title)
    setTransferTarget(Object.keys(participants)[0] ?? '')
    setModal('settings')
  }

  const resetConnection = () => {
    roomRef.current?.destroy()
    roomRef.current = null
    setPeerCount(0)
    setPeerState('idle')
    setSignalStep('start')
    setSignalText('')
    setSignalResult('')
  }

  const createBoard = async (event: FormEvent) => {
    event.preventDefault()
    const title = newBoardTitle.trim()
    const ownerName = participantName.trim()
    const columns = newBoardColumns.map((column) => column.trim()).filter(Boolean).slice(0, 5)
    if (!title || !ownerName || columns.length < 2) return
    const nextBoard = createBoardData(title, columns)
    roomRef.current?.destroy()
    roomRef.current = null
    setBoards((current) => [...current, nextBoard])
    setActiveBoardId(nextBoard.id)
    setBoardCreatedThisVisit(true)
    setIsHost(true)
    setNewBoardTitle('')
    setModal(null)
    setIsHost(true)
    const roomReady = await startOwnerRoom(nextBoard, ownerName)
    toast(roomReady
      ? 'Your board is ready. Share its invite link to bring in participants.'
      : 'Your board is saved locally, but its invite could not be created.')
  }

  const addNewBoardColumn = () => {
    setNewBoardColumns((current) => current.length < 5 ? [...current, ''] : current)
  }

  const removeNewBoardColumn = (index: number) => {
    setNewBoardColumns((current) => current.length > 2 ? current.filter((_, itemIndex) => itemIndex !== index) : current)
  }

  const updateNewBoardColumn = (index: number, title: string) => {
    setNewBoardColumns((current) => current.map((column, itemIndex) => itemIndex === index ? title : column))
  }

  useEffect(() => {
    if (!ownerPeerId || autoHostStartedRef.current) return
    autoHostStartedRef.current = true
    setBoardCreatedThisVisit(true)
    void startOwnerRoomRef.current(boardRef.current)
  }, [])

  const showSetupPage = !joinPeerId && !ownerPeerId && !boardCreatedThisVisit
  const waitingForSharedBoard = Boolean(joinPeerId) && !sharedBoardReceived

  const displayTime = `${String(Math.floor(timerSeconds / 60)).padStart(2, '0')}:${String(timerSeconds % 60).padStart(2, '0')}`

  return (
    <div className={`app-shell ${dark ? 'dark' : ''}`}>
      {showSetupPage ? <main className="landing-page">
        <a className="brand landing-brand" href="/" aria-label="Together home"><span className="brand-mark"><Icon name="spark" size={21} /></span><span>together<span className="brand-period">.</span></span></a>
        <section className="setup-card">
          <div className="setup-art"><span className="setup-art-star">✳</span><span className="setup-art-card card-one" /><span className="setup-art-card card-two" /><span className="setup-art-card card-three" /></div>
          <span className="setup-eyebrow">A FRESH START FOR YOUR TEAM</span>
          <h1>Make space to<br /><span>look back together.</span></h1>
          <p className="setup-description">Create a retrospective board. Invite your team with a link, then share thoughts directly peer to peer.</p>
          <form className="setup-form" onSubmit={(event) => void createBoard(event)}>
            <label className="field-label" htmlFor="new-board-name">Give your retro a name</label>
            <input id="new-board-name" className="text-field setup-title-input" value={newBoardTitle} onChange={(event) => setNewBoardTitle(event.target.value)} placeholder="e.g. Sprint 24 retrospective" maxLength={60} required autoFocus />
            <label className="field-label" htmlFor="owner-name">Your name</label>
            <input id="owner-name" className="text-field" value={participantName} onChange={(event) => setParticipantName(event.target.value)} placeholder="How should your team identify you?" maxLength={32} required />
            <div className="setup-columns-label"><span className="field-label">Your columns</span><span>{newBoardColumns.length} of 5</span></div>
            <div className="setup-column-list">{newBoardColumns.map((column, index) => <div className="setup-column-row" key={index}><span className={`column-swatch column-${['mint', 'peach', 'lavender', 'blue', 'yellow'][index]}`} /><input className="text-field" value={column} onChange={(event) => updateNewBoardColumn(index, event.target.value)} placeholder={`Column ${index + 1}`} maxLength={28} required aria-label={`Column ${index + 1} name`} /><button type="button" className="remove-column" onClick={() => removeNewBoardColumn(index)} disabled={newBoardColumns.length <= 2} aria-label={`Remove column ${index + 1}`}><Icon name="trash" size={15} /></button></div>)}</div>
            {newBoardColumns.length < 5 && <button className="settings-add-column setup-add-column" type="button" onClick={addNewBoardColumn}><Icon name="plus" size={15} /> Add a column</button>}
            <button className="button button-primary button-wide setup-submit" type="submit" disabled={!newBoardTitle.trim() || !participantName.trim() || newBoardColumns.some((column) => !column.trim())}><Icon name="spark" size={16} /> Create my board</button>
          </form>
          <div className="setup-footnote"><Icon name="lock" size={14} /> No accounts. Your board stays on your device until you share it.</div>
        </section>
        {notice && <div className="toast" role="status"><span className="toast-check"><Icon name="check" size={15} /></span>{notice}</div>}
      </main> : <>
      <header className="topbar">
        <a className="brand" href="/" aria-label="Retrospect home">
          <span className="brand-mark"><Icon name="spark" size={21} /></span>
          <span>together<span className="brand-period">.</span></span>
        </a>
        <div className="topbar-right">
          <span className="privacy-pill"><span className="privacy-dot" /> Peer-to-peer</span>
          {isHost && <button className="new-board-button" onClick={() => { setNewBoardTitle(''); setNewBoardColumns(DEFAULT_COLUMN_TITLES); setModal('new-board') }}><Icon name="plus" size={15} /> New board</button>}
          <button className="icon-button" title={dark ? 'Use light theme' : 'Use dark theme'} onClick={() => setDark(!dark)}><Icon name={dark ? 'sun' : 'moon'} /></button>
          <button className="avatar avatar-you" onClick={openSettings} title="Edit your profile">{(participantName.trim() || 'Y').slice(0, 1).toUpperCase()}</button>
        </div>
      </header>

      <main className={`page board-tone-${getBoardTone(board.title)}`}>
        <nav className="breadcrumbs"><span>Boards</span><span className="crumb-divider">/</span><strong>{board.title}</strong></nav>

        <section className="board-heading">
          <div className="board-heading-copy">
            <div className="eyebrow"><span className="live-dot" /> TEAM RETROSPECTIVE <span className="eyebrow-divider">·</span> SAVED ON THIS DEVICE</div>
            <h1>{waitingForSharedBoard ? peerState === 'failed' ? 'Could not connect to board' : 'Connecting to board…' : board.title} {!waitingForSharedBoard && <span className="heading-emoji">✳</span>}</h1>
            <p className="board-subtitle">{waitingForSharedBoard ? peerState === 'failed' ? 'The owner may be offline or the direct connection could not be established.' : 'Waiting for the owner’s board snapshot to arrive over the peer connection.' : 'A little space to celebrate the wins and learn together.'}</p>
          </div>
          <div className="board-heading-actions">
            {waitingForSharedBoard && peerState === 'failed' && <button className="button button-primary" onClick={() => void connectAsGuest(joinPeerId)}><Icon name="refresh" size={16} /> Try again</button>}
            <div className="people-stack" title={peerState === 'connected' ? `You and ${peerCount} peer${peerCount === 1 ? '' : 's'} connected` : 'You are working solo'}>
              <span className="avatar avatar-you" title={participantName.trim() || (isHost ? 'Owner' : 'Participant')}>{(participantName.trim() || 'Y').slice(0, 1).toUpperCase()}</span>
              {Object.entries(participants).slice(0, 3).map(([peerId, name]) => <span className="avatar avatar-peer" key={peerId} title={name} aria-label={name}>{name.slice(0, 1).toUpperCase()}</span>)}
              {peerCount > 3 && <span className="peer-count-badge">+{peerCount - 3}</span>}
            </div>
            <span className={`connection-label ${peerState === 'connected' ? 'online' : ''} ${peerState === 'ready' ? 'ready' : ''}`}><span className="connection-dot" />{peerState === 'connected' ? `${peerCount + 1} here` : peerState === 'ready' ? 'Invite ready' : 'Just you'}</span>
            <span className={`role-badge ${isHost ? 'owner' : 'participant'}`}>{isHost ? 'Owner' : 'Participant'}</span>
            <button className={`button ${board.locked ? 'button-soft' : 'button-quiet'}`} onClick={() => { setBoard((current) => ({ ...current, locked: !current.locked })); toast(board.locked ? 'Board unlocked for everyone.' : 'Board locked. No one can make changes.') }} title={board.locked ? 'Unlock board' : 'Lock board'} disabled={!isHost}>
              <Icon name={board.locked ? 'lock' : 'unlock'} size={16} />{board.locked ? 'Locked' : 'Lock board'}
            </button>
            <button className="button button-primary" onClick={() => { setNoteColumn(board.columns[0]?.id ?? ''); setModal('note') }} disabled={board.locked}><Icon name="plus" size={17} /> Add a thought</button>
            <button className="icon-button more-button" title="Board settings" onClick={openSettings}><Icon name="settings" /></button>
          </div>
        </section>

        <section className="toolbar" aria-label="Board tools">
          <div className="toolbar-left">
            <button className="toolbar-button" onClick={() => setMasked(!masked)}><Icon name="eye" size={16} />{masked ? 'Reveal notes' : 'Hide notes'}</button>
            <span className="toolbar-separator" />
            <button className={`toolbar-button timer-tool ${timerRunning ? 'timer-running' : ''}`} onClick={toggleTimer} disabled={isGuest} title={isGuest ? 'Only the owner can control the timer' : undefined}><Icon name="timer" size={16} /><span>{timerRunning ? 'Pause timer' : timerSeconds < timerDuration * 60 ? 'Resume timer' : 'Start timer'}</span><span className="timer-value">{displayTime}</span></button>
            <select className="timer-duration" aria-label="Timer duration" value={timerDuration} disabled={isGuest || timerRunning} title={isGuest ? 'Only the owner can control the timer' : undefined} onChange={(event) => changeTimerDuration(Number(event.target.value))}>{TIMER_PRESETS.map((duration) => <option value={duration} key={duration}>{duration} min</option>)}</select>
            {timerSeconds < timerDuration * 60 && isHost && <button className="timer-reset" title="Reset timer" onClick={resetTimer}><Icon name="refresh" size={14} /></button>}
          </div>
          <div className="toolbar-right">
            <span className="note-total"><strong>{board.notes.length}</strong> thoughts</span>
            <span className="toolbar-separator" />
            <button className="toolbar-button" onClick={() => window.print()}><Icon name="download" size={16} /> Export</button>
            {board.columns.length < 5 && isHost && <button className="toolbar-button add-column" onClick={addColumn}><Icon name="plus" size={15} /> Add column</button>}
            <button className="toolbar-button connect-tool" onClick={setConnectionOpen}><Icon name="users" size={16} />{peerState === 'connected' ? 'Connection' : 'Invite team'}</button>
          </div>
        </section>

        <section className={`columns ${board.columns.length > 3 ? 'many-columns' : ''}`} aria-label="Retrospective board">
          {board.columns.map((column) => {
            const notes = board.notes.filter((note) => note.columnId === column.id)
            return <section className={`column column-${column.color}`} key={column.id}>
              <div className="column-header"><span className="column-marker" /><h2>{column.title}</h2><span className="column-count">{notes.length}</span><button className="column-add" onClick={() => { setNoteColumn(column.id); setModal('note') }} title={`Add to ${column.title}`} disabled={board.locked}><Icon name="plus" size={17} /></button></div>
              <div className="note-list">
                {notes.map((note) => <article className="note-card" key={note.id}>
                  <p className={masked ? 'note-text masked' : 'note-text'}>{note.text}</p>
                  <div className="note-footer"><span className="note-author"><span className={`author-avatar ${note.anonymous ? 'anonymous-avatar' : ''}`}>{note.anonymous ? '•' : note.author.slice(0, 1).toUpperCase()}</span>{note.author}</span><div className="note-actions"><div className="note-reactions" aria-label="Emoji reactions">
                    {NOTE_REACTIONS.map((emoji) => {
                      const actors = note.reactions[emoji] ?? []
                      const active = actors.includes(reactionActorId)
                      return <button
                        className={`reaction-button ${active ? 'active' : ''}`}
                        key={emoji}
                        onClick={() => toggleReaction(note.id, emoji)}
                        disabled={board.locked}
                        aria-label={`${emoji} reaction, ${actors.length}; ${active ? 'remove your reaction' : 'add your reaction'}`}
                        aria-pressed={active}
                        title={`${active ? 'Remove' : 'Add'} ${emoji} reaction`}
                      >{emoji}{actors.length > 0 && <span>{actors.length}</span>}</button>
                    })}
                  </div>{(isHost || (!note.anonymous && note.author === (participantName.trim() || 'You'))) && <button className="note-delete" onClick={() => deleteNote(note.id)} disabled={board.locked} aria-label="Delete thought"><Icon name="trash" size={14} /></button>}</div></div>
                </article>)}
              </div>
              {!board.locked && <button className="add-card" onClick={() => { setNoteColumn(column.id); setModal('note') }}><Icon name="plus" size={15} /> Add a thought</button>}
            </section>
          })}
        </section>

        <footer className="board-footer"><span><Icon name="lock" size={14} /> Your board is saved on this device</span><button onClick={setConnectionOpen}><Icon name="link" size={14} /> Share a direct invite</button><span className="footer-separator">·</span><span>Peer-to-peer board data</span></footer>
      </main>

      {notice && <div className="toast" role="status"><span className="toast-check"><Icon name="check" size={15} /></span>{notice}</div>}

      {modal && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setModal(null) }}>
        {modal === 'guest-name' && <section className="modal note-modal" role="dialog" aria-modal="true" aria-labelledby="guest-name-title">
          <div className="modal-topline"><span className="modal-icon"><Icon name="users" /></span><button className="modal-close" onClick={() => setModal(null)} aria-label="Close"><Icon name="close" /></button></div>
          <h2 id="guest-name-title">What should we call you?</h2><p className="modal-description">Your name will appear to the board owner and teammates when you join.</p>
          <form onSubmit={(event) => void confirmGuestName(event)}>
            <label className="field-label" htmlFor="guest-display-name">Your name</label>
            <input id="guest-display-name" className="text-field" value={guestName} onChange={(event) => setGuestName(event.target.value)} placeholder="e.g. Taylor" maxLength={32} autoFocus required />
            <div className="modal-actions"><button type="button" className="button button-quiet" onClick={() => setModal(null)}>Cancel</button><button type="submit" className="button button-primary" disabled={!guestName.trim()}><Icon name="arrow" size={16} /> Join board</button></div>
          </form>
        </section>}
        {modal === 'note' && <section className="modal note-modal" role="dialog" aria-modal="true" aria-labelledby="note-title">
          <div className="modal-topline"><span className="modal-icon"><Icon name="spark" /></span><button className="modal-close" onClick={() => setModal(null)} aria-label="Close"><Icon name="close" /></button></div>
          <h2 id="note-title">Add a thought</h2><p className="modal-description">What’s on your mind? Good, tricky, or somewhere in between.</p>
          <form onSubmit={addNote}>
            <label className="field-label" htmlFor="note-column">Add to</label><select id="note-column" className="text-field" value={noteColumn} onChange={(event) => setNoteColumn(event.target.value)}>{board.columns.map((column) => <option value={column.id} key={column.id}>{column.title}</option>)}</select>
            <label className="field-label thought-label" htmlFor="note-text">Your thought</label><textarea id="note-text" className="text-field note-input" placeholder="Share a moment, an idea, or something we can make better…" value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={500} autoFocus required />
            <label className="anonymous-toggle"><input type="checkbox" checked={anonymous} onChange={(event) => setAnonymous(event.target.checked)} /><span className="custom-checkbox"><Icon name="check" size={13} /></span><span>Post anonymously</span><span className="anonymous-hint">Your name won’t appear on this thought</span></label>
            <div className="modal-actions"><button type="button" className="button button-quiet" onClick={() => setModal(null)}>Cancel</button><button type="submit" className="button button-primary" disabled={!draft.trim()}><Icon name="plus" size={16} /> Add thought</button></div>
          </form>
        </section>}

        {modal === 'settings' && <section className="modal settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
          <div className="modal-topline"><span className="modal-icon"><Icon name="settings" /></span><button className="modal-close" onClick={() => setModal(null)} aria-label="Close"><Icon name="close" /></button></div>
          <h2 id="settings-title">Board settings</h2><p className="modal-description">Make this board feel right for your team.</p>
          <label className="field-label" htmlFor="board-name">Board name</label><input id="board-name" className="text-field" value={editBoardTitle} disabled={!isHost} onChange={(event) => setEditBoardTitle(event.target.value)} placeholder="Name this retrospective" maxLength={60} />
          <label className="field-label" htmlFor="profile-name">Your name</label><input id="profile-name" className="text-field" value={editName} onChange={(event) => setEditName(event.target.value)} placeholder="Add your name" maxLength={32} />
          <label className="field-label" htmlFor="retention-days">Automatically delete inactive board data</label><select id="retention-days" className="text-field" value={board.retentionDays} disabled={isGuest} onChange={(event) => setBoard((current) => ({ ...current, retentionDays: Number(event.target.value) }))}><option value={0}>Never</option><option value={7}>After 7 days</option><option value={30}>After 30 days</option><option value={90}>After 90 days</option></select>
          <p className="settings-hint">Retention is applied locally on each device, based on the board’s last update.</p>
          <div className="settings-section-title"><span>Columns</span><span>{board.columns.length} of 5</span></div>
          {isGuest && <p className="settings-hint">The host manages shared board columns.</p>}
          <div className="column-editor">{board.columns.map((column, index) => <div className="column-edit-row" key={column.id}><span className={`column-swatch column-${column.color}`} /><input className="text-field" value={column.title} aria-label={`Column ${index + 1} name`} maxLength={28} disabled={isGuest} onChange={(event) => updateColumn(column.id, event.target.value)} /><button className="remove-column" onClick={() => { if (board.columns.length > 1) setBoard((current) => { const fallback = current.columns.find((item) => item.id !== column.id); if (!fallback) return current; return { ...current, columns: current.columns.filter((item) => item.id !== column.id), notes: current.notes.map((note) => note.columnId === column.id ? { ...note, columnId: fallback.id } : note) } }) }} disabled={board.columns.length < 2 || isGuest} title="Remove column"><Icon name="trash" size={15} /></button></div>)}</div>
          {board.columns.length < 5 && !isGuest && <button className="settings-add-column" onClick={addColumn}><Icon name="plus" size={15} /> Add a column</button>}
          {isHost && Object.keys(participants).length > 0 && <div className="ownership-transfer">
            <div className="settings-section-title"><span>Transfer ownership</span></div>
            <p className="settings-hint">Choose a connected teammate to become the board owner.</p>
            <select className="text-field" aria-label="New board owner" value={transferTarget} onChange={(event) => setTransferTarget(event.target.value)}>
              {Object.entries(participants).map(([peerId, name]) => <option value={peerId} key={peerId}>{name}</option>)}
            </select>
            <button className="button button-soft" disabled={!transferTarget} onClick={() => {
              const room = roomRef.current
              const name = participants[transferTarget]
              if (!room || !name) return
              try {
                room.transferOwnership(transferTarget, name)
                setModal(null)
              } catch (error) {
                toast(error instanceof Error ? error.message : 'Could not transfer board ownership.')
              }
            }}>Transfer ownership</button>
          </div>}
          <div className="modal-actions"><button className="button button-quiet" onClick={() => setModal(null)}>Done</button><button className="button button-primary" onClick={() => { setParticipantName(editName.trim()); if (isHost) setBoard((current) => ({ ...current, title: editBoardTitle.trim() || current.title })); setModal(null); toast('Your preferences are saved.') }}><Icon name="check" size={16} /> Save changes</button></div>
        </section>}

        {modal === 'new-board' && <section className="modal note-modal" role="dialog" aria-modal="true" aria-labelledby="new-board-title">
          <div className="modal-topline"><span className="modal-icon"><Icon name="spark" /></span><button className="modal-close" onClick={() => setModal(null)} aria-label="Close"><Icon name="close" /></button></div>
          <h2 id="new-board-title">Start a new retro</h2><p className="modal-description">Set up your board and invite the team with a direct room link.</p>
          <form onSubmit={(event) => void createBoard(event)}><label className="field-label" htmlFor="new-board-name">Board name</label><input id="new-board-name" className="text-field" value={newBoardTitle} onChange={(event) => setNewBoardTitle(event.target.value)} placeholder="e.g. Sprint 25 retrospective" maxLength={60} required autoFocus /><label className="field-label" htmlFor="new-board-owner-name">Your name</label><input id="new-board-owner-name" className="text-field" value={participantName} onChange={(event) => setParticipantName(event.target.value)} placeholder="How should your team identify you?" maxLength={32} required /><div className="settings-section-title"><span>Columns</span><span>{newBoardColumns.length} of 5</span></div><div className="column-editor">{newBoardColumns.map((column, index) => <div className="column-edit-row" key={index}><span className={`column-swatch column-${['mint', 'peach', 'lavender', 'blue', 'yellow'][index]}`} /><input className="text-field" value={column} onChange={(event) => updateNewBoardColumn(index, event.target.value)} placeholder={`Column ${index + 1}`} aria-label={`Column ${index + 1}`} maxLength={28} required /><button type="button" className="remove-column" onClick={() => removeNewBoardColumn(index)} disabled={newBoardColumns.length <= 2} title="Remove column"><Icon name="trash" size={15} /></button></div>)}</div>{newBoardColumns.length < 5 && <button type="button" className="settings-add-column" onClick={addNewBoardColumn}><Icon name="plus" size={15} /> Add a column</button>}<div className="modal-actions"><button type="button" className="button button-quiet" onClick={() => setModal(null)}>Cancel</button><button type="submit" className="button button-primary" disabled={!participantName.trim() || newBoardColumns.some((column) => !column.trim())}><Icon name="plus" size={16} /> Create board</button></div></form>
        </section>}

        {modal === 'connect' && <section className="modal connect-modal" role="dialog" aria-modal="true" aria-labelledby="connect-title">
          <div className="modal-topline"><span className="modal-icon"><Icon name="users" /></span><button className="modal-close" onClick={() => setModal(null)} aria-label="Close"><Icon name="close" /></button></div>
          <h2 id="connect-title">Bring your team in</h2><p className="modal-description">Connect directly, peer to peer. Board data stays between browsers; PeerJS only helps them discover each other.</p>
          <div className="connection-steps"><span className="step-indicator active">1</span><span className="step-line" /><span className={`step-indicator ${signalStep !== 'start' ? 'active' : ''}`}>2</span><span className="step-line" /><span className={`step-indicator ${peerState === 'connected' ? 'active' : ''}`}>3</span><span className="steps-caption">Create room <span>·</span> Join by link <span>·</span> Connect</span></div>
          {peerState === 'connected' ? <div className="connected-state"><span className="connected-icon"><Icon name="check" size={22} /></span><strong>You’re connected!</strong><p>Your boards are syncing directly between browsers.</p>{isHost && <button className="button button-primary button-wide" onClick={() => void copySignal()}><Icon name={inviteCopied ? 'check' : 'copy'} size={16} />{inviteCopied ? 'Invite link copied' : 'Copy board invite'}</button>}<button className="button button-soft" onClick={() => { resetConnection(); setSignalStep('start') }}><Icon name="close" size={15} /> Disconnect peer</button></div>
            : signalStep === 'start' ? <>
              <div className="role-tabs"><button className={peerRole === 'host' ? 'selected' : ''} onClick={() => { resetConnection(); setPeerRole('host') }}>I’m hosting</button><button className={peerRole === 'guest' ? 'selected' : ''} onClick={() => { resetConnection(); setPeerRole('guest') }}>I’m joining</button></div>
              <div className="how-it-works"><span className="how-icon"><Icon name={peerRole === 'host' ? 'link' : 'send'} size={17} /></span><p>{peerRole === 'host' ? <>Create a room, then share its invite link. Your teammate opens the link and joins—no reply code needed.</> : <>Open your teammate’s invite link or paste their room ID to join their board.</>}</p></div>
              {peerRole === 'host' ? <button className="button button-primary button-wide" onClick={() => void startOwnerRoom(board)} disabled={peerState === 'connecting'}><Icon name="link" size={16} />{peerState === 'connecting' ? 'Creating room…' : 'Create a room invite'}</button>
                : <form onSubmit={(event) => void joinRoom(event)}><label className="field-label" htmlFor="invite-code">Room ID or invite link</label><input className="text-field" id="invite-code" value={signalText} onChange={(event) => {
                  const input = event.target.value.trim()
                  try { setSignalText(new URL(input).searchParams.get('join') ?? input) }
                  catch { setSignalText(input) }
                }} placeholder="Paste an invite link or room ID…" required /><button className="button button-primary button-wide join-room-button" type="submit" disabled={peerState === 'connecting'}><Icon name="arrow" size={16} />{peerState === 'connecting' ? 'Joining room…' : 'Join room'}</button></form>}
              <p className="signaling-note"><Icon name="lock" size={14} /> Board data travels directly between browsers. PeerJS uses a lightweight signaling service to introduce peers; it does not relay your board.</p>
            </> : signalStep === 'offer' ? <>
              <div className="exchange-heading"><span className="exchange-step">{peerRole === 'host' ? 'YOUR ROOM IS READY' : 'JOIN REQUEST SENT'}</span><strong>{peerRole === 'host' ? 'Share this link with your teammate' : 'Waiting for the host to connect'}</strong><span>{peerRole === 'host' ? 'They can join directly from the link, or enter the room ID in the Join tab.' : 'The board will sync automatically while the host remains online.'}</span></div>
              {peerRole === 'host' && <>
                <div className="room-id-display"><span>ROOM ID</span><code>{signalResult}</code></div>
                <button className="button button-primary button-wide" onClick={() => void copySignal()}><Icon name={inviteCopied ? 'check' : 'copy'} size={16} />{inviteCopied ? 'Invite link copied' : 'Copy invite link'}</button>
              </>}
              <div className="waiting-message"><span className="waiting-spinner" />{peerState === 'failed' ? 'Could not connect — create a new invite and try again.' : peerRole === 'host' ? 'Waiting for your teammate to join…' : 'Connecting directly to the host…'}</div>
              <button className="text-back" onClick={resetConnection}><Icon name="arrow" size={14} /> Cancel invite</button>
            </> : null}
        </section>}
      </div>}
      </>}
    </div>
  )
}

export default App
