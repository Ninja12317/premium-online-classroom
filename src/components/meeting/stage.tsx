import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { ChevronLeft, ChevronRight, Eye, EyeOff } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { ParticipantTile } from './tile'
import type { Presentation, TileModel, ViewMode } from './types'

const ASPECT = 16 / 9

/** Picks the column count that gives the largest tiles for the box size. */
function bestLayout(width: number, height: number, count: number) {
  if (count === 0 || width === 0 || height === 0) {
    return { cols: 1, rows: 1, tileW: 0, tileH: 0 }
  }
  let best = { cols: 1, rows: count, tileW: 0, tileH: 0 }
  for (let cols = 1; cols <= count; cols++) {
    const rows = Math.ceil(count / cols)
    const gap = 8
    const w = (width - gap * (cols - 1)) / cols
    const h = (height - gap * (rows - 1)) / rows
    const tileW = Math.min(w, h * ASPECT)
    if (tileW > best.tileW) best = { cols, rows, tileW, tileH: tileW / ASPECT }
  }
  return best
}

function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setSize((s) =>
        s.width === width && s.height === height ? s : { width, height },
      )
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, size] as const
}

export interface StageProps {
  tiles: TileModel[]
  renderVideo: (tile: TileModel) => ReactNode | null
  tileMenu?: (tile: TileModel) => ReactNode
  presentation: Presentation | null
  view: ViewMode
  pinnedId: string | null
  spotlightId?: string | null
  onPin: (id: string | null) => void
  activeSpeakerId: string | null
  className?: string
}

/**
 * The main video area: adaptive gallery, speaker view, side-by-side mode,
 * or presentation (screen share / infinite whiteboard with PiP speaker strip).
 */
export function Stage({
  tiles,
  renderVideo,
  tileMenu,
  presentation,
  view,
  pinnedId,
  spotlightId = null,
  onPin,
  activeSpeakerId,
  className,
}: StageProps) {
  const [ref, size] = useSize<HTMLDivElement>()
  const isNarrow = size.width > 0 && size.width < 720
  const [page, setPage] = useState(0)
  const [pipVisible, setPipVisible] = useState(true)

  // Keep the featured participant stable: spotlight > pinned > last remote speaker > first remote > local.
  const [lastSpeaker, setLastSpeaker] = useState<string | null>(null)
  const remoteSpeaker =
    activeSpeakerId && !tiles.find((t) => t.id === activeSpeakerId)?.isLocal
      ? activeSpeakerId
      : null
  if (remoteSpeaker && remoteSpeaker !== lastSpeaker)
    setLastSpeaker(remoteSpeaker)
  const featured = useMemo(() => {
    if (spotlightId && tiles.some((t) => t.id === spotlightId))
      return spotlightId
    if (pinnedId && tiles.some((t) => t.id === pinnedId)) return pinnedId
    if (lastSpeaker && tiles.some((t) => t.id === lastSpeaker))
      return lastSpeaker
    return (tiles.find((t) => !t.isLocal) ?? tiles[0])?.id ?? null
  }, [spotlightId, pinnedId, tiles, lastSpeaker])

  // Prioritize active speaker first in PiP strip over Whiteboard
  const pipTiles = useMemo(() => {
    if (!featured) return tiles.slice(0, 3)
    const top = tiles.find((t) => t.id === featured)
    const rest = tiles.filter((t) => t.id !== featured)
    return top ? [top, ...rest].slice(0, 3) : tiles.slice(0, 3)
  }, [tiles, featured])

  const showFilmstrip =
    presentation !== null ||
    view === 'speaker' ||
    view === 'side-by-side' ||
    pinnedId !== null ||
    spotlightId !== null
  const pageSize = isNarrow ? 6 : 16
  const pages = Math.max(1, Math.ceil(tiles.length / pageSize))
  const safePage = Math.min(page, pages - 1)

  if (!showFilmstrip) {
    const visible = tiles.slice(
      safePage * pageSize,
      safePage * pageSize + pageSize,
    )
    const layout = bestLayout(size.width - 16, size.height - 16, visible.length)
    return (
      <div
        ref={ref}
        className={cn(
          'relative flex h-full w-full items-center justify-center p-2',
          className,
        )}
      >
        <div
          className="grid gap-2"
          style={{
            gridTemplateColumns: `repeat(${layout.cols}, ${Math.floor(layout.tileW)}px)`,
          }}
        >
          {visible.map((tile) => (
            <ParticipantTile
              key={tile.id}
              tile={tile}
              video={renderVideo(tile)}
              pinned={pinnedId === tile.id}
              spotlighted={spotlightId === tile.id}
              onPin={onPin}
              menu={tileMenu?.(tile)}
              large={layout.tileW > 420}
            />
          ))}
        </div>
        {pages > 1 && (
          <Pager page={safePage} pages={pages} onChange={setPage} />
        )}
      </div>
    )
  }

  const main = presentation ?? null
  const featuredTile = tiles.find((t) => t.id === featured) ?? null
  const strip = main ? tiles : tiles.filter((t) => t.id !== featured)
  const isSideBySide = view === 'side-by-side' && !isNarrow
  const isWhiteboard = main?.kind === 'whiteboard'

  if (isWhiteboard) {
    return (
      <div
        ref={ref}
        className={cn('relative h-full w-full overflow-hidden', className)}
      >
        <div className="absolute inset-0 h-full w-full overflow-hidden">
          {main.node}
          {/* Picture-in-Picture active speaker video strip over Whiteboard */}
          <div className="pointer-events-auto absolute bottom-3 left-3 z-20 flex flex-col items-start gap-1.5">
            <button
              type="button"
              onClick={() => setPipVisible((v) => !v)}
              className="flex items-center gap-1.5 rounded-lg border border-border bg-card/95 px-2.5 py-1 text-xs font-medium text-card-foreground shadow-md backdrop-blur hover:bg-muted"
            >
              {pipVisible ? (
                <>
                  <EyeOff className="size-3.5" /> Hide video
                </>
              ) : (
                <>
                  <Eye className="size-3.5" /> Show speaker ({tiles.length})
                </>
              )}
            </button>
            {pipVisible && (
              <div
                className="flex max-w-[calc(100vw-16rem)] items-center gap-2 overflow-x-auto rounded-xl border border-border bg-stage/90 p-1.5 shadow-lg backdrop-blur"
                aria-label="Other participants"
              >
                {pipTiles.map((tile) => (
                  <div key={tile.id} className="w-40 shrink-0 sm:w-44">
                    <ParticipantTile
                      tile={tile}
                      video={renderVideo(tile)}
                      pinned={pinnedId === tile.id}
                      spotlighted={spotlightId === tile.id}
                      onPin={onPin}
                      menu={tileMenu?.(tile)}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      ref={ref}
      className={cn(
        'flex h-full w-full gap-2 p-2',
        isNarrow ? 'flex-col' : 'flex-row',
        className,
      )}
    >
      <div
        className={cn(
          'relative flex min-h-0 min-w-0 items-center justify-center',
          isSideBySide ? 'flex-[2]' : 'flex-1',
        )}
      >
        {main ? (
          <div className="relative h-full w-full overflow-hidden rounded-xl bg-stage-tile">
            {main.node}
            <span className="pointer-events-none absolute left-3 top-3 rounded-md bg-black/50 px-2 py-1 text-xs font-medium text-white backdrop-blur-sm">
              {main.label}
            </span>
          </div>
        ) : featuredTile ? (
          <FeaturedTile
            tile={featuredTile}
            video={renderVideo(featuredTile)}
            pinned={pinnedId === featuredTile.id}
            spotlighted={spotlightId === featuredTile.id}
            onPin={onPin}
            menu={tileMenu?.(featuredTile)}
          />
        ) : null}
      </div>
      {strip.length > 0 && (
        <div
          className={cn(
            'flex shrink-0 gap-2 overflow-auto scrollbar-thin',
            isNarrow
              ? 'h-24 flex-row'
              : isSideBySide
                ? 'w-72 flex-col lg:w-80'
                : 'w-44 flex-col lg:w-52',
          )}
          aria-label="Other participants"
        >
          {strip.map((tile) => (
            <div
              key={tile.id}
              className={cn('shrink-0', isNarrow ? 'w-40' : 'w-full')}
            >
              <ParticipantTile
                tile={tile}
                video={renderVideo(tile)}
                pinned={pinnedId === tile.id}
                spotlighted={spotlightId === tile.id}
                onPin={onPin}
                menu={tileMenu?.(tile)}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** Fits a 16:9 tile inside whatever space is left for the featured speaker. */
function FeaturedTile(
  props: Omit<Parameters<typeof ParticipantTile>[0], 'large' | 'className'>,
) {
  const [ref, size] = useSize<HTMLDivElement>()
  const w = Math.min(size.width, size.height * ASPECT)
  return (
    <div ref={ref} className="grid h-full w-full place-items-center">
      <div style={{ width: w > 0 ? Math.floor(w) : '100%' }}>
        <ParticipantTile {...props} large />
      </div>
    </div>
  )
}

function Pager({
  page,
  pages,
  onChange,
}: {
  page: number
  pages: number
  onChange: (p: number) => void
}) {
  return (
    <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-black/50 px-2 py-1 text-xs text-white backdrop-blur-sm">
      <Button
        size="icon"
        variant="ghost"
        className="size-6 text-white hover:bg-white/20 hover:text-white"
        onClick={() => onChange(Math.max(0, page - 1))}
        disabled={page === 0}
        aria-label="Previous page"
      >
        <ChevronLeft className="size-4" />
      </Button>
      <span>
        {page + 1} / {pages}
      </span>
      <Button
        size="icon"
        variant="ghost"
        className="size-6 text-white hover:bg-white/20 hover:text-white"
        onClick={() => onChange(Math.min(pages - 1, page + 1))}
        disabled={page === pages - 1}
        aria-label="Next page"
      >
        <ChevronRight className="size-4" />
      </Button>
    </div>
  )
}
