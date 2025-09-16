import '@testing-library/jest-dom/vitest'
import { expect } from 'vitest'
import { toHaveNoViolations } from 'jest-axe'

expect.extend(toHaveNoViolations)

declare module 'vitest' {
  interface Assertion<T = any> {
    toHaveNoViolations(): T
  }

  interface AsymmetricMatchersContaining {
    toHaveNoViolations(): void
  }
}
