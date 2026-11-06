import { AlertTriangle, CameraOff } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import type { MediaErrorKind } from '@/lib/use-local-media'

const copy: Record<MediaErrorKind, { title: string; body: string }> = {
  denied: {
    title: 'Camera and microphone are blocked',
    body: 'Allow access in your browser’s address bar (the camera or lock icon), then reload. You can still join and listen without them.',
  },
  'not-found': {
    title: 'No camera or microphone found',
    body: 'Plug in a device or check it is enabled in your system settings. You can still join to watch and chat.',
  },
  'in-use': {
    title: 'Another app is using your camera',
    body: 'Close other video apps or browser tabs that use the camera, then try again.',
  },
  unsupported: {
    title: 'This browser cannot access media devices',
    body: 'Use a recent version of Chrome, Edge, Safari or Firefox over HTTPS.',
  },
  unknown: {
    title: 'Could not start your camera or microphone',
    body: 'Check your device settings and try again.',
  },
}

export function MediaError({ kind }: { kind: MediaErrorKind }) {
  const c = copy[kind]
  const Icon = kind === 'denied' ? CameraOff : AlertTriangle
  return (
    <Alert className="border-amber/60 bg-amber/10">
      <Icon className="size-4" />
      <AlertTitle>{c.title}</AlertTitle>
      <AlertDescription>{c.body}</AlertDescription>
    </Alert>
  )
}
