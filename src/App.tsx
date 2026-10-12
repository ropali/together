import { useEffect, useRef, useState, type FormEvent, type SetStateAction } from 'react'
import { P2PYjsRoom } from './lib/p2pYjs'
import {
  observeRetroBoard,
  writeRetroBoard,
  type RetroBoard,
  type RetroColumn,
  type RetroNote,
  type RetroComment,
} from './lib/retroBoardSync'
import togetherLogo from './assets/together-logo.png'
import { MarkdownView } from './components/MarkdownView'
import './App.css'

type Note = RetroNote
type BoardData = RetroBoard
type Modal = 'connect' | 'settings' | 'new-board' | 'guest-name' | null

const REACTION_ACTOR_KEY = 'together-retro-reaction-actor-v5'
const STORAGE_KEY = 'together-retro-boards-v5'
const ACTIVE_BOARD_KEY = 'together-retro-active-board-v5'

function getReactionActorId(): string {
  const saved = localStorage.getItem(REACTION_ACTOR_KEY)
  if (saved) return saved
  const actorId = crypto.randomUUID()
  localStorage.setItem(REACTION_ACTOR_KEY, actorId)
  return actorId
}

function ensureActionItemsAtLast<T extends { title?: string } | string>(columns: T[]): T[] {
  const getTitle = (c: T) => (typeof c === 'string' ? c : (c as { title?: string }).title || '')
  const nonActions = columns.filter((c) => !getTitle(c).toLowerCase().includes('action'))
  const actions = columns.filter((c) => getTitle(c).toLowerCase().includes('action'))
  return [...nonActions, ...actions]
}

const DEFAULT_COLUMN_TITLES = ['What went well', 'What went wrong', 'Kudos & Shoutouts', 'Action items']
const routeParams = new URLSearchParams(window.location.search)
const joinPeerId = routeParams.get('join')?.trim() ?? ''
const ownerPeerId = routeParams.get('owner')?.trim() ?? ''
const boardRouteDetails = (() => {
  const encoded = routeParams.get('setup')
  if (!encoded) return null
  try {
    const value: unknown = JSON.parse(encoded)
    if (
      typeof value !== 'object' ||
      value === null ||
      !('id' in value) ||
      typeof value.id !== 'string' ||
      !('title' in value) ||
      typeof value.title !== 'string' ||
      !('columns' in value) ||
      !Array.isArray(value.columns) ||
      value.columns.length < 2 ||
      value.columns.length > 5 ||
      !value.columns.every(
        (column: unknown) =>
          typeof column === 'string' && column.trim().length > 0 && column.length <= 28,
      )
    )
      return null
    return { id: value.id, title: value.title.slice(0, 60), columns: ensureActionItemsAtLast(value.columns as string[]) }
  } catch {
    return null
  }
})()
const sharedBoardId = routeParams.get('board')?.trim() || boardRouteDetails?.id || ''

const initialBoard: BoardData = {
  id: 'sprint-retro',
  title: 'Sprint Retrospective',
  updatedAt: Date.now(),
  retentionDays: 0,
  columns: [
    { id: 'col-well', title: 'What went well', color: 'mint' },
    { id: 'col-wrong', title: 'What went wrong', color: 'peach' },
    { id: 'col-kudos', title: 'Kudos & Shoutouts', color: 'blue' },
    { id: 'col-actions', title: 'Action items', color: 'lavender' },
  ],
  notes: [],
  locked: false,
  timer: { durationMinutes: 10, remainingSeconds: 10 * 60, endsAt: null },
}

function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('') || '?'
}

const AVATAR_PALETTES = [
  'bg-primary-fixed text-on-primary-fixed',
  'bg-secondary-fixed text-on-secondary-fixed',
  'bg-tertiary-fixed text-on-tertiary-fixed',
  'bg-primary-container text-on-primary-container',
  'bg-secondary-container text-on-secondary-container',
  'bg-tertiary-container text-on-tertiary-container',
]

function getAuthorAvatarClass(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) & 0xffffffff
  }
  return AVATAR_PALETTES[Math.abs(hash) % AVATAR_PALETTES.length] || 'bg-surface-container-high text-on-surface'
}

function relativeTime(timestamp: number, now: number): string {
  if (!timestamp) return ''
  const elapsed = Math.max(0, now - timestamp)
  if (elapsed < 60_000) return 'just now'
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m ago`
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h ago`
  return `${Math.floor(elapsed / 86_400_000)}d ago`
}

function playTimerChime() {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (!AudioCtx) return
    const ctx = new AudioCtx()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(587.33, ctx.currentTime)
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15)
    gain.gain.setValueAtTime(0.15, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + 0.8)
  } catch {
    // Autoplay or audio context unavailable
  }
}

interface ColumnMeta {
  emoji: string
  subtitle: string
  placeholder: string
  gradient: string
  countBadge: string
  buttonBg: string
}

function getColumnMeta(title: string, index: number): ColumnMeta {
  const lower = title.toLowerCase()
  if (lower.includes('well') || lower.includes('good') || lower.includes('win')) {
    return {
      emoji: '🌿',
      subtitle: 'Wins, accelerators & positive energy',
      placeholder: 'Write a win, shoutout or positive momentum...',
      gradient: 'from-secondary-fixed-dim via-secondary to-secondary-fixed',
      countBadge: 'bg-secondary-fixed/40 text-on-secondary-fixed',
      buttonBg: 'bg-secondary text-on-secondary',
    }
  }
  if (lower.includes('wrong') || lower.includes('better') || lower.includes('bad') || lower.includes('problem')) {
    return {
      emoji: '🍊',
      subtitle: 'Friction, pain points & bottlenecks',
      placeholder: 'What went wrong or caused friction...',
      gradient: 'from-tertiary-fixed via-tertiary to-tertiary-container',
      countBadge: 'bg-tertiary-fixed text-on-tertiary-fixed',
      buttonBg: 'bg-tertiary text-on-tertiary',
    }
  }
  if (lower.includes('kudos') || lower.includes('shout') || lower.includes('thanks') || lower.includes('praise')) {
    return {
      emoji: '✨',
      subtitle: 'Appreciation & celebrating wins',
      placeholder: 'Give props or thank a teammate...',
      gradient: 'from-primary-fixed via-secondary-fixed to-primary-container',
      countBadge: 'bg-primary-fixed text-on-primary-fixed',
      buttonBg: 'bg-primary-container text-on-primary-container',
    }
  }
  if (lower.includes('action') || lower.includes('next') || lower.includes('todo') || lower.includes('task')) {
    return {
      emoji: '⚡',
      subtitle: 'Commitments & tangible improvements',
      placeholder: 'Add an actionable improvement or next step...',
      gradient: 'from-primary-fixed-dim via-primary to-primary-container',
      countBadge: 'bg-primary-fixed text-on-primary-fixed',
      buttonBg: 'bg-primary text-on-primary',
    }
  }
  const fallbackPalettes: ColumnMeta[] = [
    {
      emoji: '💡',
      subtitle: 'Ideas and discussions',
      placeholder: 'Share a thought...',
      gradient: 'from-secondary-fixed-dim via-secondary to-secondary-fixed',
      countBadge: 'bg-secondary-fixed/40 text-on-secondary-fixed',
      buttonBg: 'bg-secondary text-on-secondary',
    },
    {
      emoji: '📌',
      subtitle: 'Notes and points',
      placeholder: 'Share a note...',
      gradient: 'from-tertiary-fixed via-tertiary to-tertiary-container',
      countBadge: 'bg-tertiary-fixed text-on-tertiary-fixed',
      buttonBg: 'bg-tertiary text-on-tertiary',
    },
    {
      emoji: '🎯',
      subtitle: 'Focus topics',
      placeholder: 'Write your point...',
      gradient: 'from-primary-fixed via-secondary-fixed to-primary-container',
      countBadge: 'bg-primary-fixed text-on-primary-fixed',
      buttonBg: 'bg-primary text-on-primary',
    },
  ]
  return fallbackPalettes[index % fallbackPalettes.length]!
}

function readBoards(): BoardData[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY) || localStorage.getItem('together-retro-boards-v4')
    if (saved) {
      const parsed: unknown = JSON.parse(saved)
      if (Array.isArray(parsed) && parsed.length > 0) {
        return (parsed as BoardData[]).map((b) => {
          const timer = !b.timer || b.timer.endsAt === null || b.timer.durationMinutes === 15
            ? { durationMinutes: 10, remainingSeconds: 10 * 60, endsAt: null }
            : b.timer
          return {
            ...b,
            timer,
            columns: ensureActionItemsAtLast((b.columns || []).map((col) => {
              const lower = col.title.toLowerCase()
              if (lower === 'could be better' || col.title === 'What Went Wrong') {
                return { ...col, title: 'What went wrong' }
              }
              return col
            })),
          }
        })
      }
    }
  } catch (error) {
    console.warn('Could not restore saved retro boards.', error)
  }
  return []
}

function createBoardData(title: string, columnTitles: string[]): BoardData {
  const columnPalette: RetroColumn['color'][] = ['mint', 'peach', 'lavender', 'blue', 'yellow']
  const orderedTitles = ensureActionItemsAtLast(columnTitles)
  return {
    ...initialBoard,
    id: crypto.randomUUID(),
    title,
    updatedAt: Date.now(),
    retentionDays: 0,
    columns: orderedTitles.map((columnTitle, index) => ({
      id: `col-${index + 1}-${columnTitle.toLowerCase().replace(/[^a-z0-9]/g, '') || index}`,
      title: columnTitle.toLowerCase() === 'could be better' || columnTitle === 'What Went Wrong' ? 'What went wrong' : columnTitle,
      color: columnPalette[index % columnPalette.length] as RetroColumn['color'],
    })),
    notes: [],
    locked: false,
    timer: { durationMinutes: 10, remainingSeconds: 10 * 60, endsAt: null },
  }
}

const emptyBoard: BoardData = {
  ...initialBoard,
  id: sharedBoardId || 'joining-board',
  title: boardRouteDetails?.title || 'Connecting to board…',
  columns: ensureActionItemsAtLast((boardRouteDetails?.columns || DEFAULT_COLUMN_TITLES).map((title, index) => ({
    id: `joining-column-${index}-${title.toLowerCase().replace(/[^a-z0-9]/g, '') || index}`,
    title,
    color: (['mint', 'peach', 'lavender', 'blue', 'yellow'] as RetroColumn['color'][])[index % 5] as RetroColumn['color'],
  }))),
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
    columns: ensureActionItemsAtLast(boardRouteDetails.columns.map((title, index) => ({
      id: `${boardRouteDetails.id}-column-${index}`,
      title,
      color: (['mint', 'peach', 'lavender', 'blue', 'yellow'] as RetroColumn['color'][])[index % 5] as RetroColumn['color'],
    }))),
  }
}

function stableHostPeerId(boardId: string): string {
  return `retro-${boardId}`
}

function updateBoardUrl(board: BoardData, role: 'owner' | 'invite', hostPeerId: string): string {
  const url = new URL(window.location.href)
  url.search = ''
  url.searchParams.set(role === 'owner' ? 'owner' : 'join', hostPeerId)
  url.searchParams.set('board', board.id)
  url.searchParams.set(
    'setup',
    JSON.stringify({
      id: board.id,
      title: board.title,
      columns: board.columns.map((column) => column.title),
    }),
  )
  return url.toString()
}

const AVAILABLE_REACTIONS = ['👍', '❤️', '🎉', '🔥', '👏'] as const

function ReactionPickerPopover({
  noteId,
  reactions,
  currentActorId,
  onToggleReaction,
  onClose,
  align = 'left',
}: {
  noteId: string
  reactions: Record<string, string[]>
  currentActorId: string
  onToggleReaction: (noteId: string, emoji: string) => void
  onClose: () => void
  align?: 'left' | 'right'
}) {
  return (
    <div
      className={`absolute bottom-full mb-2 z-50 flex items-center gap-1.5 p-1.5 rounded-2xl bg-surface-container-lowest/95 backdrop-blur-md border border-outline-variant/40 shadow-xl whitespace-nowrap ${
        align === 'right' ? 'right-0' : 'left-0'
      }`}
      onClick={(e) => e.stopPropagation()}
    >
      {AVAILABLE_REACTIONS.map((emoji) => {
        const actors = reactions[emoji] ?? []
        const active = actors.includes(currentActorId)
        return (
          <button
            key={emoji}
            type="button"
            onClick={() => {
              onToggleReaction(noteId, emoji)
              onClose()
            }}
            className={`w-8 h-8 rounded-full flex items-center justify-center text-base transition-transform hover:scale-125 cursor-pointer ${
              active ? 'bg-primary-fixed ring-1 ring-primary' : 'hover:bg-surface-container'
            }`}
            title={`React with ${emoji}`}
          >
            {emoji}
          </button>
        )
      })}
    </div>
  )
}

function App() {
  const [boards, setBoards] = useState<BoardData[]>(readBoards)
  const [activeBoardId, setActiveBoardId] = useState(() => sharedBoardId || localStorage.getItem(ACTIVE_BOARD_KEY) || initialBoard.id)
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
  const [timerNow, setTimerNow] = useState(Date.now)
  const [inlineDrafts, setInlineDrafts] = useState<Record<string, string>>({})
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({})
  const [expandedComments, setExpandedComments] = useState<Record<string, boolean>>({})
  const [sortByVotes, setSortByVotes] = useState<Record<string, boolean>>({})
  const [anonymous, setAnonymous] = useState(false)
  const [participantName, setParticipantName] = useState(() => localStorage.getItem('together-retro-name') || '')
  const [reactionActorId] = useState(getReactionActorId)
  const [reactionPickerNoteId, setReactionPickerNoteId] = useState('')
  const [guestName, setGuestName] = useState(() => localStorage.getItem('together-retro-name') || '')
  const [pendingPeerId, setPendingPeerId] = useState(joinPeerId)
  const [editName, setEditName] = useState(() => localStorage.getItem('together-retro-name') || 'You')
  const [editBoardTitle, setEditBoardTitle] = useState(board.title)
  const [newBoardTitle, setNewBoardTitle] = useState('')
  const [newBoardColumns, setNewBoardColumns] = useState<string[]>(DEFAULT_COLUMN_TITLES)
  const [boardCreatedThisVisit, setBoardCreatedThisVisit] = useState(false)
  const [notice, setNotice] = useState('')
  const chimePlayedRef = useRef(false)

  // P2P State
  type PeerRole = 'host' | 'guest'
  type PeerState = 'idle' | 'connecting' | 'ready' | 'connected' | 'disconnected' | 'failed'
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

  const roomRef = useRef<P2PYjsRoom | null>(null)
  const autoHostStartedRef = useRef(false)
  const startOwnerRoomRef = useRef<(ownerBoard: BoardData, displayName?: string) => Promise<boolean>>(async () => false)
  const announcedPeersRef = useRef(new Set<string>())
  const boardRef = useRef(board)
  const toastTimeout = useRef<number | undefined>(undefined)

  const toast = (message: string) => {
    window.clearTimeout(toastTimeout.current)
    setNotice(message)
    toastTimeout.current = window.setTimeout(() => setNotice(''), 2800)
  }

  useEffect(() => {
    boardRef.current = board
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(boards))
      localStorage.setItem(ACTIVE_BOARD_KEY, board.id)
    } catch (error) {
      console.warn('Could not save retro boards locally.', error)
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
    const timerInterval = window.setInterval(() => {
      setTimerNow(Date.now())
    }, 1000)
    return () => window.clearInterval(timerInterval)
  }, [])

  useEffect(() => {
    if (!reactionPickerNoteId) return
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest('.reaction-picker-container')) {
        setReactionPickerNoteId('')
      }
    }
    document.addEventListener('click', handleClickOutside)
    return () => document.removeEventListener('click', handleClickOutside)
  }, [reactionPickerNoteId])

  const focusComposer = (colId: string) => {
    const col = document.getElementById(colId)
    if (col) {
      col.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      const textarea = col.querySelector<HTMLTextAreaElement>('textarea')
      if (textarea) {
        textarea.focus()
        textarea.classList.add('ring-2', 'ring-primary')
        setTimeout(() => textarea.classList.remove('ring-2', 'ring-primary'), 1000)
      }
    }
  }

  const triggerConfetti = (e?: React.MouseEvent) => {
    if (e?.currentTarget) {
      const btn = e.currentTarget as HTMLElement
      btn.classList.add('scale-125')
      setTimeout(() => btn.classList.remove('scale-125'), 300)
    }
    toast('Team appreciation sent! 🎉')
  }

  // Voting micro-interaction
  const toggleVote = (noteId: string) => {
    if (board.locked) return
    setBoard((current) => ({
      ...current,
      notes: current.notes.map((note) => {
        if (note.id !== noteId) return note
        const hasVoted = note.voteIds.includes(reactionActorId)
        return {
          ...note,
          votes: hasVoted ? Math.max(0, note.votes - 1) : note.votes + 1,
          voteIds: hasVoted
            ? note.voteIds.filter((id) => id !== reactionActorId)
            : [...note.voteIds, reactionActorId],
        }
      }),
    }))
  }

  const toggleReaction = (noteId: string, emoji: string) => {
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
    if (board.locked) return
    setBoard((current) => ({
      ...current,
      notes: current.notes.filter((n) => n.id !== noteId),
    }))
    toast('Note deleted.')
  }

  const deleteComment = (noteId: string, commentId: string) => {
    if (board.locked) return
    setBoard((current) => ({
      ...current,
      notes: current.notes.map((note) =>
        note.id === noteId
          ? { ...note, comments: note.comments.filter((c) => c.id !== commentId) }
          : note,
      ),
    }))
  }

  const addInlineNote = (event: FormEvent, columnId: string) => {
    event.preventDefault()
    const text = inlineDrafts[columnId]?.trim()
    if (!text || board.locked) return
    const newNote: Note = {
      id: crypto.randomUUID(),
      columnId,
      text,
      author: anonymous ? 'Anonymous' : (participantName.trim() || 'Anonymous'),
      anonymous,
      votes: 0,
      voteIds: [],
      reactions: {},
      createdAt: timerNow,
      comments: [],
      done: false,
    }
    setBoard((current) => ({ ...current, notes: [...current.notes, newNote] }))
    setInlineDrafts((current) => ({ ...current, [columnId]: '' }))
    toast('Your thought has been posted.')
  }

  const addComment = (event: FormEvent, noteId: string) => {
    event.preventDefault()
    const text = commentDrafts[noteId]?.trim()
    if (!text || board.locked) return
    const comment: RetroComment = {
      id: crypto.randomUUID(),
      author: anonymous ? 'Anonymous' : (participantName.trim() || 'Anonymous'),
      text,
      createdAt: timerNow,
    }
    setBoard((current) => ({
      ...current,
      notes: current.notes.map((note) => note.id === noteId ? { ...note, comments: [...note.comments, comment] } : note),
    }))
    setCommentDrafts((current) => ({ ...current, [noteId]: '' }))
  }

  const timerSeconds = board.timer.endsAt === null
    ? board.timer.remainingSeconds
    : Math.max(0, Math.ceil((board.timer.endsAt - timerNow) / 1000))
  const timerRunning = board.timer.endsAt !== null && timerSeconds > 0
  const displayTime = `${String(Math.floor(timerSeconds / 60)).padStart(2, '0')}:${String(timerSeconds % 60).padStart(2, '0')}`
  const totalTimerSeconds = Math.max(1, board.timer.durationMinutes * 60, timerSeconds)
  const timerProgress = Math.min(1, Math.max(0, timerSeconds / totalTimerSeconds))
  const strokeDashoffset = Number((94.2 * (1 - timerProgress)).toFixed(1))
  const progressPercent = Math.round(timerProgress * 100)
  const minutesLeft = Math.ceil(timerSeconds / 60)
  const timeLeftLabel = timerSeconds <= 0 ? '0m left' : timerSeconds < 60 ? `${timerSeconds}s left` : `${minutesLeft}m left`

  const addTimerMinutes = (minutes: number) => {
    const addSeconds = minutes * 60
    setBoard((current) => {
      const curSeconds = current.timer.endsAt === null
        ? current.timer.remainingSeconds
        : Math.max(0, Math.ceil((current.timer.endsAt - Date.now()) / 1000))
      const newSeconds = curSeconds + addSeconds
      const newDuration = Math.max(current.timer.durationMinutes, Math.ceil(newSeconds / 60))
      return {
        ...current,
        timer: {
          ...current.timer,
          durationMinutes: newDuration,
          remainingSeconds: newSeconds,
          endsAt: current.timer.endsAt !== null ? Date.now() + newSeconds * 1000 : null,
        },
      }
    })
    toast(`Added +${minutes}m to the timer.`)
  }

  const toggleTimer = () => {
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
    const seconds = timerSeconds > 0 ? timerSeconds : board.timer.durationMinutes * 60
    setBoard((current) => ({
      ...current,
      timer: { ...current.timer, remainingSeconds: seconds, endsAt: Date.now() + seconds * 1000 },
    }))
  }

  useEffect(() => {
    if (timerRunning) {
      chimePlayedRef.current = false
    } else if (board.timer.endsAt !== null && timerSeconds === 0 && !chimePlayedRef.current) {
      chimePlayedRef.current = true
      playTimerChime()
    }
  }, [timerRunning, timerSeconds, board.timer.endsAt])

  const observeRoom = (room: P2PYjsRoom, owner: boolean) => {
    observeRetroBoard(room.doc, (remoteBoard) => {
      if (sharedBoardId && remoteBoard.id !== sharedBoardId) {
        toast('This invite does not match the board ID in its link.')
        return
      }
      const normalizedBoard: BoardData = {
        ...remoteBoard,
        columns: ensureActionItemsAtLast(remoteBoard.columns),
      }
      setBoards((current) => current.some((item) => item.id === normalizedBoard.id)
        ? current.map((item) => item.id === normalizedBoard.id ? normalizedBoard : item)
        : [...current, normalizedBoard])
      setActiveBoardId(normalizedBoard.id)
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
        onPeerPresence: (peerId, pName) => {
          const name = pName.trim() || 'Participant'
          setParticipants((current) => ({ ...current, [peerId]: name }))
          if (!announcedPeersRef.current.has(peerId)) {
            announcedPeersRef.current.add(peerId)
            toast(`${name} joined the board.`)
          }
        },
        onOwnerChanged: (_newOwnerPeerId, newOwnerName) => {
          toast(`${newOwnerName} is now the board owner.`)
        },
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
      toast('Invalid room ID.')
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
        },
        onPeerPresence: (pId, name) => {
          setParticipants((current) => ({ ...current, [pId]: name.trim() || 'Teammate' }))
        },
        onPeerSynced: () => setPeerState('connected'),
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
    if (!name) return
    setParticipantName(name)
    localStorage.setItem('together-retro-name', name)
    setModal(null)
    const targetPeerId = pendingPeerId || joinPeerId
    if (targetPeerId) {
      toast(`Joining board as ${name}…`)
      await connectAsGuest(targetPeerId, name)
    }
  }

  const createBoard = async (event: FormEvent) => {
    event.preventDefault()
    const title = newBoardTitle.trim()
    const ownerName = participantName.trim()
    const columns = ensureActionItemsAtLast(newBoardColumns.map((col) => col.trim()).filter(Boolean).slice(0, 5))
    if (!title || !ownerName || columns.length < 2) return
    localStorage.setItem('together-retro-name', ownerName)
    const nextBoard = createBoardData(title, columns)
    roomRef.current?.destroy()
    roomRef.current = null
    setBoards((current) => [...current, nextBoard])
    setActiveBoardId(nextBoard.id)
    setBoardCreatedThisVisit(true)
    setIsHost(true)
    setNewBoardTitle('')
    setModal(null)
    const roomReady = await startOwnerRoom(nextBoard, ownerName)
    toast(roomReady ? 'Your board is ready! Share the link to invite your team.' : 'Board created locally.')
  }

  const addNewBoardColumn = () => {
    setNewBoardColumns((current) => {
      if (current.length >= 5) return current
      const actionIdx = current.findIndex((c) => c.toLowerCase().includes('action'))
      if (actionIdx !== -1) {
        const next = [...current]
        next.splice(actionIdx, 0, '')
        return next
      }
      return [...current, '']
    })
  }

  const removeNewBoardColumn = (index: number) => {
    setNewBoardColumns((current) => (current.length > 2 ? current.filter((_, i) => i !== index) : current))
  }

  const updateNewBoardColumn = (index: number, title: string) => {
    setNewBoardColumns((current) => current.map((c, i) => (i === index ? title : c)))
  }

  const copyInviteDirect = async () => {
    try {
      const hostId = roomRef.current?.id || signalResult || ownerPeerId || stableHostPeerId(board.id)
      if (!roomRef.current && isHost) {
        await startOwnerRoom(board, participantName)
      }
      const invite = new URL(window.location.href)
      invite.search = ''
      invite.searchParams.set('join', hostId)
      invite.searchParams.set('board', board.id)
      invite.searchParams.set(
        'setup',
        JSON.stringify({
          id: board.id,
          title: board.title,
          columns: board.columns.map((column) => column.title),
        }),
      )
      await navigator.clipboard.writeText(invite.toString())
      setInviteCopied(true)
      toast('Board invite link copied to clipboard!')
    } catch {
      setModal('connect')
    }
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
    setModal('settings')
  }

  useEffect(() => {
    if (!ownerPeerId || autoHostStartedRef.current) return
    autoHostStartedRef.current = true
    setBoardCreatedThisVisit(true)
    void startOwnerRoomRef.current(boardRef.current)
  }, [])

  useEffect(() => () => {
    roomRef.current?.destroy()
    window.clearTimeout(toastTimeout.current)
  }, [])

  const showSetupPage = !joinPeerId && !ownerPeerId && !boardCreatedThisVisit
  const waitingForSharedBoard = Boolean(joinPeerId) && !sharedBoardReceived

  return (
    <div className="bg-background font-body-md text-on-surface antialiased min-h-screen flex flex-col">
      {showSetupPage ? (
        <main className="min-h-screen bg-background font-body-md text-on-surface flex flex-col items-center justify-center p-4 sm:p-8 relative overflow-hidden">
          {/* Subtle background glow decorations */}
          <div className="absolute top-[-10%] left-1/2 -translate-x-1/2 w-[600px] h-[350px] bg-primary/5 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute bottom-[-10%] right-[10%] w-[400px] h-[300px] bg-tertiary-fixed/30 rounded-full blur-3xl pointer-events-none" />

          {/* Brand header */}
          <div className="flex items-center mb-8 select-none">
            <img alt="Together Retro Logo" className="h-12 sm:h-14 w-auto object-contain drop-shadow-sm" src={togetherLogo} />
          </div>

          {/* Main Setup Card */}
          <div className="w-full max-w-[540px] rounded-3xl bg-surface-container-lowest border border-outline-variant/40 shadow-2xl p-6 sm:p-10 relative z-10">
            {/* Visual Header / Illustration */}
            <div className="flex flex-col items-center text-center mb-8">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary font-label-md text-label-md font-bold tracking-wider uppercase mb-3">
                <span className="material-symbols-outlined text-[16px]">auto_awesome</span>
                <span>A fresh start for your team</span>
              </div>
              <h1 className="font-headline-lg text-2xl sm:text-3xl text-on-surface font-extrabold tracking-tight mb-2">
                Make space to <span className="text-primary">look back together.</span>
              </h1>
              <p className="font-body-md text-body-md text-on-surface-variant max-w-md">
                Create a retrospective board. Invite your team with a direct link, then share thoughts and celebrate wins peer-to-peer.
              </p>
            </div>

            {/* Setup Form */}
            <form onSubmit={(e) => void createBoard(e)} className="flex flex-col gap-5">
              <div>
                <label className="block font-label-md text-label-md font-semibold text-on-surface mb-1.5" htmlFor="setup-board-name">
                  Give your retro a name
                </label>
                <input
                  id="setup-board-name"
                  type="text"
                  className="w-full px-4 py-3 rounded-2xl bg-surface-container-low border border-outline-variant/60 focus:border-primary focus:ring-2 focus:ring-primary/20 text-on-surface font-body-md text-body-md outline-none transition-all"
                  value={newBoardTitle}
                  onChange={(e) => setNewBoardTitle(e.target.value)}
                  placeholder="e.g. Sprint Retrospective"
                  maxLength={60}
                  required
                  autoFocus
                />
              </div>

              <div>
                <label className="block font-label-md text-label-md font-semibold text-on-surface mb-1.5" htmlFor="setup-owner-name">
                  Your name
                </label>
                <input
                  id="setup-owner-name"
                  type="text"
                  className="w-full px-4 py-3 rounded-2xl bg-surface-container-low border border-outline-variant/60 focus:border-primary focus:ring-2 focus:ring-primary/20 text-on-surface font-body-md text-body-md outline-none transition-all"
                  value={participantName}
                  onChange={(e) => setParticipantName(e.target.value)}
                  placeholder="How should your team identify you? (e.g. Alex)"
                  maxLength={32}
                  required
                />
              </div>

              {/* Columns Setup */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="font-label-md text-label-md font-semibold text-on-surface">Columns</span>
                  <span className="font-label-sm text-label-sm text-outline">{newBoardColumns.length} of 5</span>
                </div>
                <div className="flex flex-col gap-2.5">
                  {newBoardColumns.map((colTitle, index) => {
                    const colorClass = ['bg-emerald-400', 'bg-amber-400', 'bg-purple-400', 'bg-blue-400', 'bg-yellow-400'][index % 5]
                    return (
                      <div key={index} className="flex items-center gap-2">
                        <span className={`w-3 h-3 rounded-full shrink-0 ${colorClass}`} />
                        <input
                          type="text"
                          className="flex-1 px-3.5 py-2 rounded-xl bg-surface-container-low border border-outline-variant/50 focus:border-primary focus:ring-1 focus:ring-primary/20 text-on-surface font-body-sm text-body-sm outline-none transition-all"
                          value={colTitle}
                          onChange={(e) => updateNewBoardColumn(index, e.target.value)}
                          placeholder={`Column ${index + 1}`}
                          maxLength={28}
                          required
                        />
                        <button
                          type="button"
                          className="w-8 h-8 rounded-lg flex items-center justify-center text-outline hover:text-error hover:bg-error-container/20 disabled:opacity-30 disabled:hover:text-outline disabled:hover:bg-transparent transition-colors"
                          onClick={() => removeNewBoardColumn(index)}
                          disabled={newBoardColumns.length <= 2}
                          title="Remove column"
                        >
                          <span className="material-symbols-outlined text-[18px]">delete</span>
                        </button>
                      </div>
                    )
                  })}
                </div>
                {newBoardColumns.length < 5 && (
                  <button
                    type="button"
                    onClick={addNewBoardColumn}
                    className="mt-2.5 inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:text-primary/80 transition-colors"
                  >
                    <span className="material-symbols-outlined text-[16px]">add</span>
                    <span>Add a column</span>
                  </button>
                )}
              </div>

              {/* Buttons */}
              <div className="pt-2 flex flex-col gap-2.5">
                <button
                  type="submit"
                  disabled={!newBoardTitle.trim() || !participantName.trim() || newBoardColumns.some((c) => !c.trim())}
                  className="w-full py-3.5 rounded-2xl bg-primary text-on-primary font-headline-sm text-headline-sm font-bold shadow-lg shadow-primary/25 hover:shadow-xl hover:opacity-95 active:scale-[0.99] transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[20px]">rocket_launch</span>
                  <span>Create my board</span>
                </button>
              </div>

              {/* Privacy Footnote */}
              <div className="pt-2 border-t border-outline-variant/30 flex items-center justify-center gap-1.5 text-outline text-[12px]">
                <span className="material-symbols-outlined text-[14px]">lock</span>
                <span>No accounts needed. Board syncs peer-to-peer via WebRTC.</span>
              </div>
            </form>
          </div>
        </main>
      ) : (
        <>
          {/* HEADER BAR */}
          <header className="fixed top-0 left-0 right-0 z-50 bg-surface/90 backdrop-blur-xl shadow-[0_1px_8px_rgba(0,0,0,0.04)]">
            <div className="h-16 px-margin flex items-center justify-between gap-gutter max-w-[1920px] mx-auto w-full">
              {/* Left: Logo & Breadcrumbs */}
              <div className="flex items-center gap-space-md shrink-0">
                <div className="flex items-center cursor-pointer" onClick={() => setModal('settings')}>
                  <img alt="Together Retro Logo" className="h-9 sm:h-10 w-auto object-contain" src={togetherLogo} />
                </div>
                <div className="h-5 w-px bg-outline-variant/60"></div>
                <div className="flex items-center gap-space-xs text-on-surface">
                  <span className="font-headline-md text-headline-md text-on-surface font-semibold truncate max-w-[180px] lg:max-w-none">{board.title}</span>
                </div>
              </div>

              {/* Center: Retro Timer Widget */}
              <div className="hidden md:flex items-center justify-center">
                <div
                  className="inline-flex items-center gap-2.5 px-3 py-1.5 rounded-2xl bg-gradient-to-r from-surface-container-lowest via-surface-container-low to-surface-container-lowest border-2 border-secondary/40 shadow-md shadow-secondary/10 hover:shadow-lg hover:border-secondary transition-all relative group"
                  id="retro-timer-widget"
                >
                  <div className="flex items-center gap-2.5 pr-2.5 border-r border-outline-variant/40">
                    <div className="relative flex items-center justify-center w-8 h-8 rounded-full bg-secondary-fixed/40 text-secondary shrink-0 shadow-inner">
                      <svg className="absolute inset-0 w-full h-full -rotate-90 pointer-events-none" viewBox="0 0 36 36">
                        <circle className="text-secondary-fixed/40" cx="18" cy="18" fill="none" r="15" stroke="currentColor" strokeWidth="3" />
                        <circle
                          className="text-secondary transition-all drop-shadow-[0_0_4px_rgba(0,108,73,0.5)]"
                          cx="18"
                          cy="18"
                          fill="none"
                          r="15"
                          stroke="currentColor"
                          strokeDasharray="94.2"
                          strokeDashoffset={strokeDashoffset}
                          strokeLinecap="round"
                          strokeWidth="3"
                        />
                      </svg>
                      <span className="relative flex h-2 w-2">
                        {timerRunning && (
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-secondary opacity-75" />
                        )}
                        <span className={`relative inline-flex rounded-full h-2 w-2 ${timerRunning ? 'bg-secondary' : 'bg-outline'}`} />
                      </span>
                    </div>
                    <div className="flex flex-col text-left">
                      <div className="flex items-center gap-1.5">
                        <span className="font-timer-display text-[18px] font-bold text-on-surface tracking-tight font-mono" id="timer-display-digits">
                          {displayTime}
                        </span>
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-label-sm text-[10px] font-bold tracking-wider shadow-sm uppercase ${
                            timerSeconds === 0 ? 'bg-error text-on-error' : 'bg-secondary text-on-secondary'
                          }`}
                        >
                          <span className="material-symbols-outlined text-[11px]">{timerSeconds === 0 ? 'alarm' : 'bolt'}</span>
                          {timerSeconds === 0 ? 'TIME UP' : 'BRAINSTORM'}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <div className="w-16 h-1.5 rounded-full bg-surface-container-high overflow-hidden">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-secondary-fixed via-secondary to-secondary-fixed-dim transition-all duration-300"
                            style={{ width: `${progressPercent}%` }}
                          />
                        </div>
                        <span className="text-[10px] text-on-surface-variant leading-none font-label-sm font-semibold">
                          {timeLeftLabel}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      className="w-7 h-7 rounded-lg bg-secondary text-on-secondary hover:opacity-90 flex items-center justify-center shadow-sm hover:scale-105 active:scale-95 transition-all cursor-pointer"
                      id="timer-play-btn"
                      onClick={toggleTimer}
                      title={timerRunning ? 'Pause Timer' : 'Resume / Start Timer'}
                      type="button"
                    >
                      <span className="material-symbols-outlined text-[16px]">{timerRunning ? 'pause' : 'play_arrow'}</span>
                    </button>
                    <button
                      className="px-1.5 py-1 rounded-lg bg-surface-container hover:bg-secondary-fixed/40 text-on-surface hover:text-on-secondary-fixed font-label-sm text-[11px] font-bold transition-all cursor-pointer"
                      onClick={() => addTimerMinutes(1)}
                      title="Add 1 minute"
                      type="button"
                    >
                      +1m
                    </button>
                    <button
                      className="px-1.5 py-1 rounded-lg bg-surface-container hover:bg-secondary-fixed/40 text-on-surface hover:text-on-secondary-fixed font-label-sm text-[11px] font-bold transition-all cursor-pointer"
                      onClick={() => addTimerMinutes(3)}
                      title="Add 3 minutes"
                      type="button"
                    >
                      +3m
                    </button>
                    <button
                      className="px-1.5 py-1 rounded-lg bg-surface-container hover:bg-secondary-fixed/40 text-on-surface hover:text-on-secondary-fixed font-label-sm text-[11px] font-bold transition-all cursor-pointer"
                      onClick={() => addTimerMinutes(5)}
                      title="Add 5 minutes"
                      type="button"
                    >
                      +5m
                    </button>
                  </div>
                </div>
              </div>

              {/* Right: Actions */}
              <div className="flex items-center gap-space-md shrink-0">
                {/* New Board button (for Host) */}
                {isHost && (
                  <button
                    type="button"
                    onClick={() => {
                      setNewBoardTitle('')
                      setNewBoardColumns(DEFAULT_COLUMN_TITLES)
                      setModal('new-board')
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-surface-container hover:bg-surface-container-high border border-outline-variant/40 text-on-surface font-label-md text-label-md transition-all shadow-sm cursor-pointer"
                    title="Start a new retrospective board"
                  >
                    <span className="material-symbols-outlined text-[18px] text-primary">add_circle</span>
                    <span className="hidden sm:inline">New board</span>
                  </button>
                )}

                {/* Invite P2P button */}
                <button
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-primary text-on-primary hover:opacity-95 font-label-md text-label-md transition-all shadow-sm cursor-pointer group"
                  title="Invite collaborators via Direct Peer-to-Peer link"
                  type="button"
                  onClick={() => void copyInviteDirect()}
                >
                  <span className="material-symbols-outlined text-[18px]">link</span>
                  <span>Invite P2P</span>
                  <span className="px-1.5 py-0.2 rounded bg-white/20 text-on-primary font-label-sm text-[10px] font-bold uppercase tracking-wider">P2P</span>
                </button>
              </div>
            </div>
          </header>

      {/* ======================================================== */}
      {/* MAIN RETRO BOARD */}
      {/* ======================================================== */}
      <main className="w-full bg-background flex-1 pt-20">
        {waitingForSharedBoard && (
          <div className="w-full bg-primary/10 border-b border-primary/20 px-margin py-2 text-center text-xs font-semibold text-primary flex items-center justify-center gap-2">
            <span className="w-2 h-2 rounded-full bg-primary animate-ping" />
            <span>Connecting to host board over P2P mesh… Please wait while snapshot arrives.</span>
            {peerState === 'failed' && (
              <button
                type="button"
                className="ml-2 underline font-bold cursor-pointer"
                onClick={() => void connectAsGuest(joinPeerId, participantName)}
              >
                Try again
              </button>
            )}
          </div>
        )}
        <div className="flex flex-col w-full">
          <div className="w-full px-margin pt-4 flex flex-col gap-space-lg max-w-[1920px] mx-auto pb-6">
            {/* TOP FACILITATION / PROMPT BANNER */}
            <section className="w-full rounded-2xl bg-surface-container-lowest border border-outline-variant/30 shadow-sm p-4 lg:p-5 flex flex-col xl:flex-row items-stretch xl:items-center justify-between gap-4 relative overflow-hidden">
              {/* Ambient decorative gradient pulse */}
              <div className="absolute -right-20 -top-20 w-72 h-72 bg-gradient-to-br from-primary/10 via-secondary/5 to-transparent rounded-full blur-3xl pointer-events-none"></div>

              {/* Left: Retrospective focus & owner status */}
              <div className="flex items-start sm:items-center gap-3.5 z-10 flex-1 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-primary-fixed flex items-center justify-center text-primary shrink-0 shadow-sm">
                  <span className="material-symbols-outlined text-[22px]">lightbulb</span>
                </div>
                <div className="flex flex-col min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-headline-sm text-headline-sm text-on-surface font-semibold">{board.title} Focus</span>
                    {isHost ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 font-label-sm text-label-sm font-semibold">
                        <span className="material-symbols-outlined text-[14px]">shield_person</span>
                        <span>Board Owner</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-surface-container-high text-on-surface-variant border border-outline-variant/40 font-label-sm text-label-sm font-medium">
                        <span className="material-symbols-outlined text-[14px]">person</span>
                        <span>Participant</span>
                      </span>
                    )}
                  </div>
                  <p className="font-body-md text-body-md text-on-surface-variant truncate lg:whitespace-normal">
                    Reflecting on {board.title} — What accelerated us? What slowed us down? Let's stay constructive, curious, and candid.
                  </p>
                </div>
              </div>

              {/* Right: Facilitation Controls */}
              <div className="flex flex-wrap items-center gap-3 z-10 shrink-0">
                {/* Team Presence Avatars & Connected counter */}
                <div className="inline-flex items-center gap-2.5 px-3 py-1.5 rounded-2xl bg-surface-container border border-outline-variant/40 shadow-sm">
                  <div className="flex items-center -space-x-2">
                    {/* User avatar */}
                    <div
                      className="relative group cursor-pointer"
                      title={`${participantName || 'You'} (${isHost ? 'Board Owner' : 'Participant'})`}
                      onClick={openSettings}
                    >
                      <div className="w-8 h-8 rounded-full bg-primary-fixed text-on-primary-fixed ring-2 ring-surface flex items-center justify-center font-label-sm text-label-sm font-bold shadow-sm transition-transform hover:scale-105 z-10">
                        {initials(participantName || 'You')}
                      </div>
                      <span className="absolute bottom-0 right-0 w-2 h-2 rounded-full bg-secondary ring-1 ring-surface"></span>
                    </div>

                    {/* Connected peers */}
                    {Object.entries(participants).slice(0, 5).map(([pId, pName]) => (
                      <div key={pId} className="relative group cursor-pointer" title={pName}>
                        <div className={`w-8 h-8 rounded-full ${getAuthorAvatarClass(pName)} ring-2 ring-surface flex items-center justify-center font-label-sm text-label-sm font-bold shadow-sm transition-transform hover:scale-105 z-10`}>
                          {initials(pName)}
                        </div>
                        <span className="absolute bottom-0 right-0 w-2 h-2 rounded-full bg-secondary ring-1 ring-surface"></span>
                      </div>
                    ))}
                  </div>

                  {/* Connected counter badge */}
                  <button
                    type="button"
                    onClick={setConnectionOpen}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-surface-container-highest/60 hover:bg-surface-container-high border border-outline-variant/40 text-on-surface font-label-sm text-label-sm font-semibold transition-colors shadow-sm cursor-pointer"
                    title={peerState === 'connected' ? `${peerCount + 1} team members connected via P2P mesh` : 'Connection details'}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${peerState === 'connected' ? 'bg-secondary animate-pulse' : peerState === 'ready' ? 'bg-primary' : 'bg-outline'}`}></span>
                    <span>{peerCount > 0 ? `+${peerCount} joined` : isHost ? 'Invite ready' : 'Solo'}</span>
                    <span className="text-outline font-normal text-[11px]">({peerCount + 1} live)</span>
                  </button>
                </div>

                {/* Incognito toggle badge */}
                <button
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-surface-container-low hover:bg-surface-container text-on-surface-variant transition-colors group cursor-pointer text-left"
                  type="button"
                  onClick={() => setAnonymous(!anonymous)}
                  title={anonymous ? 'Click to show name on notes' : 'Click to post anonymously'}
                >
                  <div className="w-6 h-6 rounded-full bg-surface-container-high flex items-center justify-center text-outline group-hover:text-primary transition-colors">
                    <span className="material-symbols-outlined text-[16px]">{anonymous ? 'visibility_off' : 'visibility'}</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="font-label-sm text-label-sm text-outline">Posting identity</span>
                    <span className="font-label-md text-label-md text-on-surface font-medium">
                      {anonymous ? (
                        <>Anonymous <span className="text-secondary font-medium">(Ghost Mode)</span></>
                      ) : (
                        <>{participantName || 'Anonymous'} <span className="text-outline font-normal">({isHost ? 'Owner' : 'Participant'})</span></>
                      )}
                    </span>
                  </div>
                </button>
              </div>
            </section>

            {/* RETRO BOARD 4-COLUMN HORIZONTAL CANVAS */}
            <div className="w-full overflow-x-auto pb-4 pt-1 snap-x no-scrollbar">
              <div
                className="grid w-full grid-flow-col auto-cols-fr gap-gutter"
                style={{
                  minWidth: `max(100%, ${board.columns.length * 320 + (board.columns.length - 1) * 20}px)`,
                }}
              >
                {ensureActionItemsAtLast(board.columns).map((column, colIndex) => {
                  const meta = getColumnMeta(column.title, colIndex)
                  const columnNotes = board.notes
                    .filter((n) => n.columnId === column.id)
                    .sort((a, b) => (sortByVotes[column.id] ? b.votes - a.votes : a.createdAt - b.createdAt))

                  return (
                    <div
                      key={column.id}
                      className="flex flex-col rounded-2xl bg-surface-container-low/70 p-3.5 gap-3.5 relative transition-all group"
                      id={column.id}
                    >
                      {/* Accent strip */}
                      <div className={`h-1.5 w-full rounded-full bg-gradient-to-r ${meta.gradient}`} />

                      {/* Column Header */}
                      <div className="flex items-center justify-between px-1.5">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="text-xl shrink-0">{meta.emoji}</span>
                          <div className="flex flex-col min-w-0">
                            <div className="flex items-center gap-2">
                              <h2 className="font-headline-md text-headline-md text-on-surface tracking-tight truncate">
                                {column.title}
                              </h2>
                              <span className={`px-2 py-0.5 rounded-full ${meta.countBadge} font-label-sm text-label-sm font-bold shrink-0`}>
                                {columnNotes.length}
                              </span>
                            </div>
                            <span className="font-label-sm text-label-sm text-outline truncate">{meta.subtitle}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {meta.emoji === '✨' && (
                            <button
                              className="w-8 h-8 rounded-lg bg-surface-container hover:bg-surface-container-high text-primary flex items-center justify-center transition-transform active:scale-90 cursor-pointer"
                              onClick={triggerConfetti}
                              title="Trigger Team Confetti!"
                              type="button"
                            >
                              <span className="material-symbols-outlined text-[18px]">celebration</span>
                            </button>
                          )}
                          <button
                            className={`w-8 h-8 rounded-lg flex items-center justify-center text-outline hover:text-on-surface hover:bg-surface-container transition-colors cursor-pointer ${
                              sortByVotes[column.id] ? 'text-primary bg-surface-container' : ''
                            }`}
                            title={sortByVotes[column.id] ? 'Sorted by votes' : 'Sort by votes'}
                            type="button"
                            onClick={() => setSortByVotes((prev) => ({ ...prev, [column.id]: !prev[column.id] }))}
                          >
                            <span className="material-symbols-outlined text-[18px]">swap_vert</span>
                          </button>
                          <button
                            className="w-8 h-8 rounded-lg bg-surface-container-high/80 hover:bg-surface-container-highest text-on-surface flex items-center justify-center transition-colors cursor-pointer"
                            onClick={() => focusComposer(column.id)}
                            title="Add note"
                            type="button"
                          >
                            <span className="material-symbols-outlined text-[20px]">add</span>
                          </button>
                        </div>
                      </div>

                      {/* Fast Inline Composer */}
                      <form
                        onSubmit={(e) => addInlineNote(e, column.id)}
                        className="rounded-xl bg-surface-container-lowest p-3 shadow-sm hover:shadow-md transition-shadow"
                      >
                        <textarea
                          className="w-full bg-transparent resize-none border-none focus:outline-none font-body-md text-body-md text-on-surface placeholder:text-outline"
                          value={inlineDrafts[column.id] ?? ''}
                          onChange={(e) => setInlineDrafts((prev) => ({ ...prev, [column.id]: e.target.value }))}
                          placeholder={meta.placeholder}
                          rows={2}
                        />
                        <div className="flex items-center justify-between pt-2 mt-1">
                          <span className="flex items-center text-outline select-none" title="Markdown supported: **bold**, *italic*, `code`, - list, > quote, [link](url)">
                            <svg aria-label="Markdown" role="img" className="h-3.5 w-3.5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" fill="currentColor">
                              <path d="M593.8 123.1L46.2 123.1C20.7 123.1 0 143.8 0 169.2L0 470.7C0 496.2 20.7 516.9 46.2 516.9L593.9 516.9C619.4 516.9 640.1 496.2 640 470.8L640 169.2C640 143.8 619.3 123.1 593.8 123.1zM338.5 424.6L277 424.6L277 304.6L215.5 381.5L154 304.6L154 424.6L92.3 424.6L92.3 215.4L153.8 215.4L215.3 292.3L276.8 215.4L338.3 215.4L338.3 424.6L338.5 424.6zM473.8 427.7L381.5 320L443 320L443 215.4L504.5 215.4L504.5 320L566 320L473.8 427.7z" />
                            </svg>
                          </span>
                          <button
                            className={`inline-flex items-center gap-1 px-3 py-1 rounded-lg ${meta.buttonBg} hover:opacity-90 font-label-md text-label-md shadow-sm transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed`}
                            type="submit"
                            disabled={!inlineDrafts[column.id]?.trim()}
                          >
                            <span>Post</span>
                            <span className="material-symbols-outlined text-[16px]">arrow_upward</span>
                          </button>
                        </div>
                      </form>

                      {/* Cards Container */}
                      <div className="flex flex-col gap-3">
                        {columnNotes.map((note) => {
                          const hasVoted = note.voteIds.includes(reactionActorId)
                          return (
                            <div
                              key={note.id}
                              className="group/card rounded-xl bg-surface-container-lowest p-4 shadow-sm hover:shadow-md transition-all relative flex flex-col gap-3"
                            >
                              {/* Author Meta Row */}
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2 min-w-0">
                                  <div className={`w-6 h-6 rounded-full ${getAuthorAvatarClass(note.author)} flex items-center justify-center font-label-sm text-label-sm font-bold shrink-0`}>
                                    {initials(note.author)}
                                  </div>
                                  <span className="font-label-md text-label-md text-on-surface font-medium truncate">{note.author}</span>
                                  <span className="text-outline text-[12px] shrink-0">• {relativeTime(note.createdAt, timerNow)}</span>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => deleteNote(note.id)}
                                  className="text-outline hover:text-error opacity-0 group-hover/card:opacity-100 transition-opacity p-1 rounded hover:bg-error-container/20 cursor-pointer"
                                  title="Delete note"
                                >
                                  <span className="material-symbols-outlined text-[16px]">delete</span>
                                </button>
                              </div>

                              {/* Body with Markdown rendering */}
                              <div className="font-body-md text-body-md text-on-surface leading-relaxed break-words">
                                <MarkdownView content={note.text} />
                              </div>

                              {/* Footer / Reactions & Comments */}
                              <div className="flex items-center justify-between pt-1 flex-wrap gap-2">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  {/* Upvote button */}
                                  <button
                                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-label-md text-label-md hover:scale-105 active:scale-95 transition-transform cursor-pointer ${
                                      hasVoted
                                        ? 'bg-primary text-on-primary'
                                        : note.votes >= 10
                                        ? 'bg-secondary-fixed/40 text-on-secondary-fixed'
                                        : 'bg-surface-container hover:bg-secondary-fixed/40 text-on-surface-variant hover:text-on-secondary-fixed'
                                    }`}
                                    onClick={() => toggleVote(note.id)}
                                    type="button"
                                    title={hasVoted ? 'Remove upvote' : 'Upvote'}
                                  >
                                    <span className="material-symbols-outlined text-[16px]">thumb_up</span>
                                    <span className="vote-count font-bold">{note.votes}</span>
                                  </button>

                                  {/* Add reaction trigger - always beside the upvote button */}
                                  <div className="relative reaction-picker-container">
                                    <button
                                      type="button"
                                      className={`p-1 rounded-full hover:bg-surface-container transition-colors cursor-pointer flex items-center justify-center ${
                                        reactionPickerNoteId === note.id ? 'text-primary bg-surface-container' : 'text-outline hover:text-on-surface'
                                      }`}
                                      title="Add reaction"
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        setReactionPickerNoteId((prev) => (prev === note.id ? '' : note.id))
                                      }}
                                    >
                                      <span className="material-symbols-outlined text-[16px]">add_reaction</span>
                                    </button>

                                    {reactionPickerNoteId === note.id && (
                                      <ReactionPickerPopover
                                        noteId={note.id}
                                        reactions={note.reactions}
                                        currentActorId={reactionActorId}
                                        onToggleReaction={toggleReaction}
                                        onClose={() => setReactionPickerNoteId('')}
                                        align="left"
                                      />
                                    )}
                                  </div>

                                  {/* Reaction badges displayed after the emoji button */}
                                  {Object.entries(note.reactions).map(([emoji, actors]) => {
                                    if (actors.length === 0) return null
                                    const active = actors.includes(reactionActorId)
                                    return (
                                      <button
                                        key={emoji}
                                        type="button"
                                        onClick={() => toggleReaction(note.id, emoji)}
                                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-label-sm text-label-sm cursor-pointer transition-colors ${
                                          active
                                            ? 'bg-secondary-fixed text-on-secondary-fixed font-bold'
                                            : 'bg-surface-container hover:bg-surface-container-high text-on-surface-variant'
                                        }`}
                                        title={`${emoji} reaction (${actors.length})`}
                                      >
                                        <span>{emoji}</span>
                                        <span>{actors.length}</span>
                                      </button>
                                    )
                                  })}
                                </div>

                                {/* Comments trigger */}
                                <button
                                  type="button"
                                  className="inline-flex items-center gap-1 text-outline hover:text-primary font-label-sm text-label-sm transition-colors cursor-pointer ml-auto"
                                  onClick={() => setExpandedComments((prev) => ({ ...prev, [note.id]: !prev[note.id] }))}
                                  title={note.comments.length > 0 ? `${note.comments.length} comments` : 'Add comment'}
                                >
                                  <span className="material-symbols-outlined text-[16px]">mode_comment</span>
                                  <span>{note.comments.length > 0 ? note.comments.length : 'Reply'}</span>
                                </button>
                              </div>

                              {/* Expandable comments thread */}
                              {expandedComments[note.id] && (
                                <div className="flex flex-col gap-2 pt-2 border-t border-outline-variant/30">
                                  {note.comments.map((comment) => (
                                    <div key={comment.id} className="flex flex-col gap-1 rounded-lg bg-surface-container-low p-2.5 text-body-sm font-body-sm group/comment">
                                      <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-1.5">
                                          <div className={`w-5 h-5 rounded-full ${getAuthorAvatarClass(comment.author)} flex items-center justify-center text-[10px] font-bold`}>
                                            {initials(comment.author)}
                                          </div>
                                          <span className="font-label-sm text-label-sm text-on-surface font-semibold">{comment.author}</span>
                                          <span className="text-[11px] text-outline">• {relativeTime(comment.createdAt, timerNow)}</span>
                                        </div>
                                        <button
                                          type="button"
                                          onClick={() => deleteComment(note.id, comment.id)}
                                          className="text-outline hover:text-error opacity-0 group-hover/comment:opacity-100 transition-opacity p-0.5 rounded cursor-pointer"
                                          title="Delete comment"
                                        >
                                          <span className="material-symbols-outlined text-[14px]">delete</span>
                                        </button>
                                      </div>
                                      <div className="text-on-surface pl-6 leading-relaxed break-words text-body-sm">
                                        <MarkdownView content={comment.text} />
                                      </div>
                                    </div>
                                  ))}

                                  {/* Comment Composer */}
                                  <form className="flex items-center gap-2 pt-1" onSubmit={(e) => addComment(e, note.id)}>
                                    <div className={`w-6 h-6 rounded-full ${getAuthorAvatarClass(participantName || 'You')} flex items-center justify-center font-label-sm text-label-sm font-bold shrink-0`}>
                                      {initials(participantName || 'You')}
                                    </div>
                                    <div className="flex-1 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-container border border-outline-variant/40 focus-within:ring-2 focus-within:ring-primary">
                                      <input
                                        type="text"
                                        placeholder="Reply or add a suggestion..."
                                        value={commentDrafts[note.id] ?? ''}
                                        onChange={(e) => setCommentDrafts((prev) => ({ ...prev, [note.id]: e.target.value }))}
                                        className="w-full bg-transparent border-none focus:outline-none text-body-sm font-body-sm text-on-surface placeholder:text-outline"
                                      />
                                      <button
                                        type="submit"
                                        disabled={!commentDrafts[note.id]?.trim()}
                                        className="px-2 py-0.5 rounded bg-primary text-on-primary font-label-sm text-label-sm font-medium hover:opacity-90 transition-opacity shrink-0 disabled:opacity-50 cursor-pointer"
                                      >
                                        Reply
                                      </button>
                                    </div>
                                  </form>
                                </div>
                              )}
                            </div>
                          )
                        })}

                        {/* Empty column placeholder */}
                        {columnNotes.length === 0 && (
                          <div className="rounded-xl border border-dashed border-outline-variant/50 p-6 flex flex-col items-center justify-center text-center text-outline">
                            <span className="text-2xl mb-1.5 opacity-60">{meta.emoji}</span>
                            <p className="font-body-sm text-body-sm font-medium">No notes yet</p>
                            <p className="text-[12px] text-outline/80 mt-0.5">Be the first to share a thought!</p>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      </main>
      </>
      )}

      {/* ======================================================== */}
      {/* FLOATING TOAST NOTIFICATION */}
      {/* ======================================================== */}
      {notice && (
        <div className="fixed top-24 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full bg-secondary text-on-secondary font-headline-sm text-headline-sm shadow-xl flex items-center gap-2 animate-bounce">
          <span className="material-symbols-outlined text-[18px]">celebration</span>
          <span>{notice}</span>
        </div>
      )}

      {/* ======================================================== */}
      {/* MODALS */}
      {/* ======================================================== */}
      {modal && (
        <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setModal(null) }}>
          {/* Guest Name Modal */}
          {modal === 'guest-name' && (
            <section className="modal" role="dialog" aria-modal="true">
              <div className="modal-topline">
                <span className="modal-icon"><span className="material-symbols-outlined">person</span></span>
                <button className="modal-close" onClick={() => setModal(null)}><span className="material-symbols-outlined">close</span></button>
              </div>
              <h2>What should we call you?</h2>
              <p className="modal-description">Enter your name to join the retrospective and collaborate live with your team.</p>
              <form onSubmit={(e) => void confirmGuestName(e)}>
                <label className="field-label" htmlFor="guest-display-name">Your name</label>
                <input
                  id="guest-display-name"
                  className="text-field"
                  value={guestName}
                  onChange={(e) => setGuestName(e.target.value)}
                  placeholder="e.g. Alex Rivera"
                  maxLength={32}
                  autoFocus
                  required
                />
                <div className="modal-actions">
                  <button type="button" className="btn-secondary" onClick={() => setModal(null)}>Cancel</button>
                  <button type="submit" className="btn-primary" disabled={!guestName.trim()}>
                    <span className="material-symbols-outlined text-[16px]">login</span>
                    <span>Join retro</span>
                  </button>
                </div>
              </form>
            </section>
          )}

          {/* Start New Board Modal */}
          {modal === 'new-board' && (
            <section className="modal" role="dialog" aria-modal="true">
              <div className="modal-topline">
                <span className="modal-icon"><span className="material-symbols-outlined">auto_awesome</span></span>
                <button className="modal-close" onClick={() => setModal(null)}><span className="material-symbols-outlined">close</span></button>
              </div>
              <h2>Start a new retro</h2>
              <p className="modal-description">Set up your board and invite the team with a direct P2P link.</p>
              <form onSubmit={(e) => void createBoard(e)}>
                <label className="field-label" htmlFor="new-modal-board-name">Board name</label>
                <input
                  id="new-modal-board-name"
                  className="text-field"
                  value={newBoardTitle}
                  onChange={(e) => setNewBoardTitle(e.target.value)}
                  placeholder="e.g. Sprint 43 Retrospective"
                  maxLength={60}
                  required
                  autoFocus
                />
                <label className="field-label" htmlFor="new-modal-owner-name">Your name</label>
                <input
                  id="new-modal-owner-name"
                  className="text-field"
                  value={participantName}
                  onChange={(e) => setParticipantName(e.target.value)}
                  placeholder="How should your team identify you?"
                  maxLength={32}
                  required
                />
                <div className="flex items-center justify-between mt-3 mb-1.5">
                  <span className="field-label !m-0">Columns</span>
                  <span className="text-xs text-outline">{newBoardColumns.length} of 5</span>
                </div>
                <div className="flex flex-col gap-2">
                  {newBoardColumns.map((col, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <span className={`w-3 h-3 rounded-full shrink-0 ${['bg-emerald-400', 'bg-amber-400', 'bg-purple-400', 'bg-blue-400', 'bg-yellow-400'][idx % 5]}`} />
                      <input
                        className="text-field !py-1.5 text-xs"
                        value={col}
                        onChange={(e) => updateNewBoardColumn(idx, e.target.value)}
                        placeholder={`Column ${idx + 1}`}
                        maxLength={28}
                        required
                      />
                      <button
                        type="button"
                        className="w-7 h-7 flex items-center justify-center text-outline hover:text-error disabled:opacity-30"
                        onClick={() => removeNewBoardColumn(idx)}
                        disabled={newBoardColumns.length <= 2}
                      >
                        <span className="material-symbols-outlined text-[16px]">delete</span>
                      </button>
                    </div>
                  ))}
                </div>
                {newBoardColumns.length < 5 && (
                  <button type="button" onClick={addNewBoardColumn} className="mt-2 text-xs font-semibold text-primary inline-flex items-center gap-1">
                    <span className="material-symbols-outlined text-[14px]">add</span> Add column
                  </button>
                )}
                <div className="modal-actions">
                  <button type="button" className="btn-secondary" onClick={() => setModal(null)}>Cancel</button>
                  <button type="submit" className="btn-primary" disabled={!newBoardTitle.trim() || !participantName.trim() || newBoardColumns.some((c) => !c.trim())}>
                    <span className="material-symbols-outlined text-[16px]">add_circle</span>
                    <span>Create board</span>
                  </button>
                </div>
              </form>
            </section>
          )}

          {/* Settings Modal */}
          {modal === 'settings' && (
            <section className="modal" role="dialog" aria-modal="true">
              <div className="modal-topline">
                <span className="modal-icon"><span className="material-symbols-outlined">settings</span></span>
                <button className="modal-close" onClick={() => setModal(null)}><span className="material-symbols-outlined">close</span></button>
              </div>
              <h2>Board & Profile Settings</h2>
              <p className="modal-description">Customize your board details and personal identity.</p>

              <label className="field-label" htmlFor="board-title-input">Retrospective title</label>
              <input
                id="board-title-input"
                className="text-field"
                value={editBoardTitle}
                onChange={(e) => setEditBoardTitle(e.target.value)}
                maxLength={60}
              />

              <label className="field-label" htmlFor="profile-name-input">Your name</label>
              <input
                id="profile-name-input"
                className="text-field"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                maxLength={32}
              />

              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setModal(null)}>Cancel</button>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => {
                    if (editName.trim()) {
                      setParticipantName(editName.trim())
                      localStorage.setItem('together-retro-name', editName.trim())
                    }
                    if (editBoardTitle.trim()) {
                      setBoard((prev) => ({ ...prev, title: editBoardTitle.trim() }))
                    }
                    setModal(null)
                    toast('Preferences saved.')
                  }}
                >
                  Save changes
                </button>
              </div>
            </section>
          )}

          {/* Connect / Invite P2P Modal */}
          {modal === 'connect' && (
            <section className="modal" role="dialog" aria-modal="true">
              <div className="modal-topline">
                <span className="modal-icon"><span className="material-symbols-outlined">groups</span></span>
                <button className="modal-close" onClick={() => setModal(null)}><span className="material-symbols-outlined">close</span></button>
              </div>
              <h2>Bring Your Team In</h2>
              <p className="modal-description">
                Direct peer-to-peer connection. Anyone with this link can join this retrospective live without an account.
              </p>

              <div className="flex rounded-xl bg-surface-container-low p-1 border border-outline-variant/30 mb-3">
                <button
                  type="button"
                  className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all ${peerRole === 'host' ? 'bg-surface shadow-sm text-primary font-bold' : 'text-on-surface-variant hover:text-on-surface'}`}
                  onClick={() => {
                    setPeerRole('host')
                    setSignalStep('offer')
                  }}
                >
                  I'm hosting
                </button>
                <button
                  type="button"
                  className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all ${peerRole === 'guest' ? 'bg-surface shadow-sm text-primary font-bold' : 'text-on-surface-variant hover:text-on-surface'}`}
                  onClick={() => {
                    setPeerRole('guest')
                    setSignalStep('start')
                  }}
                >
                  I'm joining
                </button>
              </div>

              <div className="flex items-center gap-2 p-2.5 rounded-xl bg-surface-container border border-outline-variant/40 mb-3 text-xs">
                <span className={`w-2 h-2 rounded-full ${peerState === 'connected' ? 'bg-secondary animate-pulse' : peerState === 'ready' ? 'bg-primary' : peerState === 'connecting' ? 'bg-amber-500 animate-pulse' : 'bg-outline'}`} />
                <span className="font-semibold text-on-surface">
                  {peerState === 'connected' ? `Connected (${peerCount + 1} live)` : peerState === 'ready' ? (signalStep === 'offer' ? 'Room invite ready' : 'Ready') : peerState === 'connecting' ? 'Connecting to network…' : 'Solo mode'}
                </span>
              </div>

              {peerRole === 'host' ? (
                <>
                  <div className="p-3 rounded-xl bg-surface-container border border-outline-variant/40 flex flex-col gap-2 mb-4">
                    <span className="text-[11px] font-semibold text-outline uppercase tracking-wider">Shareable P2P Invite Link</span>
                    <div className="text-xs text-on-surface break-all font-mono bg-white/80 p-2 rounded-lg border border-outline-variant/30 select-all">
                      {window.location.origin}{window.location.pathname}?join={signalResult || ownerPeerId || stableHostPeerId(board.id)}&board={board.id}&setup={encodeURIComponent(JSON.stringify({ id: board.id, title: board.title, columns: board.columns.map(c => c.title) }))}
                    </div>
                  </div>

                  <div className="modal-actions">
                    {peerState === 'connected' && (
                      <button
                        type="button"
                        className="btn-secondary !text-error !border-error/30 hover:!bg-error-container/20"
                        onClick={() => {
                          resetConnection()
                          setSignalStep('start')
                          toast('Disconnected from P2P room.')
                        }}
                      >
                        Disconnect
                      </button>
                    )}
                    <button type="button" className="btn-secondary" onClick={() => setModal(null)}>Close</button>
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={() => void copyInviteDirect()}
                    >
                      <span className="material-symbols-outlined text-[16px]">content_copy</span>
                      <span>{inviteCopied ? 'Invite link copied' : 'Copy invite link'}</span>
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <form onSubmit={(e) => void joinRoom(e)} className="flex flex-col gap-3">
                    <label className="field-label !m-0" htmlFor="connect-input-peer">Room ID or invite link</label>
                    <input
                      id="connect-input-peer"
                      className="text-field"
                      value={signalText}
                      onChange={(e) => {
                        const input = e.target.value.trim()
                        try {
                          setSignalText(new URL(input).searchParams.get('join') ?? input)
                        } catch {
                          setSignalText(input)
                        }
                      }}
                      placeholder="Paste room ID or invite link…"
                      required
                    />
                    <div className="modal-actions">
                      {peerState === 'connected' && (
                        <button
                          type="button"
                          className="btn-secondary !text-error !border-error/30 hover:!bg-error-container/20"
                          onClick={() => {
                            resetConnection()
                            setSignalStep('start')
                            toast('Disconnected from P2P room.')
                          }}
                        >
                          Disconnect
                        </button>
                      )}
                      <button type="button" className="btn-secondary" onClick={() => setModal(null)}>Close</button>
                      <button type="submit" className="btn-primary" disabled={peerState === 'connecting'}>
                        <span className="material-symbols-outlined text-[16px]">login</span>
                        <span>{peerState === 'connecting' ? 'Connecting…' : 'Join room'}</span>
                      </button>
                    </div>
                  </form>
                </>
              )}
            </section>
          )}
        </div>
      )}
    </div>
  )
}

export default App
