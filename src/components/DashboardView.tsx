import { useMemo, useRef, useState } from 'react'
import type { RetroBoard } from '../lib/retroBoardSync'
import togetherLogo from '../assets/together-logo.png'

interface DashboardViewProps {
  boards: RetroBoard[]
  participantName: string
  onOpenBoard: (boardId: string) => void
  onCreateBoardClick: () => void
  onJoinBoard: (codeOrUrl: string) => void
  onToggleStar: (boardId: string) => void
  onOpenSettings: () => void
  onImportBoards: (data: unknown) => { imported: number; skipped: number; error?: string }
  darkMode: boolean
  onToggleDarkMode: () => void
}

type FilterTab = 'all' | 'active' | 'completed' | 'starred'
type SortOption = 'recent' | 'name' | 'thoughts' | 'oldest'

function formatBoardDate(timestamp: number): string {
  if (!timestamp) return 'Recently'
  const date = new Date(timestamp)
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function DashboardView({
  boards,
  participantName,
  onOpenBoard,
  onCreateBoardClick,
  onJoinBoard,
  onToggleStar,
  onOpenSettings,
  onImportBoards,
  darkMode,
  onToggleDarkMode,
}: DashboardViewProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [filterTab, setFilterTab] = useState<FilterTab>('all')
  const [sortBy, setSortBy] = useState<SortOption>('recent')
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(6)
  const [joinInput, setJoinInput] = useState('')
  const [showHelpModal, setShowHelpModal] = useState(false)
  const [summaryBoard, setSummaryBoard] = useState<RetroBoard | null>(null)
  const [importMessage, setImportMessage] = useState('')
  const importInputRef = useRef<HTMLInputElement>(null)

  // Counts for filter pills
  const counts = useMemo(() => {
    let active = 0
    let completed = 0
    let starred = 0
    for (const b of boards) {
      const isAct = !b.locked && b.status !== 'completed'
      if (isAct) active++
      else completed++
      if (b.starred) starred++
    }
    return {
      all: boards.length,
      active,
      completed,
      starred,
    }
  }, [boards])

  // Filtered & Sorted Boards
  const filteredBoards = useMemo(() => {
    let result = boards.filter((b) => {
      // Tab filter
      const isAct = !b.locked && b.status !== 'completed'
      if (filterTab === 'active' && !isAct) return false
      if (filterTab === 'completed' && isAct) return false
      if (filterTab === 'starred' && !b.starred) return false

      // Search filter
      if (searchQuery.trim()) {
        const query = searchQuery.trim().toLowerCase()
        const matchTitle = b.title.toLowerCase().includes(query)
        const matchTag = (b.frameworkTag || '').toLowerCase().includes(query)
        const matchCol = b.columns.some((c) => c.title.toLowerCase().includes(query))
        if (!matchTitle && !matchTag && !matchCol) return false
      }
      return true
    })

    // Sort
    result = [...result].sort((a, b) => {
      if (sortBy === 'name') return a.title.localeCompare(b.title)
      if (sortBy === 'thoughts') return (b.notes?.length || 0) - (a.notes?.length || 0)
      if (sortBy === 'oldest') return (a.updatedAt || 0) - (b.updatedAt || 0)
      // default: recent
      return (b.updatedAt || 0) - (a.updatedAt || 0)
    })

    return result
  }, [boards, filterTab, searchQuery, sortBy])

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filteredBoards.length / pageSize))
  const safePage = Math.min(currentPage, totalPages)
  const startIndex = (safePage - 1) * pageSize
  const endIndex = Math.min(startIndex + pageSize, filteredBoards.length)
  const pageBoards = filteredBoards.slice(startIndex, endIndex)

  const handleJoinSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!joinInput.trim()) return
    onJoinBoard(joinInput.trim())
  }

  const exportBoards = () => {
    const json = JSON.stringify(boards, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const downloadUrl = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = downloadUrl
    link.download = `together-retro-boards-${new Date().toISOString().slice(0, 10)}.json`
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 0)
  }

  const importBoards = async (file: File) => {
    setImportMessage('')
    try {
      const content = await file.text()
      const result = onImportBoards(JSON.parse(content) as unknown)
      setImportMessage(result.error ?? `Imported ${result.imported} board${result.imported === 1 ? '' : 's'}; skipped ${result.skipped} duplicate${result.skipped === 1 ? '' : 's'}.`)
    } catch (error) {
      setImportMessage(error instanceof Error ? `Could not import boards: ${error.message}` : 'Could not read the selected JSON file.')
    } finally {
      if (importInputRef.current) importInputRef.current.value = ''
    }
  }

  return (
    <div className="bg-background font-body-md text-on-surface antialiased min-h-screen flex flex-col justify-between">
      {/* HEADER */}
      <header className="sticky top-0 inset-x-0 z-50 bg-surface/90 backdrop-blur-md border-b border-outline-variant/30 shadow-sm">
        <div className="h-16 max-w-7xl mx-auto px-gutter flex items-center justify-between gap-space-md">
          <div className="flex items-center gap-6 lg:gap-8">
            <button
              onClick={() => {
                setFilterTab('all')
                setSearchQuery('')
                setCurrentPage(1)
              }}
              className="flex items-center text-primary group select-none text-left"
              data-path="dashboard-boards"
              type="button"
            >
              <span className="brand-logo-frame inline-flex">
                <img
                  alt="Together Retro Logo"
                  className="h-9 sm:h-10 w-auto object-contain group-hover:scale-105 transition-transform"
                  src={togetherLogo}
                />
              </span>
            </button>
            <nav className="hidden md:flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setFilterTab('all')
                  setSearchQuery('')
                  setCurrentPage(1)
                }}
                className="px-3.5 py-1.5 font-label-md text-label-md rounded-lg bg-surface-container-high text-on-surface font-semibold shadow-xs cursor-pointer"
                data-path="dashboard-boards"
              >
                Dashboard / Boards
              </button>
              <button
                type="button"
                onClick={() => setShowHelpModal(true)}
                className="px-3.5 py-1.5 font-label-md text-label-md rounded-lg text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface transition-colors cursor-pointer"
                data-path="help-p2p-guide"
              >
                Help &amp; P2P Guide
              </button>
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <input
              ref={importInputRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              aria-label="Import boards from JSON"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0]
                if (file) void importBoards(file)
              }}
            />
            <div className="hidden sm:flex items-center gap-2 bg-surface-container-low border border-outline-variant/40 px-3 py-1.5 rounded-full">
              <span className="w-2 h-2 rounded-full bg-secondary animate-pulse" />
              <span className="font-label-sm text-label-sm text-secondary font-semibold tracking-wide">
                Local-first workspace
              </span>
            </div>
            <button
              type="button"
              onClick={exportBoards}
              disabled={boards.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-surface-container hover:bg-surface-container-high text-on-surface font-label-sm text-label-sm transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              title={boards.length > 0 ? 'Export all boards as JSON' : 'No boards to export'}
            >
              <span className="material-symbols-outlined text-[18px]">download</span>
              <span className="hidden sm:inline">Export JSON</span>
            </button>
            <button
              type="button"
              onClick={() => importInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-surface-container hover:bg-surface-container-high text-on-surface font-label-sm text-label-sm transition-colors cursor-pointer"
              title="Import boards from JSON"
            >
              <span className="material-symbols-outlined text-[18px]">upload</span>
              <span className="hidden sm:inline">Import JSON</span>
            </button>
            <button
              type="button"
              onClick={onToggleDarkMode}
              aria-label={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
              aria-pressed={darkMode}
              title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
              className="w-9 h-9 rounded-xl bg-surface-container hover:bg-surface-container-high text-on-surface flex items-center justify-center transition-colors cursor-pointer"
            >
              <span className="material-symbols-outlined text-[18px]">{darkMode ? 'light_mode' : 'dark_mode'}</span>
            </button>
            <button
              onClick={onOpenSettings}
              className="w-9 h-9 rounded-full bg-primary text-on-primary flex items-center justify-center font-label-md text-label-md hover:bg-primary-container transition-colors shadow-sm cursor-pointer"
              title={participantName ? `Profile: ${participantName}` : 'Profile & Settings'}
              type="button"
            >
              <span className="material-symbols-outlined text-[18px]">person</span>
            </button>
          </div>
        </div>
      </header>

      {/* MAIN CONTAINER */}
      <main className="w-full flex-1 max-w-7xl mx-auto px-gutter py-6 lg:py-8">
        <div className="flex flex-col w-full gap-8">
          {importMessage && (
            <p role="status" className="rounded-lg bg-surface-container-low px-4 py-2 text-sm text-on-surface-variant">
              {importMessage}
            </p>
          )}
          {/* Top Greeting & Live Network Status Banner */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-outline-variant/20 pb-5">
            <div className="flex flex-col gap-1">
              <h1 className="font-headline-xl text-headline-xl text-on-surface font-bold">
                Welcome back, {participantName?.trim() || 'Alex'}
              </h1>
              <p className="font-body-md text-body-md text-on-surface-variant">
                Run fast, collaborative sprint retrospectives with your team in real time.
              </p>
            </div>
            <div className="flex items-center gap-2 text-on-surface-variant font-label-sm text-label-sm bg-surface-container-lowest px-3 py-1.5 rounded-full border border-outline-variant/30 self-start sm:self-auto shadow-xs">
              <span className="w-2 h-2 rounded-full bg-secondary" />
              <span className="font-medium">Peer-to-peer sync starts when you invite or join</span>
            </div>
          </div>

          {/* Quick Action Hub: 2 Primary Dynamic Action Blocks */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            {/* 1. Create Board Card */}
            <div className="lg:col-span-7 bg-surface-container-lowest rounded-xl p-6 border border-outline-variant/30 shadow-sm flex flex-col justify-between gap-6 hover:shadow-md transition-shadow">
              <div className="flex flex-col gap-4">
                <div>
                  <div className="flex items-center gap-2 text-primary font-label-sm text-label-sm uppercase tracking-wider mb-1 font-semibold">
                    <span className="material-symbols-outlined text-[16px]">dashboard_customize</span>
                    <span>Start Fresh</span>
                  </div>
                  <h2 className="font-headline-lg text-headline-lg text-on-surface font-bold">Create a New Retro</h2>
                  <p className="font-body-sm text-body-sm text-on-surface-variant mt-0.5">
                    Launch an instant, peer-to-peer retro board with your preferred framework.
                  </p>
                </div>
                <div className="flex items-center gap-2 text-on-surface-variant text-body-sm font-body-sm bg-surface-container-low px-3 py-2 rounded-lg border border-outline-variant/30">
                  <span className="material-symbols-outlined text-[18px] text-secondary">lock</span>
                  <span>Local-first, encrypted, and ready in seconds</span>
                </div>
              </div>
              <div className="pt-2">
                <button
                  id="create-board-btn"
                  onClick={() => onCreateBoardClick()}
                  className="w-full py-2.5 bg-primary text-on-primary font-headline-sm text-headline-sm rounded-lg shadow-sm hover:shadow hover:bg-primary-container transition-all flex items-center justify-center gap-2 cursor-pointer font-semibold"
                  type="button"
                >
                  <span className="material-symbols-outlined text-[20px]">add</span>
                  <span>Start New Board</span>
                </button>
              </div>
            </div>

            {/* 2. Join a Retro Card */}
            <div className="lg:col-span-5 bg-surface-container-lowest rounded-xl p-6 border border-outline-variant/30 shadow-sm flex flex-col justify-between gap-6 hover:shadow-md transition-shadow">
              <form onSubmit={handleJoinSubmit} className="flex flex-col justify-between gap-6 h-full">
                <div className="flex flex-col gap-4">
                  <div>
                    <div className="flex items-center gap-2 text-secondary font-label-sm text-label-sm uppercase tracking-wider mb-1 font-semibold">
                      <span className="material-symbols-outlined text-[16px]">group_add</span>
                      <span>Team Session</span>
                    </div>
                    <h2 className="font-headline-lg text-headline-lg text-on-surface font-bold">Join a Retro</h2>
                    <p className="font-body-sm text-body-sm text-on-surface-variant mt-0.5">
                      Enter an invite code or peer link to join an active board.
                    </p>
                  </div>
                  <div className="relative">
                    <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-on-surface-variant text-[18px]">
                      key
                    </span>
                    <input
                      id="room-code-input"
                      value={joinInput}
                      onChange={(e) => setJoinInput(e.target.value)}
                      className="w-full bg-surface-container-low text-on-surface placeholder:text-on-surface-variant/60 font-body-md text-body-md pl-10 pr-4 py-2.5 rounded-lg border border-outline-variant/40 focus:outline-none focus:border-primary focus:bg-surface-container-lowest transition-all"
                      placeholder="Paste room code or invite link..."
                      type="text"
                    />
                  </div>
                </div>
                <div className="pt-2">
                  <button
                    className="w-full py-2.5 bg-secondary text-on-secondary font-headline-sm text-headline-sm rounded-lg shadow-sm hover:shadow hover:bg-secondary/90 transition-all flex items-center justify-center gap-2 cursor-pointer font-semibold"
                    type="submit"
                  >
                    <span>Join Board</span>
                    <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
                  </button>
                </div>
              </form>
            </div>
          </div>

          {/* Recent Retrospectives Section */}
          <div className="flex flex-col gap-5">
            {/* Header with Board Count, Search, View Toggle, Filter & Sort Controls */}
            <div className="flex flex-col gap-4 bg-surface-container-lowest rounded-xl p-5 border border-outline-variant/30 shadow-sm">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2.5">
                    <h2 className="font-headline-lg text-headline-lg text-on-surface font-bold">Recent Retrospectives</h2>
                    <span className="px-2.5 py-0.5 rounded-full bg-surface-container font-label-sm text-label-sm text-on-surface-variant font-semibold">
                      {counts.all} boards
                    </span>
                  </div>
                  <p className="font-body-sm text-body-sm text-on-surface-variant mt-0.5">
                    Boards saved locally on this device • Synchronized via peer-to-peer
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2.5">
                  <div className="relative min-w-[220px] flex-1 sm:flex-initial">
                    <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-[17px]">
                      search
                    </span>
                    <input
                      value={searchQuery}
                      onChange={(e) => {
                        setSearchQuery(e.target.value)
                        setCurrentPage(1)
                      }}
                      className="w-full bg-surface-container-low text-on-surface placeholder:text-on-surface-variant/70 font-body-sm text-body-sm pl-9 pr-3 py-2 rounded-lg border border-outline-variant/40 focus:outline-none focus:border-primary focus:bg-surface-container-lowest transition-colors"
                      placeholder="Search boards or tags..."
                      type="text"
                    />
                  </div>
                  {/* View Mode Toggle */}
                  <div className="flex items-center bg-surface-container-low p-1 rounded-lg border border-outline-variant/40">
                    <button
                      onClick={() => setViewMode('grid')}
                      className={`p-1 rounded flex items-center justify-center transition-all cursor-pointer ${
                        viewMode === 'grid'
                          ? 'bg-surface-container-lowest text-primary shadow-xs'
                          : 'text-on-surface-variant hover:text-on-surface'
                      }`}
                      title="Grid View"
                      type="button"
                    >
                      <span className="material-symbols-outlined text-[18px]">grid_view</span>
                    </button>
                    <button
                      onClick={() => setViewMode('list')}
                      className={`p-1 rounded flex items-center justify-center transition-all cursor-pointer ${
                        viewMode === 'list'
                          ? 'bg-surface-container-lowest text-primary shadow-xs'
                          : 'text-on-surface-variant hover:text-on-surface'
                      }`}
                      title="List View"
                      type="button"
                    >
                      <span className="material-symbols-outlined text-[18px]">view_list</span>
                    </button>
                  </div>
                  {/* Sort Dropdown selector */}
                  <div className="flex items-center bg-surface-container-low px-2.5 py-1.5 rounded-lg border border-outline-variant/40 text-on-surface-variant font-label-sm text-label-sm gap-1.5">
                    <span className="material-symbols-outlined text-[16px]">sort</span>
                    <select
                      value={sortBy}
                      onChange={(e) => setSortBy(e.target.value as SortOption)}
                      className="bg-transparent text-on-surface font-label-sm text-label-sm focus:outline-none cursor-pointer pr-1"
                    >
                      <option value="recent">Sort: Most Recent</option>
                      <option value="name">Sort: Name (A-Z)</option>
                      <option value="thoughts">Sort: Most Thoughts</option>
                      <option value="oldest">Sort: Oldest</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Filter Tabs Bar */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-outline-variant/20">
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    onClick={() => {
                      setFilterTab('all')
                      setCurrentPage(1)
                    }}
                    className={`px-3 py-1 rounded-lg font-label-sm text-label-sm transition-all cursor-pointer ${
                      filterTab === 'all'
                        ? 'bg-primary text-on-primary font-semibold shadow-xs'
                        : 'bg-surface-container-low text-on-surface-variant hover:text-on-surface hover:bg-surface-container'
                    }`}
                    type="button"
                  >
                    All ({counts.all})
                  </button>
                  <button
                    onClick={() => {
                      setFilterTab('active')
                      setCurrentPage(1)
                    }}
                    className={`px-3 py-1 rounded-lg font-label-sm text-label-sm transition-all cursor-pointer ${
                      filterTab === 'active'
                        ? 'bg-primary text-on-primary font-semibold shadow-xs'
                        : 'bg-surface-container-low text-on-surface-variant hover:text-on-surface hover:bg-surface-container'
                    }`}
                    type="button"
                  >
                    Active ({counts.active})
                  </button>
                  <button
                    onClick={() => {
                      setFilterTab('completed')
                      setCurrentPage(1)
                    }}
                    className={`px-3 py-1 rounded-lg font-label-sm text-label-sm transition-all cursor-pointer ${
                      filterTab === 'completed'
                        ? 'bg-primary text-on-primary font-semibold shadow-xs'
                        : 'bg-surface-container-low text-on-surface-variant hover:text-on-surface hover:bg-surface-container'
                    }`}
                    type="button"
                  >
                    Completed ({counts.completed})
                  </button>
                  <button
                    onClick={() => {
                      setFilterTab('starred')
                      setCurrentPage(1)
                    }}
                    className={`px-3 py-1 rounded-lg font-label-sm text-label-sm transition-all cursor-pointer flex items-center gap-1 ${
                      filterTab === 'starred'
                        ? 'bg-primary text-on-primary font-semibold shadow-xs'
                        : 'bg-surface-container-low text-on-surface-variant hover:text-on-surface hover:bg-surface-container'
                    }`}
                    type="button"
                  >
                    <span
                      className="material-symbols-outlined text-[14px] text-tertiary-container"
                      style={{ fontVariationSettings: "'FILL' 1" }}
                    >
                      star
                    </span>
                    <span>Starred ({counts.starred})</span>
                  </button>
                </div>
                <div className="hidden sm:flex items-center gap-1.5 text-on-surface-variant font-body-sm text-body-sm">
                  <span className="material-symbols-outlined text-[16px]">filter_list</span>
                  <span>Showing {pageSize} active cards per page</span>
                </div>
              </div>
            </div>

            {/* Grid or List of Retrospective Cards */}
            {filteredBoards.length === 0 ? (
              <div className="bg-surface-container-lowest rounded-xl p-12 text-center border border-outline-variant/30 flex flex-col items-center justify-center gap-3">
                <span className="material-symbols-outlined text-4xl text-outline-variant">folder_off</span>
                <p className="font-headline-sm text-headline-sm text-on-surface">No retrospectives found</p>
                <p className="font-body-sm text-body-sm text-on-surface-variant">
                  Try adjusting your search query or filter tab.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('')
                    setFilterTab('all')
                  }}
                  className="mt-2 px-4 py-2 rounded-lg bg-surface-container text-on-surface font-label-md text-label-md hover:bg-surface-container-high transition-colors"
                >
                  Reset filters
                </button>
              </div>
            ) : viewMode === 'grid' ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                {pageBoards.map((item) => {
                  const isActive = !item.locked && item.status !== 'completed'
                  const totalThoughts = item.notes?.length || 0
                  const actionItems = item.notes?.filter((n) => {
                    const col = item.columns.find((c) => c.id === n.columnId)
                    return col?.title.toLowerCase().includes('action')
                  }).length || 0
                  const participants = item.participantCount ?? 0
                  const avatars = item.participantAvatars ?? []
                  const frameworkTag = item.frameworkTag || (
                    item.columns.some((c) => c.title.toLowerCase().includes('glad'))
                      ? 'Mad / Sad / Glad'
                      : item.columns.some((c) => c.title.toLowerCase().includes('stop'))
                      ? 'Start / Stop / Continue'
                      : item.columns.some((c) => c.title.toLowerCase().includes('liked'))
                      ? '4Ls Framework'
                      : 'Went Well / Better'
                  )

                  return (
                    <div
                      key={item.id}
                      className="bg-surface-container-lowest rounded-xl p-5 shadow-sm flex flex-col justify-between gap-4 hover:shadow-md transition-all group border border-outline-variant/30 hover:border-primary/50"
                    >
                      <div className="flex flex-col gap-2.5">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            {isActive ? (
                              <>
                                <span className="w-2 h-2 rounded-full bg-secondary animate-pulse" />
                                <span className="font-label-sm text-label-sm text-secondary font-semibold">Active</span>
                                <span className="text-on-surface-variant font-body-sm text-body-sm">
                                  • {formatBoardDate(item.updatedAt)}
                                </span>
                              </>
                            ) : (
                              <>
                                <span className="w-2 h-2 rounded-full bg-outline-variant" />
                                <span className="text-on-surface-variant font-body-sm text-body-sm">
                                  {formatBoardDate(item.updatedAt)}
                                </span>
                              </>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              onToggleStar(item.id)
                            }}
                            className={`cursor-pointer hover:scale-110 transition-transform ${
                              item.starred ? 'text-tertiary-container' : 'text-outline-variant hover:text-tertiary-container'
                            }`}
                            title={item.starred ? 'Starred' : 'Star retro'}
                          >
                            <span
                              className="material-symbols-outlined text-[18px]"
                              style={item.starred ? { fontVariationSettings: "'FILL' 1" } : undefined}
                            >
                              star
                            </span>
                          </button>
                        </div>
                        <h3
                          onClick={() => onOpenBoard(item.id)}
                          className="font-headline-md text-headline-md text-on-surface group-hover:text-primary transition-colors cursor-pointer font-semibold"
                        >
                          {item.title}
                        </h3>
                        <p className="font-body-sm text-body-sm text-on-surface-variant">
                          {totalThoughts} thoughts • {actionItems} action items{!isActive ? ' completed' : ''} • {participants} participants
                        </p>
                        <div className="flex items-center gap-1.5 pt-1">
                          <span className="px-2 py-0.5 rounded bg-surface-container font-label-sm text-label-sm text-on-surface-variant font-medium">
                            {frameworkTag}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center justify-between pt-3 border-t border-outline-variant/20">
                        {isActive ? (
                          <>
                            <div className="flex -space-x-2">
                              {avatars.map((av, idx) => (
                                <div
                                  key={idx}
                                  className={`w-7 h-7 rounded-full font-label-sm text-label-sm flex items-center justify-center font-bold ring-2 ring-surface-container-lowest ${
                                    idx === 0
                                      ? 'bg-primary text-on-primary'
                                      : idx === 1
                                      ? 'bg-secondary text-on-secondary'
                                      : 'bg-surface-container-highest text-on-surface'
                                  }`}
                                >
                                  {av}
                                </div>
                              ))}
                            </div>
                            <button
                              type="button"
                              onClick={() => onOpenBoard(item.id)}
                              className="px-3.5 py-1.5 rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:bg-primary-container transition-all flex items-center gap-1 shadow-sm cursor-pointer"
                            >
                              <span>Open Board</span>
                              <span className="material-symbols-outlined text-[15px]">arrow_forward</span>
                            </button>
                          </>
                        ) : (
                          <>
                            <span className="font-label-sm text-label-sm text-on-surface-variant font-medium">Completed</span>
                            <button
                              type="button"
                              onClick={() => setSummaryBoard(item)}
                              className="px-3.5 py-1.5 rounded-lg bg-surface-container text-on-surface font-label-md text-label-md hover:bg-surface-container-high transition-colors cursor-pointer"
                            >
                              <span>View Summary</span>
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              /* LIST VIEW */
              <div className="flex flex-col gap-3">
                {pageBoards.map((item) => {
                  const isActive = !item.locked && item.status !== 'completed'
                  const totalThoughts = item.notes?.length || 0
                  const actionItems = item.notes?.filter((n) => {
                    const col = item.columns.find((c) => c.id === n.columnId)
                    return col?.title.toLowerCase().includes('action')
                  }).length || 0
                  const participants = item.participantCount ?? 0
                  const frameworkTag = item.frameworkTag || 'Went Well / Better'

                  return (
                    <div
                      key={item.id}
                      className="bg-surface-container-lowest rounded-xl p-4 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4 hover:shadow-md transition-all border border-outline-variant/30 hover:border-primary/50 group"
                    >
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <button
                          type="button"
                          onClick={() => onToggleStar(item.id)}
                          className={`cursor-pointer hover:scale-110 transition-transform ${
                            item.starred ? 'text-tertiary-container' : 'text-outline-variant hover:text-tertiary-container'
                          }`}
                          title={item.starred ? 'Starred' : 'Star'}
                        >
                          <span
                            className="material-symbols-outlined text-[18px]"
                            style={item.starred ? { fontVariationSettings: "'FILL' 1" } : undefined}
                          >
                            star
                          </span>
                        </button>
                        <div className="flex flex-col min-w-0">
                          <div className="flex items-center gap-2">
                            {isActive ? (
                              <span className="inline-flex items-center gap-1 font-label-sm text-label-sm text-secondary font-semibold">
                                <span className="w-1.5 h-1.5 rounded-full bg-secondary animate-pulse" /> Active
                              </span>
                            ) : (
                              <span className="font-label-sm text-label-sm text-on-surface-variant font-medium">Completed</span>
                            )}
                            <span className="text-on-surface-variant font-body-sm text-body-sm">• {formatBoardDate(item.updatedAt)}</span>
                          </div>
                          <h3
                            onClick={() => onOpenBoard(item.id)}
                            className="font-headline-sm text-headline-sm text-on-surface group-hover:text-primary transition-colors cursor-pointer truncate font-semibold"
                          >
                            {item.title}
                          </h3>
                        </div>
                      </div>

                      <div className="flex items-center gap-4 text-on-surface-variant font-body-sm text-body-sm shrink-0">
                        <span className="px-2 py-0.5 rounded bg-surface-container font-label-sm text-label-sm text-on-surface-variant font-medium">
                          {frameworkTag}
                        </span>
                        <span className="hidden sm:inline">
                          {totalThoughts} thoughts • {actionItems} actions • {participants} team
                        </span>
                        {isActive ? (
                          <button
                            type="button"
                            onClick={() => onOpenBoard(item.id)}
                            className="px-3.5 py-1.5 rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:bg-primary-container transition-all flex items-center gap-1 shadow-sm cursor-pointer"
                          >
                            <span>Open</span>
                            <span className="material-symbols-outlined text-[15px]">arrow_forward</span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setSummaryBoard(item)}
                            className="px-3.5 py-1.5 rounded-lg bg-surface-container text-on-surface font-label-md text-label-md hover:bg-surface-container-high transition-colors cursor-pointer"
                          >
                            <span>Summary</span>
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Scalable Pagination & Navigation Controls */}
            {filteredBoards.length > 0 && (
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-2 text-on-surface-variant font-body-sm text-body-sm">
                <div className="text-center sm:text-left">
                  Showing <span className="font-semibold text-on-surface">{startIndex + 1}–{endIndex}</span> of{' '}
                  <span className="font-semibold text-on-surface">{filteredBoards.length}</span> boards
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex items-center bg-surface-container-lowest rounded-lg shadow-sm p-1 border border-outline-variant/30">
                    <button
                      onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                      disabled={safePage <= 1}
                      className={`px-2.5 py-1 rounded font-label-sm text-label-sm flex items-center gap-1 transition-colors ${
                        safePage <= 1
                          ? 'text-on-surface-variant/40 cursor-not-allowed'
                          : 'text-on-surface hover:bg-surface-container cursor-pointer'
                      }`}
                      type="button"
                    >
                      <span className="material-symbols-outlined text-[14px]">arrow_back</span>
                      <span>Prev</span>
                    </button>
                    {Array.from({ length: totalPages }, (_, i) => i + 1).map((pageNum) => (
                      <button
                        key={pageNum}
                        onClick={() => setCurrentPage(pageNum)}
                        className={`w-7 h-7 rounded font-label-sm text-label-sm flex items-center justify-center transition-colors cursor-pointer ${
                          pageNum === safePage
                            ? 'bg-primary text-on-primary font-semibold shadow-xs'
                            : 'text-on-surface hover:bg-surface-container'
                        }`}
                        type="button"
                      >
                        {pageNum}
                      </button>
                    ))}
                    <button
                      onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                      disabled={safePage >= totalPages}
                      className={`px-2.5 py-1 rounded font-label-sm text-label-sm flex items-center gap-1 transition-colors ${
                        safePage >= totalPages
                          ? 'text-on-surface-variant/40 cursor-not-allowed'
                          : 'text-on-surface hover:bg-surface-container cursor-pointer'
                      }`}
                      type="button"
                    >
                      <span>Next</span>
                      <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
                    </button>
                  </div>
                  <div className="flex items-center bg-surface-container-lowest px-2 py-1.5 rounded-lg shadow-sm border border-outline-variant/30 font-label-sm text-label-sm">
                    <select
                      value={pageSize}
                      onChange={(e) => {
                        setPageSize(Number(e.target.value))
                        setCurrentPage(1)
                      }}
                      className="bg-transparent text-on-surface font-label-sm text-label-sm focus:outline-none cursor-pointer"
                    >
                      <option value={6}>6 per page</option>
                      <option value={12}>12 per page</option>
                      <option value={24}>24 per page</option>
                    </select>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* FOOTER */}
      <footer className="w-full bg-surface-container-lowest border-t border-outline-variant/30 py-5 mt-10">
        <div className="max-w-7xl mx-auto px-gutter flex flex-col sm:flex-row items-center justify-between gap-3 text-center sm:text-left">
          <div className="flex items-center gap-2">
            <span className="font-headline-sm text-headline-sm text-on-surface font-bold">together.</span>
            <span className="font-body-sm text-body-sm text-on-surface-variant">
              — Decentralized &amp; Private Retrospective Canvas
            </span>
          </div>
          <div className="font-label-sm text-label-sm text-on-surface-variant">
            © 2025 Together App • Zero Central Storage • End-to-End P2P Encrypted
          </div>
        </div>
      </footer>

      {/* HELP & P2P GUIDE MODAL */}
      {showHelpModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-on-surface/40 backdrop-blur-xs">
          <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant/40 shadow-2xl p-6 sm:p-8 max-w-xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2 text-secondary font-headline-md font-bold">
                <span className="material-symbols-outlined">hub</span>
                <span>Help &amp; P2P Architecture Guide</span>
              </div>
              <button
                type="button"
                onClick={() => setShowHelpModal(false)}
                className="w-8 h-8 rounded-full hover:bg-surface-container flex items-center justify-center text-outline cursor-pointer"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="flex flex-col gap-5 text-on-surface font-body-sm">
              <div className="p-4 rounded-xl bg-surface-container-low border border-outline-variant/30 flex gap-3">
                <span className="material-symbols-outlined text-secondary text-2xl shrink-0">lock</span>
                <div>
                  <h4 className="font-semibold text-on-surface mb-1">Zero Central Storage &amp; E2E Privacy</h4>
                  <p className="text-on-surface-variant">
                    Together Retro stores zero boards on any central company database. All your retrospective cards, votes, and notes exist solely on your browser and sync directly over WebRTC.
                  </p>
                </div>
              </div>
              <div className="p-4 rounded-xl bg-surface-container-low border border-outline-variant/30 flex gap-3">
                <span className="material-symbols-outlined text-primary text-2xl shrink-0">cable</span>
                <div>
                  <h4 className="font-semibold text-on-surface mb-1">Decentralized WebRTC Mesh</h4>
                  <p className="text-on-surface-variant">
                    When you share an invite link, peers connect to your browser in a peer-to-peer data mesh. Real-time updates use conflict-free replicated data types (Yjs CRDTs).
                  </p>
                </div>
              </div>
              <div className="p-4 rounded-xl bg-surface-container-low border border-outline-variant/30 flex gap-3">
                <span className="material-symbols-outlined text-secondary text-2xl shrink-0">timer</span>
                <div>
                  <h4 className="font-semibold text-on-surface mb-1">Interactive Ceremonies</h4>
                  <p className="text-on-surface-variant">
                    Use the synchronized countdown timer for silent brainstorming, vote on hot topics, and commit to tangible action items before wrapping up your sprint.
                  </p>
                </div>
              </div>
            </div>
            <div className="mt-6 flex justify-end">
              <button
                type="button"
                onClick={() => setShowHelpModal(false)}
                className="px-5 py-2 rounded-lg bg-surface-container text-on-surface font-label-md text-label-md hover:bg-surface-container-high transition-colors cursor-pointer"
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SUMMARY MODAL */}
      {summaryBoard && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-on-surface/40 backdrop-blur-xs">
          <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant/40 shadow-2xl p-6 sm:p-8 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <div>
                <span className="font-label-sm text-secondary font-semibold uppercase tracking-wider">Retrospective Summary</span>
                <h3 className="font-headline-lg font-bold text-on-surface mt-0.5">{summaryBoard.title}</h3>
                <p className="text-xs text-on-surface-variant">{formatBoardDate(summaryBoard.updatedAt)} • Completed</p>
              </div>
              <button
                type="button"
                onClick={() => setSummaryBoard(null)}
                className="w-8 h-8 rounded-full hover:bg-surface-container flex items-center justify-center text-outline cursor-pointer"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="grid grid-cols-3 gap-3 mb-6 p-4 rounded-xl bg-surface-container-low border border-outline-variant/30 text-center">
              <div>
                <span className="text-2xl font-bold text-primary">{summaryBoard.notes.length}</span>
                <p className="text-xs text-on-surface-variant">Total Thoughts</p>
              </div>
              <div>
                <span className="text-2xl font-bold text-secondary">
                  {summaryBoard.notes.filter((n) => {
                    const col = summaryBoard.columns.find((c) => c.id === n.columnId)
                    return col?.title.toLowerCase().includes('action')
                  }).length}
                </span>
                <p className="text-xs text-on-surface-variant">Action Items</p>
              </div>
              <div>
                <span className="text-2xl font-bold text-on-surface">{summaryBoard.participantCount ?? '—'}</span>
                <p className="text-xs text-on-surface-variant">Teammates</p>
              </div>
            </div>

            <div className="flex flex-col gap-4 mb-6">
              <h4 className="font-label-md font-bold text-on-surface">Column thoughts:</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {summaryBoard.columns.map((col) => {
                  const colNotes = summaryBoard.notes.filter((n) => n.columnId === col.id)
                  return (
                    <div key={col.id} className="p-3 rounded-lg border border-outline-variant/30 bg-surface-container-lowest">
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-semibold text-xs text-on-surface">{col.title}</span>
                        <span className="text-[11px] px-1.5 py-0.5 rounded bg-surface-container text-on-surface-variant">
                          {colNotes.length} notes
                        </span>
                      </div>
                      <ul className="text-xs text-on-surface-variant space-y-1">
                        {colNotes.slice(0, 3).map((n) => (
                          <li key={n.id} className="truncate">• {n.text}</li>
                        ))}
                        {colNotes.length === 0 && <li className="italic text-outline">No notes</li>}
                      </ul>
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="flex items-center justify-between pt-4 border-t border-outline-variant/20">
              <button
                type="button"
                onClick={() => setSummaryBoard(null)}
                className="px-4 py-2 rounded-lg bg-surface-container text-on-surface font-label-md hover:bg-surface-container-high transition-colors cursor-pointer"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => {
                  const id = summaryBoard.id
                  setSummaryBoard(null)
                  onOpenBoard(id)
                }}
                className="px-4 py-2 rounded-lg bg-primary text-on-primary font-label-md hover:bg-primary-container transition-all flex items-center gap-1.5 shadow-sm cursor-pointer"
              >
                <span>Open Full Board</span>
                <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
