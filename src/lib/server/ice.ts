import type { IceServer } from '@/lib/meeting-types'

/**
 * ICE servers handed to every participant. Public STUN lets peers on
 * different networks discover each other directly, which is enough for most
 * home and office connections. Some mobile carriers and strict firewalls need
 * a TURN relay: set TURN_URL (comma-separated `turn:`/`turns:` URLs),
 * TURN_USERNAME and TURN_CREDENTIAL to use your own. Without them the free
 * Open Relay project is used as a best-effort fallback.
 */
export function iceServers(): IceServer[] {
  const servers: IceServer[] = [
    {
      urls: [
        'stun:stun.l.google.com:19302',
        'stun:stun1.l.google.com:19302',
        'stun:stun.cloudflare.com:3478',
      ],
    },
  ]
  const turnUrl = process.env.TURN_URL
  if (turnUrl) {
    servers.push({
      urls: turnUrl
        .split(',')
        .map((u) => u.trim())
        .filter(Boolean),
      username: process.env.TURN_USERNAME,
      credential: process.env.TURN_CREDENTIAL,
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
