export function decodeBase64UrlSegment(segment: string): string | null {
  const normalized = segment.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')

  if (typeof globalThis.atob === 'function') {
    try {
      const binary = globalThis.atob(padded)
      try {
        return decodeURIComponent(
          binary
            .split('')
            .map((char) => `%${char.charCodeAt(0).toString(16).padStart(2, '0')}`)
            .join(''),
        )
      } catch {
        return binary
      }
    } catch {
      // continue to Buffer fallback
    }
  }

  const bufferCtor = (globalThis as {
    Buffer?: { from(input: string, encoding: string): { toString(enc: string): string } }
  }).Buffer
  if (bufferCtor) {
    try {
      return bufferCtor.from(padded, 'base64').toString('utf-8')
    } catch {
      return null
    }
  }

  return null
}
