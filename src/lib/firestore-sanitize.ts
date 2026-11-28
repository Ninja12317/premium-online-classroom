/**
 * Deeply strips `undefined` properties from plain objects and arrays before
 * writing to Cloud Firestore, which rejects `undefined` field values with
 * `Unsupported field value: undefined`.
 *
 * Preserves Firestore sentinel values (e.g. `arrayUnion(...)`, `serverTimestamp()`),
 * `Date` instances, `null`, primitives, and nested plain structures.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

export function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    const cleaned: unknown[] = []
    for (const item of value) {
      if (item === undefined) continue
      cleaned.push(stripUndefined(item))
    }
    return cleaned as unknown as T
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) {
      if (v === undefined) continue
      out[k] = stripUndefined(v)
    }
    return out as T
  }
  return value
}
