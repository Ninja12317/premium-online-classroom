import { useState } from 'react'
import {
  Check,
  Download,
  Frame,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { BoardElement } from './infinite-engine'

/**
 * Collapsible Lesson Slides / Frames Navigator sidebar.
 * Lets teachers insert 16:9 or A4 frames, jump straight to any slide,
 * rename/delete slides, and export all frames as a multi-page PDF.
 */
export function FramesSidebar({
  frames,
  canDraw,
  onJumpToFrame,
  onAddFrame,
  onRenameFrame,
  onDeleteFrame,
  onExportFramesPdf,
  onClose,
}: {
  frames: BoardElement[]
  canDraw: boolean
  onJumpToFrame: (frame: BoardElement) => void
  onAddFrame: (ratio: '16:9' | 'A4') => void
  onRenameFrame: (id: string, title: string) => void
  onDeleteFrame: (id: string) => void
  onExportFramesPdf: () => void
  onClose: () => void
}) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftTitle, setDraftTitle] = useState('')

  return (
    <aside
      aria-label="Lesson slides and frames"
      onPointerDown={(e) => e.stopPropagation()}
      className="absolute bottom-3 left-3 top-3 z-20 flex w-60 flex-col overflow-hidden rounded-xl border border-border bg-card/95 text-card-foreground shadow-lg backdrop-blur-md"
    >
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold">
          <Frame className="size-3.5 text-primary" />
          <span>Slides / Frames ({frames.length})</span>
        </div>
        <button
          type="button"
          aria-label="Close slides panel"
          onClick={onClose}
          className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      </div>

      {canDraw && (
        <div className="grid grid-cols-2 gap-1.5 border-b border-border p-2">
          <Button
            type="button"
            size="xs"
            variant="outline"
            className="gap-1 text-[11px]"
            onClick={() => onAddFrame('16:9')}
          >
            <Plus className="size-3" /> 16:9 Slide
          </Button>
          <Button
            type="button"
            size="xs"
            variant="outline"
            className="gap-1 text-[11px]"
            onClick={() => onAddFrame('A4')}
          >
            <Plus className="size-3" /> A4 Sheet
          </Button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-2 scrollbar-thin">
        {frames.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
            Add a 16:9 slide or A4 sheet to organize your lesson into navigable
            frames.
          </div>
        ) : (
          <ul className="space-y-1.5">
            {frames.map((frame, index) => (
              <li
                key={frame.id}
                className="group rounded-lg border border-border bg-background/70 p-2 transition-colors hover:border-primary/50"
              >
                {editingId === frame.id ? (
                  <form
                    className="flex items-center gap-1"
                    onSubmit={(e) => {
                      e.preventDefault()
                      if (draftTitle.trim()) {
                        onRenameFrame(frame.id, draftTitle.trim())
                      }
                      setEditingId(null)
                    }}
                  >
                    <Input
                      autoFocus
                      value={draftTitle}
                      onChange={(e) => setDraftTitle(e.target.value)}
                      onBlur={() => {
                        if (draftTitle.trim()) {
                          onRenameFrame(frame.id, draftTitle.trim())
                        }
                        setEditingId(null)
                      }}
                      className="h-7 text-xs"
                    />
                    <Button
                      type="submit"
                      size="icon"
                      variant="ghost"
                      className="size-7 shrink-0"
                    >
                      <Check className="size-3" />
                    </Button>
                  </form>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => onJumpToFrame(frame)}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    >
                      <span className="grid size-5 shrink-0 place-items-center rounded bg-primary/12 text-[10px] font-semibold tabular-nums text-primary">
                        {index + 1}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-xs font-medium text-foreground">
                          {frame.frameTitle || `Slide ${index + 1}`}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          {frame.frameRatio || 'Custom'} ·{' '}
                          {Math.round(frame.w)}×{Math.round(frame.h)}
                        </p>
                      </div>
                    </button>
                    {canDraw && (
                      <div className="flex shrink-0 items-center gap-0.5 opacity-75 group-hover:opacity-100">
                        <button
                          type="button"
                          aria-label={`Rename ${frame.frameTitle || 'slide'}`}
                          onClick={() => {
                            setEditingId(frame.id)
                            setDraftTitle(
                              frame.frameTitle || `Slide ${index + 1}`,
                            )
                          }}
                          className="grid size-6 place-items-center rounded hover:bg-muted"
                        >
                          <Pencil className="size-3" />
                        </button>
                        <button
                          type="button"
                          aria-label={`Delete ${frame.frameTitle || 'slide'}`}
                          onClick={() => onDeleteFrame(frame.id)}
                          className="grid size-6 place-items-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        >
                          <Trash2 className="size-3" />
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {frames.length > 0 && (
        <div className="border-t border-border p-2">
          <Button
            type="button"
            size="xs"
            className="w-full gap-1.5"
            onClick={onExportFramesPdf}
          >
            <Download className="size-3.5" /> Export Frames to PDF
          </Button>
        </div>
      )}
    </aside>
  )
}
