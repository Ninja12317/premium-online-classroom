/**
 * Pure Firestore payload sanitizer.
 *
 * Cloud Firestore's Web SDK throws `Unsupported field value: undefined` if ANY
 * nested property inside `setDoc`, `updateDoc`, `addDoc`, or `writeBatch.set`
 * is `undefined`. Stripping `undefined` keys recursively while preserving
 * `null`, primitives, arrays, Dates, and Firestore FieldValue sentinels
 * guarantees whiteboard elements, meeting metadata, and presence writes never
 * fail silently.
 */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

export function stripUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    const cleaned: unknown[] = []
    for (const item of value) {
      if (item !== undefined) {
        cleaned.push(stripUndefinedDeep(item))
      }
    }
    return cleaned as unknown as T
  }

  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) {
      if (v === undefined) continue
      out[k] = stripUndefinedDeep(v)
    }
    return out as T
  }

  // Preserve primitives, null, Date, Firestore FieldValue sentinels (e.g. arrayUnion)
  return value
}
