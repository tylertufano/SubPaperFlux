import '@testing-library/jest-dom/vitest'
import { expect, vi } from 'vitest'
import { toHaveNoViolations } from 'jest-axe'

expect.extend(toHaveNoViolations)

vi.mock('sanitize-html', () => {
  const sanitize = ((html: string) => html) as any
  sanitize.defaults = { allowedTags: [], allowedAttributes: {} }
  return {
    __esModule: true,
    default: sanitize,
  }
})

declare module 'vitest' {
  interface Assertion<T = any> {
    toHaveNoViolations(): T
  }

  interface AsymmetricMatchersContaining {
    toHaveNoViolations(): void
  }
}
