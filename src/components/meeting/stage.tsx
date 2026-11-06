import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

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
  onPin: (id: string | null) => void
  activeSpeakerId: string | null
  className?: string
}

/**
 * The main video area: adaptive gallery, speaker view with a filmstrip, or a
 * presentation (screen share / whiteboard) with a filmstrip.
 */
export function Stage({
  tiles,
  renderVideo,
  tileMenu,
  presentation,
  view,
  pinnedId,
  onPin,
  activeSpeakerId,
  className,
}: StageProps) {
  const [ref, size] = useSize<HTMLDivElement>()
  const isNarrow = size.width > 0 && size.width < 720
  const [page, setPage] = useState(0)

  // Keep the featured participant stable: pinned > last remote speaker > first remote > local.
  const [lastSpeaker, setLastSpeaker] = useState<string | null>(null)
  const remoteSpeaker =
    activeSpeakerId && !tiles.find((t) => t.id === activeSpeakerId)?.isLocal
      ? activeSpeakerId
      : null
  if (remoteSpeaker && remoteSpeaker !== lastSpeaker)
    setLastSpeaker(remoteSpeaker)
  const featured = useMemo(() => {
    if (pinnedId && tiles.some((t) => t.id === pinnedId)) return pinnedId
    if (lastSpeaker && tiles.some((t) => t.id === lastSpeaker))
      return lastSpeaker
    return (tiles.find((t) => !t.isLocal) ?? tiles[0])?.id ?? null
  }, [pinnedId, tiles, lastSpeaker])

  const showFilmstrip =
    presentation !== null || view === 'speaker' || pinnedId !== null
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

  return (
    <div
      ref={ref}
      className={cn(
        'flex h-full w-full gap-2 p-2',
        isNarrow ? 'flex-col' : 'flex-row',
        className,
      )}
    >
      <div className="relative flex min-h-0 min-w-0 flex-1 items-center justify-center">
        {main ? (
          <div className="relative h-full w-full overflow-hidden rounded-xl bg-stage-tile">
            {main.node}
            <span className="absolute left-3 top-3 rounded-md bg-black/50 px-2 py-1 text-xs font-medium text-white backdrop-blur-sm">
              {main.label}
            </span>
          </div>
        ) : featuredTile ? (
          <FeaturedTile
            tile={featuredTile}
            video={renderVideo(featuredTile)}
            pinned={pinnedId === featuredTile.id}
            onPin={onPin}
            menu={tileMenu?.(featuredTile)}
          />
        ) : null}
      </div>
      {strip.length > 0 && (
        <div
          className={cn(
            'flex shrink-0 gap-2 overflow-auto scrollbar-thin',
            isNarrow ? 'h-24 flex-row' : 'w-44 flex-col lg:w-52',
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
