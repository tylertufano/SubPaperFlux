export function isValidUrl(value: string): boolean {
  try { new URL(value); return true } catch { return false }
}

export function parseJsonSafe<T = any>(value: string): { ok: true; data: T } | { ok: false; error: string } {
  try { return { ok: true, data: JSON.parse(value) } } catch (e: any) { return { ok: false, error: e?.message || 'Invalid JSON' } }
}

export function validateCredential(
  kind: string,
  data: any,
  description?: string,
  siteConfigId?: string | null,
): string | null {
  const trimmedDescription = typeof description === 'string' ? description.trim() : ''
  if (!trimmedDescription) return 'description is required'
  if (!data || typeof data !== 'object') return 'Data must be a JSON object'
  if (kind === 'site_login') {
    const resolvedSiteConfigId = typeof siteConfigId === 'string' ? siteConfigId.trim() : ''
    if (!resolvedSiteConfigId) return 'site_config_id is required'
    const username = typeof data.username === 'string' ? data.username.trim() : ''
    const password = typeof data.password === 'string' ? data.password.trim() : ''
    if (!username) return 'username is required'
    if (!password) return 'password is required'
    return null
  }
  if (kind === 'miniflux') {
    const url = typeof data.miniflux_url === 'string' ? data.miniflux_url.trim() : ''
    const apiKey = typeof data.api_key === 'string' ? data.api_key.trim() : ''
    if (!url || !isValidUrl(url)) return 'miniflux_url is invalid'
    if (!apiKey) return 'api_key is required'
    return null
  }
  if (kind === 'instapaper') {
    const username = typeof data.username === 'string' ? data.username.trim() : ''
    const password = typeof data.password === 'string' ? data.password.trim() : ''
    if (!username) return 'username is required'
    if (!password) return 'password is required'
    return null
  }
  if (kind === 'instapaper_app') {
    const consumerKey = typeof data.consumer_key === 'string' ? data.consumer_key.trim() : ''
    const consumerSecret = typeof data.consumer_secret === 'string' ? data.consumer_secret.trim() : ''
    if (!consumerKey) return 'consumer_key is required'
    if (!consumerSecret) return 'consumer_secret is required'
    return null
  }
  return null
}

export type SeleniumSiteConfigForm = {
  name: string
  site_url: string
  login_type: 'selenium'
  selenium_config: {
    username_selector: string
    password_selector: string
    login_button_selector: string
    post_login_selector?: string
    cookies_to_store?: string
  }
}

export type ApiSiteConfigForm = {
  name: string
  site_url: string
  login_type: 'api'
  api_config: {
    endpoint: string
    method: string
    headers?: string
    body?: string
    cookies?: string
  }
}

export type SiteConfigFormInput = SeleniumSiteConfigForm | ApiSiteConfigForm

export const SUPPORTED_HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const

export type NormalizedSiteConfigPayload =
  | {
      loginType: 'selenium'
      name: string
      siteUrl: string
      seleniumConfig: {
        usernameSelector: string
        passwordSelector: string
        loginButtonSelector: string
        postLoginSelector?: string | null
        cookiesToStore?: string[]
      }
    }
  | {
      loginType: 'api'
      name: string
      siteUrl: string
      apiConfig: {
        endpoint: string
        method: (typeof SUPPORTED_HTTP_METHODS)[number]
        headers?: Record<string, string>
        body?: Record<string, any> | null
        cookies?: Record<string, string>
      }
    }

const HTTP_METHODS = new Set(SUPPORTED_HTTP_METHODS)

export function validateSiteConfig(form: SiteConfigFormInput): {
  errors: Record<string, string>
  payload?: NormalizedSiteConfigPayload
} {
  const errors: Record<string, string> = {}

  const trimmedName = typeof form.name === 'string' ? form.name.trim() : ''
  if (!trimmedName) {
    errors.name = 'site_configs_error_name_required'
  }

  const trimmedUrl = typeof form.site_url === 'string' ? form.site_url.trim() : ''
  if (!trimmedUrl || !isValidUrl(trimmedUrl)) {
    errors.site_url = 'site_configs_error_url_invalid'
  }

  if (form.login_type === 'selenium') {
    const selenium = form.selenium_config || {
      username_selector: '',
      password_selector: '',
      login_button_selector: '',
    }

    const username = selenium.username_selector?.trim() ?? ''
    const password = selenium.password_selector?.trim() ?? ''
    const loginButton = selenium.login_button_selector?.trim() ?? ''
    const postLogin = selenium.post_login_selector?.trim() ?? ''
    const cookiesRaw = selenium.cookies_to_store ?? ''

    if (!username) {
      errors['selenium.username_selector'] = 'site_configs_error_required'
    }
    if (!password) {
      errors['selenium.password_selector'] = 'site_configs_error_required'
    }
    if (!loginButton) {
      errors['selenium.login_button_selector'] = 'site_configs_error_required'
    }

    const cookies = cookiesRaw
      .split(',')
      .map((value) => value.trim())
      .filter((value) => value.length > 0)

    const hasErrors = Object.values(errors).some(Boolean)
    if (hasErrors) {
      return { errors }
    }

    return {
      errors,
      payload: {
        loginType: 'selenium',
        name: trimmedName,
        siteUrl: trimmedUrl,
        seleniumConfig: {
          usernameSelector: username,
          passwordSelector: password,
          loginButtonSelector: loginButton,
          postLoginSelector: postLogin ? postLogin : undefined,
          cookiesToStore: cookies.length > 0 ? cookies : undefined,
        },
      },
    }
  }

  const api = form.api_config || { endpoint: '', method: '' }
  const endpoint = api.endpoint?.trim() ?? ''
  const methodRaw = api.method?.trim().toUpperCase() ?? ''

  if (!endpoint) {
    errors['api.endpoint'] = 'site_configs_error_endpoint_required'
  } else if (!isValidUrl(endpoint)) {
    errors['api.endpoint'] = 'site_configs_error_endpoint_invalid'
  }

  if (!methodRaw) {
    errors['api.method'] = 'site_configs_error_method_required'
  } else if (!HTTP_METHODS.has(methodRaw)) {
    errors['api.method'] = 'site_configs_error_method_invalid'
  }

  let headersObject: Record<string, string> | undefined
  const headersRaw = api.headers?.trim()
  if (headersRaw) {
    const parsed = parseJsonSafe(headersRaw)
    if (!parsed.ok || typeof parsed.data !== 'object' || parsed.data === null || Array.isArray(parsed.data)) {
      errors['api.headers'] = 'site_configs_error_headers_object'
    } else {
      const candidate = parsed.data as Record<string, unknown>
      const invalidEntry = Object.entries(candidate).find(([, value]) => typeof value !== 'string')
      if (invalidEntry) {
        errors['api.headers'] = 'site_configs_error_headers_object'
      } else if (Object.keys(candidate).length > 0) {
        headersObject = candidate as Record<string, string>
      }
    }
  }

  let cookiesObject: Record<string, string> | undefined
  const cookiesRaw = api.cookies?.trim()
  if (cookiesRaw) {
    const parsed = parseJsonSafe(cookiesRaw)
    if (!parsed.ok || typeof parsed.data !== 'object' || parsed.data === null || Array.isArray(parsed.data)) {
      errors['api.cookies'] = 'site_configs_error_cookies_object'
    } else {
      const candidate = parsed.data as Record<string, unknown>
      const invalidEntry = Object.entries(candidate).find(([, value]) => typeof value !== 'string')
      if (invalidEntry) {
        errors['api.cookies'] = 'site_configs_error_cookies_object'
      } else if (Object.keys(candidate).length > 0) {
        cookiesObject = candidate as Record<string, string>
      }
    }
  }

  let bodyObject: Record<string, any> | null | undefined
  const bodyRaw = api.body?.trim()
  if (bodyRaw) {
    const parsed = parseJsonSafe(bodyRaw)
    if (!parsed.ok) {
      errors['api.body'] = 'site_configs_error_body_object'
    } else if (parsed.data === null) {
      bodyObject = null
    } else if (typeof parsed.data !== 'object' || Array.isArray(parsed.data)) {
      errors['api.body'] = 'site_configs_error_body_object'
    } else {
      bodyObject = parsed.data as Record<string, any>
    }
  }

  const hasErrors = Object.values(errors).some(Boolean)
  if (hasErrors) {
    return { errors }
  }

  const payload: NormalizedSiteConfigPayload = {
    loginType: 'api',
    name: trimmedName,
    siteUrl: trimmedUrl,
    apiConfig: {
      endpoint,
      method: methodRaw as NormalizedSiteConfigPayload['apiConfig']['method'],
    },
  }

  if (headersObject) {
    payload.apiConfig.headers = headersObject
  }
  if (cookiesObject) {
    payload.apiConfig.cookies = cookiesObject
  }
  if (bodyObject !== undefined) {
    payload.apiConfig.body = bodyObject
  }

  return { errors, payload }
}

