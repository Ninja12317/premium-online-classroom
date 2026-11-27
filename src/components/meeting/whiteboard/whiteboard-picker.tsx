import { useEffect, useMemo, useState } from 'react'
import {
  Check,
  Clock,
  Copy,
  FileText,
  GitBranch,
  Grid3X3,
  Kanban,
  Layers,
  Network,
  Pencil,
  PenTool,
  Plus,
  Search,
  Sparkles,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'

import { useIdentity } from '@/components/identity-provider'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import type { StandaloneBoardMeta } from '@/lib/meeting-types'
import { cn } from '@/lib/utils'
import {
  createStandaloneBoard,
  deleteStandaloneBoard,
  duplicateStandaloneBoard,
  renameStandaloneBoard,
  subscribeUserWhiteboards,
} from '@/services/firestore-meetings'
import type { TemplateKind } from './infinite-engine'

const QUICK_TEMPLATES: {
  id: TemplateKind | 'blank'
  label: string
  description: string
  icon: typeof PenTool
}[] = [
  {
    id: 'blank',
    label: 'Blank Canvas',
    description: 'Clean infinite dot grid',
    icon: Sparkles,
  },
  {
    id: 'flowchart',
    label: 'Flowchart',
    description: 'Process steps & decisions',
    icon: GitBranch,
  },
  {
    id: 'mindmap',
    label: 'Mind Map',
    description: 'Central topic & branches',
    icon: Network,
  },
  {
    id: 'kanban',
    label: 'Kanban Board',
    description: 'To Do, In Progress, Done',
    icon: Kanban,
  },
  {
    id: 'matrix2x2',
    label: '2×2 Matrix',
    description: 'Four-quadrant comparison',
    icon: Grid3X3,
  },
  {
    id: 'coordGrid',
    label: 'Coordinate Grid',
    description: 'X/Y axes for math & graphs',
    icon: FileText,
  },
]

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return 'Just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)}d ago`
  return new Date(ts).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export interface WhiteboardGalleryProps {
  onSelectBoard: (board: StandaloneBoardMeta) => void
  activeBoardId?: string | null
  createdByName?: string
  compact?: boolean
  openLabel?: string
}

export function WhiteboardGallery({
  onSelectBoard,
  activeBoardId,
  createdByName,
  compact = false,
  openLabel = 'Open',
}: WhiteboardGalleryProps) {
  const { authStatus, clientUid, ready } = useIdentity()
  const activeUid =
    ready && (authStatus === 'authenticated' || authStatus === 'guest')
      ? clientUid
      : null
  const [boards, setBoards] = useState<StandaloneBoardMeta[]>([])
  const [loading, setLoading] = useState(() => Boolean(activeUid))
  const [creating, setCreating] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameVal, setRenameVal] = useState('')

  const [seenUid, setSeenUid] = useState<string | null>(activeUid)
  if (activeUid !== seenUid) {
    setSeenUid(activeUid)
    setBoards([])
    setLoading(Boolean(activeUid))
  }

  useEffect(() => {
    if (!ready || !activeUid) return
    const unsub = subscribeUserWhiteboards(activeUid, (list) => {
      setBoards(list)
      setLoading(false)
    })
    return () => {
      unsub()
    }
  }, [ready, activeUid])

  const filteredBoards = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return boards
    return boards.filter((b) => b.title.toLowerCase().includes(q))
  }, [boards, search])

  async function handleCreate(template: TemplateKind | 'blank' = 'blank') {
    if (creating) return
    setCreating(template)
    try {
      const tplLabel =
        template === 'blank'
          ? `Whiteboard ${boards.length + 1}`
          : `${QUICK_TEMPLATES.find((t) => t.id === template)?.label ?? 'Whiteboard'} ${boards.length + 1}`
      const board = await createStandaloneBoard({
        title: tplLabel,
        template: template === 'blank' ? null : template,
        createdByName,
      })
      setBoards((prev) => [board, ...prev])
      onSelectBoard(board)
    } catch {
      toast.error('Could not create whiteboard.')
    } finally {
      setCreating(null)
    }
  }

  async function handleRename(id: string) {
    const next = renameVal.trim()
    setRenamingId(null)
    if (!next) return
    await renameStandaloneBoard(id, next)
    setBoards((prev) =>
      prev.map((b) =>
        b.id === id ? { ...b, title: next, updatedAt: Date.now() } : b,
      ),
    )
    toast.success('Whiteboard renamed')
  }

  async function handleDuplicate(board: StandaloneBoardMeta) {
    try {
      const copy = await duplicateStandaloneBoard(board.id)
      setBoards((prev) => [copy, ...prev])
      toast.success(`Duplicated "${board.title}"`)
    } catch {
      toast.error('Could not duplicate whiteboard.')
    }
  }

  async function handleDelete(board: StandaloneBoardMeta) {
    await deleteStandaloneBoard(board.id)
    setBoards((prev) => prev.filter((b) => b.id !== board.id))
    toast.success('Whiteboard deleted')
  }

  return (
    <div className={cn('space-y-6', compact && 'space-y-4')}>
      {/* Quick-Start New Whiteboard + Templates */}
      <section className="space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Start a new whiteboard
          </h3>
          <Button
            size="sm"
            className="gap-1.5"
            disabled={creating !== null}
            onClick={() => void handleCreate('blank')}
          >
            <Plus className="size-4" />
            {creating === 'blank' ? 'Creating…' : 'New Whiteboard'}
          </Button>
        </div>

        <div
          className={cn(
            'grid gap-2',
            compact
              ? 'grid-cols-2 sm:grid-cols-3'
              : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-6',
          )}
        >
          {QUICK_TEMPLATES.map((tpl) => (
            <button
              key={tpl.id}
              type="button"
              disabled={creating !== null}
              onClick={() => void handleCreate(tpl.id)}
              className="group flex flex-col items-start gap-1.5 rounded-xl border border-border bg-card p-3 text-left transition-colors hover:border-primary/50 hover:bg-muted/50 disabled:opacity-50"
            >
              <span className="grid size-8 place-items-center rounded-lg bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                <tpl.icon className="size-4" />
              </span>
              <span className="text-xs font-semibold leading-tight text-foreground">
                {tpl.label}
              </span>
              <span className="line-clamp-1 text-[11px] text-muted-foreground">
                {tpl.description}
              </span>
            </button>
          ))}
        </div>
      </section>

      {/* Saved / Recent Whiteboards */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Recent & saved whiteboards ({boards.length})
          </h3>
          {boards.length > 3 && (
            <div className="relative w-full sm:w-56">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search whiteboards…"
                className="h-8 pl-8 text-xs"
              />
            </div>
          )}
        </div>

        {loading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Loading saved whiteboards…
          </p>
        ) : filteredBoards.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">
            <PenTool className="mx-auto mb-2 size-7 opacity-40" />
            {boards.length === 0
              ? 'No saved whiteboards yet. Start a blank board or choose a template above — every change auto-saves.'
              : 'No whiteboards match your search.'}
          </div>
        ) : (
          <ul
            className={cn(
              'grid gap-3',
              compact
                ? 'max-h-[38vh] overflow-y-auto pr-1 sm:grid-cols-2 scrollbar-thin'
                : 'sm:grid-cols-2 lg:grid-cols-3',
            )}
          >
            {filteredBoards.map((b) => {
              const isCurrent = activeBoardId === b.id
              return (
                <li
                  key={b.id}
                  className={cn(
                    'flex flex-col justify-between rounded-2xl border bg-card p-4 shadow-sm transition-colors',
                    isCurrent
                      ? 'border-primary ring-1 ring-primary/30'
                      : 'border-border hover:border-primary/40',
                  )}
                >
                  <div className="min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      {renamingId === b.id ? (
                        <form
                          className="flex flex-1 items-center gap-1"
                          onSubmit={(e) => {
                            e.preventDefault()
                            void handleRename(b.id)
                          }}
                        >
                          <Input
                            autoFocus
                            value={renameVal}
                            onChange={(e) => setRenameVal(e.target.value)}
                            onBlur={() => void handleRename(b.id)}
                            className="h-8 text-sm"
                            aria-label="Rename whiteboard"
                          />
                          <Button
                            type="submit"
                            size="icon"
                            variant="ghost"
                            className="size-8 shrink-0"
                            aria-label="Save name"
                          >
                            <Check className="size-3.5" />
                          </Button>
                        </form>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onSelectBoard(b)}
                          className="min-w-0 flex-1 text-left"
                        >
                          <h4 className="truncate font-semibold text-foreground hover:text-primary">
                            {b.title}
                          </h4>
                        </button>
                      )}
                      {isCurrent && (
                        <Badge
                          variant="secondary"
                          className="shrink-0 bg-primary/15 text-[10px] text-primary"
                        >
                          Active
                        </Badge>
                      )}
                    </div>

                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <Clock className="size-3" />
                        {formatRelativeTime(b.updatedAt)}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Layers className="size-3" />
                        {b.elementCount ?? 0}{' '}
                        {(b.elementCount ?? 0) === 1 ? 'item' : 'items'}
                      </span>
                    </div>
                  </div>

                  <div className="mt-3.5 flex items-center gap-1">
                    <Button
                      size="sm"
                      variant={isCurrent ? 'secondary' : 'default'}
                      className="h-8 gap-1.5 text-xs"
                      onClick={() => onSelectBoard(b)}
                    >
                      <PenTool className="size-3.5" />
                      {isCurrent ? 'Resume' : openLabel}
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-8"
                      title="Rename"
                      aria-label={`Rename ${b.title}`}
                      onClick={() => {
                        setRenamingId(b.id)
                        setRenameVal(b.title)
                      }}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-8"
                      title="Duplicate"
                      aria-label={`Duplicate ${b.title}`}
                      onClick={() => void handleDuplicate(b)}
                    >
                      <Copy className="size-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="ml-auto size-8 text-muted-foreground hover:text-destructive"
                      title="Delete"
                      aria-label={`Delete ${b.title}`}
                      onClick={() => void handleDelete(b)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}

export function WhiteboardPickerDialog({
  open,
  onOpenChange,
  activeBoardId,
  createdByName,
  onSelectBoard,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  activeBoardId?: string | null
  createdByName?: string
  onSelectBoard: (board: StandaloneBoardMeta) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Whiteboards</DialogTitle>
          <DialogDescription>
            Start a fresh infinite whiteboard or reopen a saved board for
            everyone in this class. All drawings auto-save continuously.
          </DialogDescription>
        </DialogHeader>
        {open && (
          <WhiteboardGallery
            compact
            activeBoardId={activeBoardId}
            createdByName={createdByName}
            openLabel="Open in class"
            onSelectBoard={(board) => {
              onSelectBoard(board)
              onOpenChange(false)
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
