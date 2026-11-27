import { useEffect, useRef } from 'react'
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Check,
  Highlighter,
  Italic,
  List,
  ListOrdered,
  Sigma,
  Strikethrough,
  Underline,
} from 'lucide-react'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import {
  BOARD_COLORS,
  MATH_SYMBOLS,
  resolveFontStack,
  type BoardTheme,
  type Camera,
  type FontFamilyKey,
  type TextAlignKey,
} from './infinite-engine'

export interface RichTextDraft {
  elementId: string | null
  kind: 'text' | 'sticky' | 'shape'
  wx: number
  wy: number
  w: number
  h: number
  value: string
  stickyBg?: string
  fontFamily: FontFamilyKey
  fontSize: number
  fontWeight: 'normal' | 'bold'
  fontStyle: 'normal' | 'italic'
  underline: boolean
  strikethrough: boolean
  color: string
  textBg: string
  textAlign: TextAlignKey
}

const FONT_OPTIONS: { id: FontFamilyKey; label: string }[] = [
  { id: 'sans', label: 'Sans' },
  { id: 'serif', label: 'Serif' },
  { id: 'mono', label: 'Mono' },
  { id: 'handwriting', label: 'Hand' },
]

const FONT_SIZES = [12, 14, 16, 18, 20, 24, 28, 36, 48, 64, 72, 96]

const HIGHLIGHT_FILLS = [
  { label: 'None', value: 'transparent' },
  { label: 'Butter', value: '#fef3c7' },
  { label: 'Sage', value: '#dcfce7' },
  { label: 'Sky', value: '#e0f2fe' },
  { label: 'Blush', value: '#fee2e2' },
  { label: 'Lavender', value: '#f3e8ff' },
]

/**
 * Full inline Rich Text Editor with floating formatting bar, list prefixes,
 * quick math symbol insert, and draggable right-edge width handle for wrapping.
 */
export function RichTextInlineEditor({
  draft,
  camera,
  boardTheme,
  containerWidth,
  onChange,
  onCommit,
  onCancel,
}: {
  draft: RichTextDraft
  camera: Camera
  boardTheme: BoardTheme
  containerWidth: number
  onChange: (next: RichTextDraft) => void
  onCommit: (draft: RichTextDraft) => void
  onCancel: () => void
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const el = textareaRef.current
      if (el) {
        el.focus()
        const len = el.value.length
        el.setSelectionRange(len, len)
      }
    })
    return () => cancelAnimationFrame(id)
  }, [])

  const sx = draft.wx * camera.zoom + camera.panX
  const sy = draft.wy * camera.zoom + camera.panY
  const boxW = Math.max(180, draft.w * camera.zoom)
  const boxH = Math.max(54, draft.h * camera.zoom)

  const barWidth = 520
  const barLeft = Math.max(
    8,
    Math.min(Math.max(8, containerWidth - barWidth - 8), sx),
  )
  const barTop = Math.max(8, sy - 50)

  const applyListPrefix = (kind: 'bullet' | 'number') => {
    const lines = draft.value.split('\n')
    const formatted = lines.map((line, i) => {
      const stripped = line.replace(/^(\u2022\s+|\d+\.\s+)/, '')
      return kind === 'bullet' ? `• ${stripped}` : `${i + 1}. ${stripped}`
    })
    onChange({ ...draft, value: formatted.join('\n') })
    textareaRef.current?.focus()
  }

  const insertSymbol = (sym: string) => {
    const el = textareaRef.current
    if (!el) {
      onChange({ ...draft, value: draft.value + sym })
      return
    }
    const start = el.selectionStart ?? draft.value.length
    const end = el.selectionEnd ?? draft.value.length
    const nextVal =
      draft.value.slice(0, start) + sym + draft.value.slice(end)
    onChange({ ...draft, value: nextVal })
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(start + sym.length, start + sym.length)
    })
  }

  const startSideResize = (e: React.PointerEvent) => {
    e.stopPropagation()
    e.preventDefault()
    const startX = e.clientX
    const origW = draft.w
    const onMove = (me: PointerEvent) => {
      const dw = (me.clientX - startX) / camera.zoom
      onChange({ ...draft, w: Math.max(120, Math.round(origW + dw)) })
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const textDecoration =
    [
      draft.underline ? 'underline' : '',
      draft.strikethrough ? 'line-through' : '',
    ]
      .filter(Boolean)
      .join(' ') || 'none'

  return (
    <div
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      className="pointer-events-none absolute inset-0 z-30"
    >
      {/* Floating Rich Text Formatting Bar */}
      <div
        role="toolbar"
        aria-label="Rich text formatting"
        style={{ left: barLeft, top: barTop }}
        className="pointer-events-auto absolute flex max-w-[calc(100%-16px)] flex-wrap items-center gap-1 rounded-xl border border-border bg-card/95 px-2 py-1 text-xs text-card-foreground shadow-lg backdrop-blur-md"
      >
        <select
          aria-label="Font family"
          value={draft.fontFamily}
          onChange={(e) =>
            onChange({ ...draft, fontFamily: e.target.value as FontFamilyKey })
          }
          className="h-7 rounded-md border border-border bg-background px-1.5 text-xs text-foreground"
        >
          {FONT_OPTIONS.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </select>

        <select
          aria-label="Font size"
          value={draft.fontSize}
          onChange={(e) =>
            onChange({ ...draft, fontSize: Number(e.target.value) })
          }
          className="h-7 rounded-md border border-border bg-background px-1.5 text-xs tabular-nums text-foreground"
        >
          {FONT_SIZES.map((sz) => (
            <option key={sz} value={sz}>
              {sz}px
            </option>
          ))}
        </select>

        <span className="mx-0.5 h-4 w-px bg-border" />

        <FmtBtn
          label="Bold"
          active={draft.fontWeight === 'bold'}
          onClick={() =>
            onChange({
              ...draft,
              fontWeight: draft.fontWeight === 'bold' ? 'normal' : 'bold',
            })
          }
        >
          <Bold className="size-3.5" />
        </FmtBtn>
        <FmtBtn
          label="Italic"
          active={draft.fontStyle === 'italic'}
          onClick={() =>
            onChange({
              ...draft,
              fontStyle: draft.fontStyle === 'italic' ? 'normal' : 'italic',
            })
          }
        >
          <Italic className="size-3.5" />
        </FmtBtn>
        <FmtBtn
          label="Underline"
          active={draft.underline}
          onClick={() => onChange({ ...draft, underline: !draft.underline })}
        >
          <Underline className="size-3.5" />
        </FmtBtn>
        <FmtBtn
          label="Strikethrough"
          active={draft.strikethrough}
          onClick={() =>
            onChange({ ...draft, strikethrough: !draft.strikethrough })
          }
        >
          <Strikethrough className="size-3.5" />
        </FmtBtn>

        <span className="mx-0.5 h-4 w-px bg-border" />

        {/* Text color picker */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Text color"
              title="Text color"
              className="grid size-7 place-items-center rounded-md hover:bg-muted"
            >
              <span
                className="size-4 rounded-full border border-black/20"
                style={{ background: draft.color }}
              />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="flex w-44 flex-wrap gap-1.5 p-2">
            {BOARD_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Text color ${c}`}
                onClick={() => onChange({ ...draft, color: c })}
                className={cn(
                  'size-5 rounded-full border border-black/15',
                  draft.color === c && 'ring-2 ring-ring',
                )}
                style={{ background: c }}
              />
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Highlight / Background fill */}
        {draft.kind === 'text' && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Text highlight fill"
                title="Text background highlight"
                className="grid size-7 place-items-center rounded-md hover:bg-muted"
              >
                <Highlighter className="size-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="flex w-44 flex-wrap gap-1.5 p-2">
              {HIGHLIGHT_FILLS.map((h) => (
                <button
                  key={h.label}
                  type="button"
                  title={h.label}
                  onClick={() => onChange({ ...draft, textBg: h.value })}
                  className={cn(
                    'size-5 rounded border border-border',
                    draft.textBg === h.value && 'ring-2 ring-ring',
                  )}
                  style={{
                    background:
                      h.value === 'transparent'
                        ? 'repeating-linear-gradient(45deg,#ccc,#ccc 2px,#fff 2px,#fff 4px)'
                        : h.value,
                  }}
                />
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        <span className="mx-0.5 h-4 w-px bg-border" />

        <FmtBtn
          label="Align left"
          active={draft.textAlign === 'left'}
          onClick={() => onChange({ ...draft, textAlign: 'left' })}
        >
          <AlignLeft className="size-3.5" />
        </FmtBtn>
        <FmtBtn
          label="Align center"
          active={draft.textAlign === 'center'}
          onClick={() => onChange({ ...draft, textAlign: 'center' })}
        >
          <AlignCenter className="size-3.5" />
        </FmtBtn>
        <FmtBtn
          label="Align right"
          active={draft.textAlign === 'right'}
          onClick={() => onChange({ ...draft, textAlign: 'right' })}
        >
          <AlignRight className="size-3.5" />
        </FmtBtn>

        <FmtBtn
          label="Bulleted list"
          onClick={() => applyListPrefix('bullet')}
        >
          <List className="size-3.5" />
        </FmtBtn>
        <FmtBtn
          label="Numbered list"
          onClick={() => applyListPrefix('number')}
        >
          <ListOrdered className="size-3.5" />
        </FmtBtn>

        {/* Quick Math Symbols */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Insert math symbol"
              title="Insert math symbol"
              className="grid size-7 place-items-center rounded-md hover:bg-muted"
            >
              <Sigma className="size-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="grid w-52 grid-cols-6 gap-1 p-2">
            {MATH_SYMBOLS.map((sym) => (
              <button
                key={sym}
                type="button"
                onClick={() => insertSymbol(sym)}
                className="grid size-7 place-items-center rounded-md text-sm font-medium hover:bg-muted"
              >
                {sym}
              </button>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <button
          type="button"
          aria-label="Finish editing text"
          onClick={() => onCommit(draft)}
          className="ml-1 flex h-7 items-center gap-1 rounded-md bg-primary px-2 text-xs font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Check className="size-3.5" /> Done
        </button>
      </div>

      {/* Inline Textarea + Live Right-Edge Wrapping Resize Handle */}
      <div
        style={{ left: sx, top: sy, width: boxW, minHeight: boxH }}
        className="pointer-events-auto absolute"
      >
        <textarea
          ref={textareaRef}
          autoFocus
          aria-label="Text"
          value={draft.value}
          onChange={(e) => {
            const el = e.currentTarget
            el.style.height = 'auto'
            const nextPx = Math.max(boxH, el.scrollHeight)
            el.style.height = `${nextPx}px`
            onChange({
              ...draft,
              value: e.target.value,
              h: Math.max(draft.h, Math.round(nextPx / camera.zoom)),
            })
          }}
          style={{
            width: '100%',
            minHeight: boxH,
            fontFamily: resolveFontStack(draft.fontFamily),
            fontSize: draft.fontSize * camera.zoom,
            fontWeight: draft.fontWeight === 'bold' ? 700 : 500,
            fontStyle: draft.fontStyle,
            textDecoration,
            textAlign: draft.textAlign,
            background:
              draft.kind === 'sticky'
                ? draft.stickyBg || '#fef3c7'
                : draft.textBg && draft.textBg !== 'transparent'
                  ? draft.textBg
                  : boardTheme === 'dark'
                    ? 'rgba(23,31,27,0.92)'
                    : 'rgba(250,249,245,0.95)',
            color: draft.kind === 'sticky' ? '#1f2924' : draft.color,
          }}
          className="block w-full resize-y rounded-lg border-2 border-primary p-2 leading-snug shadow-lg outline-none"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              onCancel()
            } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              onCommit(draft)
            }
          }}
          placeholder={
            draft.kind === 'sticky'
              ? 'Write sticky note…'
              : 'Type text (Ctrl+Enter to finish)'
          }
        />
        {/* Side resize handle for live text wrapping */}
        <div
          role="separator"
          aria-label="Resize text width"
          title="Drag to resize text wrapping width"
          onPointerDown={startSideResize}
          className="absolute -right-2 top-1/2 h-7 w-3 -translate-y-1/2 cursor-ew-resize rounded-full border border-primary bg-card shadow-sm"
        />
      </div>
    </div>
  )
}

function FmtBtn({
  label,
  active,
  onClick,
  children,
}: {
  label: string
  active?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'grid size-7 place-items-center rounded-md transition-colors',
        active
          ? 'bg-primary text-primary-foreground'
          : 'text-foreground hover:bg-muted',
      )}
    >
      {children}
    </button>
  )
}
