import { Check, Minus, Plus } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  getElementBounds,
  type BoardElement,
  type Camera,
} from './infinite-engine'

/**
 * Inline editable table overlay displayed when double-clicking a table element.
 * Supports cell editing, adding/removing rows & columns, and toggling header shading.
 */
export function TableInlineEditor({
  table,
  camera,
  onUpdate,
  onClose,
}: {
  table: BoardElement
  camera: Camera
  onUpdate: (updated: BoardElement) => void
  onClose: () => void
}) {
  const b = getElementBounds(table)
  const rows = Math.max(1, table.tableRows ?? 3)
  const cols = Math.max(1, table.tableCols ?? 3)
  const cells = table.tableCells ?? Array(rows * cols).fill('')
  const headerBg = table.tableHeaderBg !== false

  const sx = b.x * camera.zoom + camera.panX
  const sy = b.y * camera.zoom + camera.panY
  const sw = Math.max(200, b.w * camera.zoom)
  const sh = Math.max(110, b.h * camera.zoom)

  const setCell = (r: number, c: number, value: string) => {
    const nextCells = Array.from(
      { length: rows * cols },
      (_, idx) => cells[idx] ?? '',
    )
    nextCells[r * cols + c] = value
    onUpdate({ ...table, tableCells: nextCells })
  }

  const addRow = () => {
    const nextRows = Math.min(12, rows + 1)
    const nextCells = [
      ...Array.from({ length: rows * cols }, (_, i) => cells[i] ?? ''),
      ...Array(cols).fill(''),
    ]
    onUpdate({
      ...table,
      tableRows: nextRows,
      h: Math.round((b.h / rows) * nextRows),
      tableCells: nextCells,
    })
  }

  const removeRow = () => {
    if (rows <= 1) return
    const nextRows = rows - 1
    const nextCells = Array.from(
      { length: nextRows * cols },
      (_, i) => cells[i] ?? '',
    )
    onUpdate({
      ...table,
      tableRows: nextRows,
      h: Math.max(48, Math.round((b.h / rows) * nextRows)),
      tableCells: nextCells,
    })
  }

  const addCol = () => {
    const nextCols = Math.min(10, cols + 1)
    const nextCells: string[] = []
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) nextCells.push(cells[r * cols + c] ?? '')
      nextCells.push('')
    }
    onUpdate({
      ...table,
      tableCols: nextCols,
      w: Math.round((b.w / cols) * nextCols),
      tableCells: nextCells,
    })
  }

  const removeCol = () => {
    if (cols <= 1) return
    const nextCols = cols - 1
    const nextCells: string[] = []
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < nextCols; c++) {
        nextCells.push(cells[r * cols + c] ?? '')
      }
    }
    onUpdate({
      ...table,
      tableCols: nextCols,
      w: Math.max(120, Math.round((b.w / cols) * nextCols)),
      tableCells: nextCells,
    })
  }

  return (
    <div
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      className="pointer-events-none absolute inset-0 z-30"
    >
      {/* Floating table structure toolbar */}
      <div
        style={{ left: Math.max(8, sx), top: Math.max(8, sy - 44) }}
        className="pointer-events-auto absolute flex flex-wrap items-center gap-1 rounded-xl border border-border bg-card/95 px-2 py-1 text-xs shadow-lg backdrop-blur-md"
      >
        <Button size="xs" variant="ghost" className="gap-1" onClick={addRow}>
          <Plus className="size-3" /> Row
        </Button>
        <Button
          size="xs"
          variant="ghost"
          className="gap-1"
          disabled={rows <= 1}
          onClick={removeRow}
        >
          <Minus className="size-3" /> Row
        </Button>
        <span className="h-4 w-px bg-border" />
        <Button size="xs" variant="ghost" className="gap-1" onClick={addCol}>
          <Plus className="size-3" /> Col
        </Button>
        <Button
          size="xs"
          variant="ghost"
          className="gap-1"
          disabled={cols <= 1}
          onClick={removeCol}
        >
          <Minus className="size-3" /> Col
        </Button>
        <span className="h-4 w-px bg-border" />
        <Button
          size="xs"
          variant={headerBg ? 'secondary' : 'ghost'}
          onClick={() => onUpdate({ ...table, tableHeaderBg: !headerBg })}
        >
          Header
        </Button>
        <Button size="xs" className="ml-1 gap-1" onClick={onClose}>
          <Check className="size-3" /> Done
        </Button>
      </div>

      {/* Inline grid of inputs */}
      <div
        style={{
          left: sx,
          top: sy,
          width: sw,
          height: sh,
          gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
        }}
        className="pointer-events-auto absolute grid overflow-hidden rounded-lg border-2 border-primary bg-white shadow-xl"
      >
        {Array.from({ length: rows }).map((_, r) =>
          Array.from({ length: cols }).map((__, c) => (
            <input
              key={`${r}-${c}`}
              value={cells[r * cols + c] ?? ''}
              onChange={(e) => setCell(r, c, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') onClose()
              }}
              placeholder={r === 0 && headerBg ? `Col ${c + 1}` : ''}
              className={cn(
                'h-full w-full border-b border-r border-primary/25 px-2 text-xs text-[#1f2924] outline-none focus:bg-primary/10',
                r === 0 && headerBg && 'bg-primary/10 font-semibold',
              )}
            />
          )),
        )}
      </div>
    </div>
  )
}
