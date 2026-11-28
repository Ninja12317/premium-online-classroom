import { Check, Copy, Download, MonitorSmartphone, Share, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { InstallPlatformGuidance } from '@/lib/use-pwa-install'

interface InstallAppDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  isInstallable: boolean
  guidance: InstallPlatformGuidance
  onInstallNow: () => Promise<'accepted' | 'dismissed' | 'unavailable'>
}

function getInstructions(guidance: InstallPlatformGuidance): {
  headline: string
  steps: string[]
} {
  switch (guidance) {
    case 'iframe':
      return {
        headline: 'Open in a full browser tab to install',
        steps: [
          'Browsers only enable direct app installation when opened in a top-level tab (not an embedded preview).',
          'Copy the app URL below, open it in Chrome, Edge, or Safari, then tap Install App.',
        ],
      }
    case 'ios-safari':
      return {
        headline: 'Install on iPhone or iPad',
        steps: [
          'Tap the Share icon at the bottom (or top) of Safari.',
          'Scroll down and tap "Add to Home Screen", then tap Add.',
        ],
      }
    case 'ios-other':
      return {
        headline: 'Install on iPhone or iPad',
        steps: [
          'Open this link in Safari (or tap the Share button in your browser toolbar).',
          'Choose "Add to Home Screen" to launch Lectern full-screen like a native app.',
        ],
      }
    case 'android':
      return {
        headline: 'Install on Android',
        steps: [
          'Tap the browser menu (⋮) in the top-right corner.',
          'Tap "Install app" or "Add to Home screen" and confirm.',
        ],
      }
    case 'desktop-safari':
      return {
        headline: 'Install on Mac (Safari)',
        steps: [
          'In the macOS menu bar, click File → Add to Dock… (or click the Share button).',
          'Confirm the name "Lectern" and click Add to launch it from your Dock.',
        ],
      }
    case 'desktop-firefox':
      return {
        headline: 'Install on Desktop',
        steps: [
          'Firefox desktop does not include a built-in app install button.',
          'Open Lectern in Chrome, Edge, or Safari to install it as a standalone desktop app.',
        ],
      }
    case 'desktop-chromium':
    default:
      return {
        headline: 'Install on Desktop (Chrome / Edge)',
        steps: [
          'Click the Install icon on the right side of your browser address bar.',
          'Or open the browser menu (⋮) → Cast, save, and share → Install Lectern.',
        ],
      }
  }
}

export function InstallAppDialog({
  open,
  onOpenChange,
  isInstallable,
  guidance,
  onInstallNow,
}: InstallAppDialogProps) {
  const [installing, setInstalling] = useState(false)
  const [copied, setCopied] = useState(false)
  const { headline, steps } = getInstructions(guidance)

  async function handleInstallClick() {
    setInstalling(true)
    try {
      const outcome = await onInstallNow()
      if (outcome === 'accepted') {
        toast.success('Installing Lectern…')
        onOpenChange(false)
      }
    } finally {
      setInstalling(false)
    }
  }

  async function handleCopyUrl() {
    if (typeof window === 'undefined') return
    try {
      await navigator.clipboard.writeText(window.location.origin)
      setCopied(true)
      toast.success('App link copied')
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Could not copy link')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <img
              src="/icon-192.png"
              alt="Lectern app icon"
              className="size-12 shrink-0 rounded-xl border border-border/60 shadow-xs"
            />
            <div className="min-w-0">
              <DialogTitle>Install Lectern</DialogTitle>
              <DialogDescription>
                Launch classes &amp; whiteboards full-screen from your home screen or dock.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {isInstallable ? (
          <div className="space-y-4">
            <div className="flex items-start gap-2.5 rounded-xl border border-primary/20 bg-primary/8 p-3.5 text-xs text-foreground">
              <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" />
              <p className="leading-relaxed">
                Ready to install directly on this device — opens in its own clean window with no browser clutter.
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Not now
              </Button>
              <Button
                type="button"
                disabled={installing}
                onClick={() => void handleInstallClick()}
                className="gap-1.5"
              >
                <Download className="size-4" />
                {installing ? 'Opening prompt…' : 'Install App'}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl border border-border/80 bg-muted/50 p-3.5">
              <p className="mb-2 flex items-center gap-2 text-xs font-semibold text-foreground">
                {guidance === 'ios-safari' ? (
                  <Share className="size-3.5 text-primary" />
                ) : (
                  <MonitorSmartphone className="size-3.5 text-primary" />
                )}
                {headline}
              </p>
              <ol className="space-y-1.5 text-xs leading-relaxed text-muted-foreground">
                {steps.map((step, i) => (
                  <li key={step} className="flex items-start gap-2">
                    <span className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-full bg-primary/14 text-[10px] font-semibold text-primary">
                      {i + 1}
                    </span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2">
              {(guidance === 'iframe' || guidance === 'desktop-firefox') && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void handleCopyUrl()}
                  className="gap-1.5"
                >
                  {copied ? (
                    <Check className="size-4 text-primary" />
                  ) : (
                    <Copy className="size-4" />
                  )}
                  {copied ? 'Copied link' : 'Copy app link'}
                </Button>
              )}
              <Button type="button" onClick={() => onOpenChange(false)}>
                Got it
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
