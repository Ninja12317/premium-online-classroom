import { useState } from 'react'
import { Check, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  getElementBounds,
  type BoardElement,
  type Camera,
} from './infinite-engine'

/**
 * Interactive image crop overlay with 4 draggable corner handles + Apply / Cancel.
 * Produces a cropped data URL and exact updated world-space bounds for Firestore sync.
 */
export function ImageCropOverlay({
  element,
  camera,
  onApply,
  onCancel,
}: {
  element: BoardElement
  camera: Camera
  onApply: (result: {
    dataUrl: string
    x: number
    y: number
    w: number
    h: number
  }) => void
  onCancel: () => void
}) {
  const b = getElementBounds(element)
  // Normalized crop margins [0..1] inside element bounds
  const [crop, setCrop] = useState({ left: 0.06, top: 0.06, right: 0.94, bottom: 0.94 })
  const [applying, setApplying] = useState(false)

  const sx = b.x * camera.zoom + camera.panX
  const sy = b.y * camera.zoom + camera.panY
  const sw = b.w * camera.zoom
  const sh = b.h * camera.zoom

  const startDrag = (
    corner: 'nw' | 'ne' | 'sw' | 'se',
    e: React.PointerEvent,
  ) => {
    e.stopPropagation()
    e.preventDefault()
    const startX = e.clientX
    const startY = e.clientY
    const init = { ...crop }
    const onMove = (me: PointerEvent) => {
      const dx = (me.clientX - startX) / Math.max(1, sw)
      const dy = (me.clientY - startY) / Math.max(1, sh)
      const next = { ...init }
      if (corner.includes('w')) {
        next.left = Math.max(0, Math.min(init.right - 0.1, init.left + dx))
      }
      if (corner.includes('e')) {
        next.right = Math.min(1, Math.max(init.left + 0.1, init.right + dx))
      }
      if (corner.includes('n')) {
        next.top = Math.max(0, Math.min(init.bottom - 0.1, init.top + dy))
      }
      if (corner.includes('s')) {
        next.bottom = Math.min(1, Math.max(init.top + 0.1, init.bottom + dy))
      }
      setCrop(next)
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const handleApply = async () => {
    if (!element.imageDataUrl || applying) return
    setApplying(true)
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image()
        el.onload = () => resolve(el)
        el.onerror = () => reject(new Error('Image load failed'))
        el.src = element.imageDataUrl!
      })
      const srcX = Math.round(img.naturalWidth * crop.left)
      const srcY = Math.round(img.naturalHeight * crop.top)
      const srcW = Math.max(
        16,
        Math.round(img.naturalWidth * (crop.right - crop.left)),
      )
      const srcH = Math.max(
        16,
        Math.round(img.naturalHeight * (crop.bottom - crop.top)),
      )
      const canvas = document.createElement('canvas')
      canvas.width = srcW
      canvas.height = srcH
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, srcW, srcH)
      const dataUrl = canvas.toDataURL('image/jpeg', 0.86)
      onApply({
        dataUrl,
        x: b.x + b.w * crop.left,
        y: b.y + b.h * crop.top,
        w: Math.max(24, b.w * (crop.right - crop.left)),
        h: Math.max(24, b.h * (crop.bottom - crop.top)),
      })
    } finally {
      setApplying(false)
    }
  }

  const cx = sx + sw * crop.left
  const cy = sy + sh * crop.top
  const cw = sw * (crop.right - crop.left)
  const ch = sh * (crop.bottom - crop.top)

  return (
    <div
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      className="pointer-events-none absolute inset-0 z-30"
    >
      {/* Dimmed image frame */}
      <div
        style={{ left: sx, top: sy, width: sw, height: sh }}
        className="pointer-events-auto absolute bg-black/45"
      />
      {/* Active crop cutout */}
      <div
        style={{ left: cx, top: cy, width: cw, height: ch }}
        className="pointer-events-auto absolute border-2 border-primary bg-transparent shadow-[0_0_0_1px_rgba(255,255,255,0.65)]"
      >
        {(
          [
            ['nw', '-left-2 -top-2 cursor-nwse-resize'],
            ['ne', '-right-2 -top-2 cursor-nesw-resize'],
            ['sw', '-left-2 -bottom-2 cursor-nesw-resize'],
            ['se', '-right-2 -bottom-2 cursor-nwse-resize'],
          ] as const
        ).map(([corner, posCls]) => (
          <div
            key={corner}
            role="slider"
            aria-label={`Crop corner ${corner}`}
            aria-valuenow={Math.round((crop.right - crop.left) * 100)}
            tabIndex={0}
            onPointerDown={(e) => startDrag(corner, e)}
            className={`absolute size-4 rounded-full border-2 border-primary bg-card shadow ${posCls}`}
          />
        ))}
      </div>

      {/* Apply / Cancel bar */}
      <div
        style={{ left: Math.max(12, cx), top: Math.max(12, cy - 44) }}
        className="pointer-events-auto absolute flex items-center gap-1.5 rounded-xl border border-border bg-card/95 px-2 py-1 shadow-lg backdrop-blur"
      >
        <Button
          size="xs"
          disabled={applying}
          className="gap-1"
          onClick={() => void handleApply()}
        >
          <Check className="size-3.5" /> Apply Crop
        </Button>
        <Button
          size="xs"
          variant="outline"
          disabled={applying}
          className="gap-1"
          onClick={onCancel}
        >
          <X className="size-3.5" /> Cancel
        </Button>
      </div>
    </div>
  )
}
