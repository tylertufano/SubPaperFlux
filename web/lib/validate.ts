export function isValidUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
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

type SiteConfigCommonForm = {
  name: string
  site_url: string
  success_text_class: string
  expected_success_text: string
  required_cookies: string
}

export type SeleniumSiteConfigForm = SiteConfigCommonForm & {
  login_type: 'selenium'
  selenium_config: {
    username_selector: string
    password_selector: string
    login_button_selector: string
    post_login_selector?: string
    cookies_to_store?: string
  }
}

export type ApiPayloadMode = 'json' | 'form'

export type ApiCustomBodyValueType = 'string' | 'number' | 'boolean' | 'null' | 'object' | 'array'

export type ApiCustomBodyEntry = {
  id: string
  key: string
  value: string
  valueType?: ApiCustomBodyValueType
}

export type ApiSiteConfigForm = SiteConfigCommonForm & {
  login_type: 'api'
  api_config: {
    login_url: string
    method: string
    login_id_param: string
    password_param: string
    cookies_to_store: string
    headers_object?: Record<string, string>
    additional_body?: Record<string, any>
    cookie_map?: Record<string, string>
    payload_mode: ApiPayloadMode
    custom_body_entries: ApiCustomBodyEntry[]
  }
}

export function coerceCustomBodyEntryValue(entry: ApiCustomBodyEntry): any {
  const value = typeof entry.value === 'string' ? entry.value : ''
  const trimmed = value.trim()
  const type = entry.valueType

  switch (type) {
    case 'boolean':
      if (trimmed === 'true') return true
      if (trimmed === 'false') return false
      return value
    case 'number': {
      if (!trimmed) return value
      const parsed = Number(trimmed)
      return Number.isFinite(parsed) ? parsed : value
    }
    case 'null':
      if (!trimmed || trimmed.toLowerCase() === 'null') return null
      return value
    case 'array':
    case 'object':
      if (!trimmed) return value
      try {
        const parsed = JSON.parse(value)
        if (type === 'array') {
          return Array.isArray(parsed) ? parsed : value
        }
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return parsed
        }
        return value
      } catch (error) {
        return value
      }
    default:
      return value
  }
}

export type SiteConfigFormInput = SeleniumSiteConfigForm | ApiSiteConfigForm

export const SUPPORTED_HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const

type SupportedHttpMethod = (typeof SUPPORTED_HTTP_METHODS)[number]

type NormalizedSiteConfigCommonPayload = {
  name: string
  siteUrl: string
  successTextClass?: string
  expectedSuccessText?: string
  requiredCookies?: string[]
}

export type NormalizedSiteConfigPayload =
  | (NormalizedSiteConfigCommonPayload & {
      loginType: 'selenium'
      seleniumConfig: {
        usernameSelector: string
        passwordSelector: string
        loginButtonSelector: string
        postLoginSelector?: string | null
        cookiesToStore?: string[]
      }
    })
  | (NormalizedSiteConfigCommonPayload & {
      loginType: 'api'
      apiConfig: {
        endpoint: string
        method: (typeof SUPPORTED_HTTP_METHODS)[number]
        headers?: Record<string, string>
        body?: Record<string, any> | null
        cookies?: Record<string, string>
        cookiesToStore?: string[]
      }
    })

const HTTP_METHODS = new Set<string>(SUPPORTED_HTTP_METHODS)

const isSupportedHttpMethod = (method: string): method is SupportedHttpMethod =>
  HTTP_METHODS.has(method)

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

  const successTextClass = typeof form.success_text_class === 'string' ? form.success_text_class.trim() : ''
  const expectedSuccessText = typeof form.expected_success_text === 'string' ? form.expected_success_text.trim() : ''
  const requiredCookiesRaw = typeof form.required_cookies === 'string' ? form.required_cookies : ''
  const requiredCookies = Array.from(
    new Set(
      requiredCookiesRaw
        .split(',')
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
    ),
  )

  if (successTextClass && !expectedSuccessText) {
    errors.expected_success_text = 'site_configs_error_expected_success_text_required'
  }
  if (expectedSuccessText && !successTextClass) {
    errors.success_text_class = 'site_configs_error_success_text_class_required'
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

    if (cookies.length === 0 && requiredCookies.length === 0) {
      errors.required_cookies = 'site_configs_error_required_cookies'
    }

    const hasErrors = Object.values(errors).some(Boolean)
    if (hasErrors) {
      return { errors }
    }

    const payload: NormalizedSiteConfigPayload = {
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
    }

    if (successTextClass) {
      payload.successTextClass = successTextClass
    }
    if (expectedSuccessText) {
      payload.expectedSuccessText = expectedSuccessText
    }
    if (requiredCookies.length > 0) {
      payload.requiredCookies = requiredCookies
    }

    return { errors, payload }
  }

  const api = form.api_config || {
    login_url: '',
    method: '',
    login_id_param: '',
    password_param: '',
    cookies_to_store: '',
    payload_mode: 'json' as ApiPayloadMode,
    custom_body_entries: [],
  }
  const endpoint = api.login_url?.trim() ?? ''
  const methodRaw = api.method?.trim().toUpperCase() ?? ''
  let method: SupportedHttpMethod | undefined

  if (!endpoint) {
    errors['api.login_url'] = 'site_configs_error_login_url_required'
  } else if (!isValidUrl(endpoint)) {
    errors['api.login_url'] = 'site_configs_error_login_url_invalid'
  }

  if (!methodRaw) {
    errors['api.method'] = 'site_configs_error_method_required'
  } else if (!isSupportedHttpMethod(methodRaw)) {
    errors['api.method'] = 'site_configs_error_method_invalid'
  } else {
    method = methodRaw
  }

  const loginIdParam = api.login_id_param?.trim() ?? ''
  if (!loginIdParam) {
    errors['api.login_id_param'] = 'site_configs_error_login_id_required'
  }

  const passwordParam = api.password_param?.trim() ?? ''
  if (!passwordParam) {
    errors['api.password_param'] = 'site_configs_error_password_param_required'
  }

  const cookiesRaw = api.cookies_to_store ?? ''
  const cookiesList = Array.from(
    new Set(
      cookiesRaw
        .split(',')
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
    ),
  )

  if (cookiesList.length === 0 && requiredCookies.length === 0) {
    errors['api.cookies_to_store'] = 'site_configs_error_required_cookies'
    errors.required_cookies = 'site_configs_error_required_cookies'
  }

  const hasErrors = Object.values(errors).some(Boolean)
  if (hasErrors) {
    return { errors }
  }

  if (!method) {
    throw new Error('Invalid state: HTTP method should be defined when no validation errors are present')
  }

  const baseBody: Record<string, any> = {
    [loginIdParam]: '{{username}}',
    [passwordParam]: '{{password}}',
  }
  const customEntries = Array.isArray(api.custom_body_entries) ? api.custom_body_entries : []
  const additionalBody: Record<string, any> = {}
  for (const entry of customEntries) {
    const key = typeof entry?.key === 'string' ? entry.key.trim() : ''
    if (!key) continue
    additionalBody[key] = coerceCustomBodyEntryValue(entry)
  }
  const mergedAdditionalBody =
    api.additional_body && Object.keys(api.additional_body).length > 0
      ? { ...api.additional_body, ...additionalBody }
      : additionalBody
  const bodyPayload = Object.keys(mergedAdditionalBody).length > 0 ? { ...mergedAdditionalBody, ...baseBody } : baseBody

  const payloadMode: ApiPayloadMode = api.payload_mode === 'form' ? 'form' : 'json'

  const desiredContentType =
    payloadMode === 'form' ? 'application/x-www-form-urlencoded' : 'application/json'
  const headerEntries = { ...(api.headers_object ?? {}) }
  let contentTypeKey: string | null = null
  for (const key of Object.keys(headerEntries)) {
    if (key.toLowerCase() === 'content-type') {
      contentTypeKey = key
      break
    }
  }
  if (contentTypeKey && contentTypeKey !== 'Content-Type') {
    headerEntries['Content-Type'] = headerEntries[contentTypeKey]
    delete headerEntries[contentTypeKey]
  }
  headerEntries['Content-Type'] = desiredContentType

  const payload: NormalizedSiteConfigPayload = {
    loginType: 'api',
    name: trimmedName,
    siteUrl: trimmedUrl,
    apiConfig: {
      endpoint,
      method,
      body: bodyPayload,
    },
  }

  if (Object.keys(headerEntries).length > 0) {
    payload.apiConfig.headers = headerEntries
  }
  if (api.cookie_map && Object.keys(api.cookie_map).length > 0) {
    payload.apiConfig.cookies = { ...api.cookie_map }
  }
  if (cookiesList.length > 0) {
    payload.apiConfig.cookiesToStore = cookiesList
  }

  if (successTextClass) {
    payload.successTextClass = successTextClass
  }
  if (expectedSuccessText) {
    payload.expectedSuccessText = expectedSuccessText
  }
  if (requiredCookies.length > 0) {
    payload.requiredCookies = requiredCookies
  }

  return { errors, payload }
}

