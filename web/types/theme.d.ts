import type { Theme } from '../lib/theme'

declare global {
  interface Window {
    __SPF_THEME?: Theme
  }
}

export {}
