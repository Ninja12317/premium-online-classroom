import type { IceServer } from '@/lib/meeting-types'

/**
 * STUN/TURN servers for direct browser-to-browser WebRTC connections.
 */
export function getIceServers(): IceServer[] {
  const servers: IceServer[] = [
    {
      urls: [
        'stun:stun.l.google.com:19302',
        'stun:stun1.l.google.com:19302',
        'stun:stun2.l.google.com:19302',
        'stun:stun3.l.google.com:19302',
        'stun:stun4.l.google.com:19302',
      ],
    },
  ]
  const turnUrl =
    typeof import.meta !== 'undefined' && import.meta.env?.VITE_TURN_URL
      ? String(import.meta.env.VITE_TURN_URL)
      : undefined
  if (turnUrl) {
    servers.push({
      urls: turnUrl
        .split(',')
        .map((u) => u.trim())
        .filter(Boolean),
      username: import.meta.env?.VITE_TURN_USERNAME
        ? String(import.meta.env.VITE_TURN_USERNAME)
        : undefined,
      credential: import.meta.env?.VITE_TURN_CREDENTIAL
        ? String(import.meta.env.VITE_TURN_CREDENTIAL)
        : undefined,
    })
  } else {
    servers.push({
      urls: [
        'turn:openrelay.metered.ca:80',
        'turn:openrelay.metered.ca:443',
        'turns:openrelay.metered.ca:443',
      ],
      username: 'openrelayproject',
      credential: 'openrelayproject',
    })
  }
  return servers
}
