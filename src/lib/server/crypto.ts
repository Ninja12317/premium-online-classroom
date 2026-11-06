import { createHash, randomBytes } from 'node:crypto'

export function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

export function randomSecret(bytes = 24) {
  return randomBytes(bytes).toString('base64url')
}
