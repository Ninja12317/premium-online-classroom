import { useMemo, useState } from 'react'
import {
  Check,
  Columns3,
  FileText,
  Grid2X2,
  Layers,
  Loader2,
  Lock,
  Rows3,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { parsePdfPageSelection } from './geometry-utils'
import type { ParsedPdfSession } from './pdf-importer'

export type PdfImportLayout = 'deck' | 'row' | 'column' | 'grid'

export interface PdfImportConfirmPayload {
  session: ParsedPdfSession
  pageIndices: number[]
  layout: PdfImportLayout
  autoLock: boolean
}

export function PdfImportDialog({
  open,
  session,
  loadingFile,
  importing,
  importProgress,
  onClose,
  onConfirm,
}: {
  open: boolean
  session: ParsedPdfSession | null
  loadingFile: boolean
  importing: boolean
  importProgress: { done: number; total: number } | null
  onClose: () => void
  onConfirm: (payload: PdfImportConfirmPayload) => void
}) {
  const [seenSession, setSeenSession] = useState<ParsedPdfSession | null>(null)
  const [selectionMode, setSelectionMode] = useState<'all' | 'custom'>('all')
  const [rangeText, setRangeText] = useState('')
  const [selectedSet, setSelectedSet] = useState<Set<number>>(new Set())
  const [layout, setLayout] = useState<PdfImportLayout>('deck')
  const [autoLock, setAutoLock] = useState(true)

  if (session !== seenSession) {
    setSeenSession(session)
    if (session) {
      setSelectionMode('all')
      setRangeText(`1-${session.numPages}`)
      setSelectedSet(
        new Set(Array.from({ length: session.numPages }, (_, i) => i)),
      )
      setLayout(session.numPages > 1 ? 'deck' : 'row')
      setAutoLock(true)
    }
  }

  const effectiveIndices = useMemo(() => {
    if (!session) return []
    if (selectionMode === 'all') {
      return Array.from({ length: session.numPages }, (_, i) => i)
    }
    return Array.from(selectedSet)
      .filter((i) => i >= 0 && i < session.numPages)
      .sort((a, b) => a - b)
  }, [session, selectionMode, selectedSet])

  const toggleThumb = (idx: number) => {
    setSelectionMode('custom')
    setSelectedSet((prev) => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })
  }

  const applyRangeText = (val: string) => {
    setRangeText(val)
    if (!session) return
    setSelectionMode('custom')
    setSelectedSet(new Set(parsePdfPageSelection(val, session.numPages)))
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !importing && onClose()}>
      <DialogContent className="flex max-h-[88vh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="size-4 text-primary" />
            Import PDF to Whiteboard
          </DialogTitle>
          <DialogDescription>
            {session
              ? `${session.fileName} · ${session.numPages} ${session.numPages === 1 ? 'page' : 'pages'} ready to place on the canvas.`
              : 'Reading PDF pages locally in your browser…'}
          </DialogDescription>
        </DialogHeader>

        {loadingFile || !session ? (
          <div className="flex flex-col items-center justify-center gap-3 py-14 text-sm text-muted-foreground">
            <Loader2 className="size-6 animate-spin text-primary" />
            <span>Parsing PDF and generating page previews…</span>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1 scrollbar-thin">
            {/* Layout mode selector */}
            <div className="space-y-2">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Placement layout
              </Label>
              <div className="grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setLayout('deck')}
                  className={cn(
                    'flex items-start gap-2.5 rounded-xl border p-3 text-left transition-colors',
                    layout === 'deck'
                      ? 'border-primary bg-primary/10 text-foreground'
                      : 'border-border bg-card hover:bg-muted/50',
                  )}
                >
                  <Layers className="mt-0.5 size-4 shrink-0 text-primary" />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold">
                      Interactive PDF Deck
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      Single board frame with Prev/Next arrows &amp; per-page
                      annotations synced live.
                    </p>
                  </div>
                </button>

                <div
                  className={cn(
                    'flex flex-col justify-between gap-2 rounded-xl border p-3 transition-colors',
                    layout !== 'deck'
                      ? 'border-primary bg-primary/10'
                      : 'border-border bg-card',
                  )}
                >
                  <div>
                    <p className="text-xs font-semibold text-foreground">
                      Spread Pages on Canvas
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      Lay out every selected page side-by-side on the infinite
                      canvas.
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {(
                      [
                        ['row', 'Row', Columns3],
                        ['column', 'Column', Rows3],
                        ['grid', 'Grid', Grid2X2],
                      ] as const
                    ).map(([id, label, Icon]) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setLayout(id)}
                        className={cn(
                          'flex flex-1 items-center justify-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-medium transition-colors',
                          layout === id
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-border bg-background text-muted-foreground hover:text-foreground',
                        )}
                      >
                        <Icon className="size-3" /> {label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Page selection controls */}
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Select pages ({effectiveIndices.length} of {session.numPages})
                </Label>
                <div className="flex items-center gap-1.5">
                  <Button
                    type="button"
                    size="xs"
                    variant={selectionMode === 'all' ? 'default' : 'outline'}
                    onClick={() => {
                      setSelectionMode('all')
                      setRangeText(`1-${session.numPages}`)
                      setSelectedSet(
                        new Set(
                          Array.from({ length: session.numPages }, (_, i) => i),
                        ),
                      )
                    }}
                  >
                    All Pages
                  </Button>
                  <Input
                    value={rangeText}
                    onChange={(e) => applyRangeText(e.target.value)}
                    placeholder="e.g. 1-3, 5"
                    aria-label="Page range"
                    className="h-7 w-28 text-xs"
                  />
                </div>
              </div>

              <div className="grid max-h-56 grid-cols-3 gap-2 overflow-y-auto rounded-xl border border-border bg-muted/30 p-2.5 sm:grid-cols-4 scrollbar-thin">
                {session.thumbs.map((t) => {
                  const checked =
                    selectionMode === 'all' || selectedSet.has(t.pageIndex)
                  return (
                    <button
                      key={t.pageIndex}
                      type="button"
                      onClick={() => toggleThumb(t.pageIndex)}
                      className={cn(
                        'group relative flex flex-col items-center gap-1 rounded-lg border p-1.5 transition-all',
                        checked
                          ? 'border-primary bg-primary/10 ring-1 ring-primary/30'
                          : 'border-border bg-card opacity-60 hover:opacity-100',
                      )}
                    >
                      <span
                        className={cn(
                          'absolute right-2 top-2 grid size-4 place-items-center rounded border text-[10px]',
                          checked
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-border bg-background/90',
                        )}
                      >
                        {checked && <Check className="size-3" />}
                      </span>
                      {t.thumbDataUrl ? (
                        <img
                          src={t.thumbDataUrl}
                          alt={`Page ${t.pageNumber}`}
                          className="h-24 w-full rounded bg-white object-contain"
                        />
                      ) : (
                        <div className="grid h-24 w-full place-items-center rounded bg-muted text-xs text-muted-foreground">
                          Page {t.pageNumber}
                        </div>
                      )}
                      <span className="text-[11px] font-medium tabular-nums text-foreground">
                        Page {t.pageNumber}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Auto-lock background toggle */}
            <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/40 px-3.5 py-2.5">
              <div className="flex items-start gap-2.5">
                <Lock className="mt-0.5 size-4 shrink-0 text-primary" />
                <div>
                  <Label
                    htmlFor="pdf-auto-lock"
                    className="text-xs font-semibold text-foreground"
                  >
                    Auto-Lock Background
                  </Label>
                  <p className="text-[11px] text-muted-foreground">
                    Lock imported PDF pages so you can draw, highlight, and
                    annotate on top without shifting them.
                  </p>
                </div>
              </div>
              <Switch
                id="pdf-auto-lock"
                checked={autoLock}
                onCheckedChange={setAutoLock}
              />
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 pt-2">
          <Button
            type="button"
            variant="outline"
            disabled={importing}
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={
              loadingFile ||
              !session ||
              importing ||
              effectiveIndices.length === 0
            }
            onClick={() => {
              if (!session) return
              onConfirm({
                session,
                pageIndices: effectiveIndices,
                layout,
                autoLock,
              })
            }}
            className="gap-1.5"
          >
            {importing ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                {importProgress
                  ? `Importing ${importProgress.done}/${importProgress.total}…`
                  : 'Importing…'}
              </>
            ) : (
              <>
                Import {effectiveIndices.length}{' '}
                {effectiveIndices.length === 1 ? 'Page' : 'Pages'}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
