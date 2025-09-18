import { useEffect, useState } from 'react'
import { getUiConfig, readUiConfigFromEnv, type UiConfig } from './openapi'

export type FeatureFlags = Pick<UiConfig, 'userMgmtCore' | 'userMgmtUi'>

function pickFlags(config: UiConfig): FeatureFlags {
  return {
    userMgmtCore: Boolean(config.userMgmtCore),
    userMgmtUi: Boolean(config.userMgmtUi),
  }
}

const initialFlags: FeatureFlags | null =
  typeof window === 'undefined' ? pickFlags(readUiConfigFromEnv()) : null

let cachedFlags: FeatureFlags | null = initialFlags
let flagsPromise: Promise<FeatureFlags> | null = null

export function getCachedFeatureFlags(): FeatureFlags | null {
  return cachedFlags
}

export async function loadFeatureFlags(): Promise<FeatureFlags> {
  if (cachedFlags) {
    return cachedFlags
  }
  if (!flagsPromise) {
    flagsPromise = getUiConfig()
      .then((config) => {
        const flags = pickFlags(config)
        cachedFlags = flags
        return flags
      })
      .finally(() => {
        flagsPromise = null
      })
  }
  return flagsPromise
}

export type FeatureFlagsState = FeatureFlags & { isLoaded: boolean }

export function useFeatureFlags(): FeatureFlagsState {
  const [state, setState] = useState<FeatureFlagsState>(() => {
    if (cachedFlags) {
      return { ...cachedFlags, isLoaded: true }
    }
    if (typeof window === 'undefined') {
      const flags = pickFlags(readUiConfigFromEnv())
      cachedFlags = flags
      return { ...flags, isLoaded: true }
    }
    return { userMgmtCore: false, userMgmtUi: false, isLoaded: false }
  })

  useEffect(() => {
    if (state.isLoaded && cachedFlags) {
      return
    }
    let active = true
    loadFeatureFlags().then((flags) => {
      if (!active) return
      setState({ ...flags, isLoaded: true })
    })
    return () => {
      active = false
    }
  }, [state.isLoaded])

  return state
}

export function resetFeatureFlagsCache() {
  cachedFlags = typeof window === 'undefined' ? pickFlags(readUiConfigFromEnv()) : null
  flagsPromise = null
}
