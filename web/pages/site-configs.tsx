import useSWR from 'swr'
import { Alert, Breadcrumbs, EmptyState, InlineTip, Nav } from '../components'
import {
  v1,
  siteConfigs as site,
  type SiteConfigCopyResponse,
  type SiteConfigRecord,
  type SiteConfigRequest,
} from '../lib/openapi'
import { useMemo, useState } from 'react'
import {
  isValidUrl,
  validateSiteConfig,
  type SiteConfigFormInput,
  type SeleniumSiteConfigForm,
  type ApiSiteConfigForm,
  type NormalizedSiteConfigPayload,
  SUPPORTED_HTTP_METHODS,
} from '../lib/validate'
import { useI18n } from '../lib/i18n'
import { buildBreadcrumbs } from '../lib/breadcrumbs'
import { useRouter } from 'next/router'
import type { SiteConfigsPage } from '../sdk/src/models/SiteConfigsPage'
import type { SiteConfigApiOut } from '../sdk/src/models/SiteConfigApiOut'
import { SiteConfigApiOutFromJSON } from '../sdk/src/models/SiteConfigApiOut'
import type { SiteConfigSeleniumOut } from '../sdk/src/models/SiteConfigSeleniumOut'
import { SiteConfigSeleniumOutFromJSON } from '../sdk/src/models/SiteConfigSeleniumOut'

const API_METHOD_OPTIONS = SUPPORTED_HTTP_METHODS
const API_METHOD_SET = new Set(API_METHOD_OPTIONS)

type SiteConfigFormState = (SiteConfigFormInput & { id?: string; ownerUserId?: string | null })

type SeleniumFormState = Extract<SiteConfigFormState, { login_type: 'selenium' }>
type ApiFormState = Extract<SiteConfigFormState, { login_type: 'api' }>

type LocalizedErrors = Record<string, string>

type SiteConfigList = SiteConfigsPage | Array<SiteConfigRecord>

type LoginType = 'selenium' | 'api'

function createEmptyForm(loginType: LoginType): SiteConfigFormState {
  if (loginType === 'selenium') {
    const base: SeleniumSiteConfigForm = {
      name: '',
      site_url: '',
      success_text_class: '',
      expected_success_text: '',
      required_cookies: '',
      login_type: 'selenium',
      selenium_config: {
        username_selector: '',
        password_selector: '',
        login_button_selector: '',
        post_login_selector: '',
        cookies_to_store: '',
      },
    }
    return base
  }
  const base: ApiSiteConfigForm = {
    name: '',
    site_url: '',
    success_text_class: '',
    expected_success_text: '',
    required_cookies: '',
    login_type: 'api',
    api_config: {
      endpoint: '',
      method: 'POST',
      headers: '',
      body: '',
      cookies: '',
    },
  }
  return base
}

function isSeleniumConfig(value: any): value is SiteConfigSeleniumOut {
  if (!value || typeof value !== 'object') return false
  if ('loginType' in value && (value as any).loginType === 'selenium') return true
  if ('seleniumConfig' in value && value.seleniumConfig) return true
  return false
}

function isApiConfig(value: any): value is SiteConfigApiOut {
  if (!value || typeof value !== 'object') return false
  if ('loginType' in value && (value as any).loginType === 'api') return true
  if ('apiConfig' in value && value.apiConfig) return true
  return false
}

function normalizeSeleniumConfig(config: SiteConfigSeleniumOut): SiteConfigFormState {
  const cookies = config.seleniumConfig?.cookiesToStore ?? []
  return {
    id: config.id,
    ownerUserId: config.ownerUserId ?? null,
    name: config.name,
    site_url: config.siteUrl,
    success_text_class: config.successTextClass ?? '',
    expected_success_text: config.expectedSuccessText ?? '',
    required_cookies: config.requiredCookies?.length ? config.requiredCookies.join(',') : '',
    login_type: 'selenium',
    selenium_config: {
      username_selector: config.seleniumConfig?.usernameSelector ?? '',
      password_selector: config.seleniumConfig?.passwordSelector ?? '',
      login_button_selector: config.seleniumConfig?.loginButtonSelector ?? '',
      post_login_selector: config.seleniumConfig?.postLoginSelector ?? '',
      cookies_to_store: cookies.length ? cookies.join(',') : '',
    },
  }
}

function normalizeApiConfig(config: SiteConfigApiOut): SiteConfigFormState {
  const stringify = (value: Record<string, any> | null | undefined) => {
    if (value == null) return value === null ? 'null' : ''
    try {
      return JSON.stringify(value, null, 2)
    } catch {
      return ''
    }
  }
  return {
    id: config.id,
    ownerUserId: config.ownerUserId ?? null,
    name: config.name,
    site_url: config.siteUrl,
    success_text_class: config.successTextClass ?? '',
    expected_success_text: config.expectedSuccessText ?? '',
    required_cookies: config.requiredCookies?.length ? config.requiredCookies.join(',') : '',
    login_type: 'api',
    api_config: {
      endpoint: config.apiConfig?.endpoint ?? '',
      method: (config.apiConfig?.method ?? 'POST').toUpperCase(),
      headers: stringify(config.apiConfig?.headers as Record<string, string> | undefined),
      body: stringify(config.apiConfig?.body as Record<string, any> | null | undefined),
      cookies: stringify(config.apiConfig?.cookies as Record<string, string> | undefined),
    },
  }
}

function toFormState(config: SiteConfigSeleniumOut | SiteConfigApiOut): SiteConfigFormState {
  if (isApiConfig(config)) return normalizeApiConfig(config)
  return normalizeSeleniumConfig(config)
}

function localizeErrors(errors: Record<string, string>, translate: ReturnType<typeof useI18n>['t']): LocalizedErrors {
  const result: LocalizedErrors = {}
  for (const [key, value] of Object.entries(errors)) {
    if (!value) continue
    result[key] = translate(value as any)
  }
  return result
}

function firstErrorMessage(errors: LocalizedErrors): string | undefined {
  return Object.values(errors).find((message) => Boolean(message && message.trim()))
}

function isFormReady(form: SiteConfigFormState): boolean {
  if (!form.name?.trim()) return false
  if (!form.site_url?.trim() || !isValidUrl(form.site_url)) return false
  const requiredCookiesRaw = form.required_cookies ?? ''
  const hasRequiredCookies = requiredCookiesRaw
    .split(',')
    .map((value) => value.trim())
    .some((value) => value.length > 0)
  if (form.login_type === 'selenium') {
    const config = form.selenium_config
    if (!config?.username_selector?.trim()) return false
    if (!config?.password_selector?.trim()) return false
    if (!config?.login_button_selector?.trim()) return false
    const storedCookiesRaw = config?.cookies_to_store ?? ''
    const hasStoredCookies = storedCookiesRaw
      .split(',')
      .map((value) => value.trim())
      .some((value) => value.length > 0)
    return hasStoredCookies || hasRequiredCookies
  }
  const config = form.api_config
  const endpoint = config?.endpoint?.trim()
  const method = config?.method?.trim().toUpperCase()
  if (!endpoint || !isValidUrl(endpoint)) return false
  if (!method || !API_METHOD_SET.has(method as (typeof API_METHOD_OPTIONS)[number])) return false
  const storedCookiesRaw = config?.cookies ?? ''
  const hasStoredCookies = Boolean(storedCookiesRaw.trim())
  return hasStoredCookies || hasRequiredCookies
}

function prepareSubmission(
  form: SiteConfigFormState,
  translate: ReturnType<typeof useI18n>['t'],
): { submission?: SiteConfigRequest; errors: LocalizedErrors; payload?: NormalizedSiteConfigPayload } {
  const result = validateSiteConfig(form)
  const errors = localizeErrors(result.errors, translate)
  if (!result.payload) {
    return { errors }
  }
  const submission = { ...result.payload } as SiteConfigRequest
  return { errors, submission, payload: result.payload }
}

export default function SiteConfigs() {
  const { t } = useI18n()
  const router = useRouter()
  const breadcrumbs = useMemo(() => buildBreadcrumbs(router.pathname, t), [router.pathname, t])
  const { data, error, isLoading, mutate } = useSWR(['/v1/site-configs'], async (): Promise<SiteConfigList> =>
    v1.listSiteConfigsV1V1SiteConfigsGet({}),
  )
  const [form, setForm] = useState<SiteConfigFormState>(() => createEmptyForm('selenium'))
  const [createErrors, setCreateErrors] = useState<LocalizedErrors>({})
  const [scopeGlobal, setScopeGlobal] = useState(false)
  const [banner, setBanner] = useState<{ kind: 'success' | 'error'; message: string } | null>(null)
  const [copyingId, setCopyingId] = useState<string | null>(null)
  const [editing, setEditing] = useState<SiteConfigFormState | null>(null)
  const [editErrors, setEditErrors] = useState<LocalizedErrors>({})

  function updateCreateLoginType(type: LoginType) {
    setForm((current) => {
      if (current.login_type === type) return current
      const next = createEmptyForm(type)
      next.name = current.name
      next.site_url = current.site_url
      next.success_text_class = current.success_text_class
      next.expected_success_text = current.expected_success_text
      next.required_cookies = current.required_cookies
      return next
    })
    setCreateErrors({})
  }

  function updateEditLoginType(type: LoginType) {
    setEditing((current) => {
      if (!current) return current
      if (current.login_type === type) return current
      const next = createEmptyForm(type)
      next.name = current.name
      next.site_url = current.site_url
      next.id = current.id
      next.ownerUserId = current.ownerUserId
      next.success_text_class = current.success_text_class
      next.expected_success_text = current.expected_success_text
      next.required_cookies = current.required_cookies
      return next
    })
    setEditErrors({})
  }

  async function create() {
    const { submission, errors, payload } = prepareSubmission(form, t)
    setCreateErrors(errors)
    if (!submission || !payload) {
      const message = firstErrorMessage(errors) || t('site_configs_error_invalid_form')
      setBanner({ kind: 'error', message })
      return
    }
    submission.ownerUserId = scopeGlobal ? null : undefined
    try {
      await site.createSiteConfigSiteConfigsPost({ body: submission })
      setForm(createEmptyForm(form.login_type))
      setScopeGlobal(false)
      setCreateErrors({})
      setBanner({ kind: 'success', message: t('site_configs_create_success') })
      await mutate()
    } catch (err: any) {
      setBanner({ kind: 'error', message: err?.message || String(err) })
    }
  }

  async function del(id: string) {
    if (!confirm(t('site_configs_confirm_delete'))) return
    try {
      await site.deleteSiteConfigSiteConfigsConfigIdDelete({ configId: id })
      setBanner({ kind: 'success', message: t('site_configs_delete_success') })
      await mutate()
    } catch (err: any) {
      setBanner({ kind: 'error', message: err?.message || String(err) })
    }
  }

  async function copyToUser(configId: string) {
    setBanner(null)
    setCopyingId(configId)
    try {
      const copied: SiteConfigCopyResponse = await site.copySiteConfigToUser({ configId })
      const normalizedCopied = normalizeListItem(copied)
      const appendConfig = (candidate: any) => {
        const list: SiteConfigRecord[] = Array.isArray(candidate)
          ? candidate.map(normalizeListItem)
          : []
        const exists = list.some((item) => item?.id === normalizedCopied.id)
        return exists ? { list, added: false } : { list: [...list, normalizedCopied], added: true }
      }
      const applyToPage = (page: SiteConfigList) => {
        if (!page || typeof page !== 'object' || !('items' in page)) return page
        const { list, added } = appendConfig((page as SiteConfigsPage).items)
        if (!added) return page
        const nextTotal = typeof (page as SiteConfigsPage).total === 'number' ? (page as SiteConfigsPage).total + 1 : (page as SiteConfigsPage).total
        return { ...(page as SiteConfigsPage), items: list, total: nextTotal }
      }
      await mutate((current: SiteConfigList | undefined) => {
        if (Array.isArray(current)) {
          const { list, added } = appendConfig(current)
          return added ? list : current
        }
        if (current && typeof current === 'object') {
          return applyToPage(current)
        }
        if (current == null) {
          if (Array.isArray(data)) {
            const { list, added } = appendConfig(data)
            return added ? list : data
          }
          if (data && typeof data === 'object') {
            return applyToPage(data)
          }
        }
        return current as any
      }, { revalidate: false })
      setBanner({ kind: 'success', message: t('copy_to_workspace_success') })
    } catch (err: any) {
      const reason = err?.message || String(err)
      setBanner({ kind: 'error', message: t('copy_to_workspace_error', { reason }) })
    } finally {
      setCopyingId(null)
    }
  }

  async function saveEditing() {
    if (!editing) return
    const { submission, errors, payload } = prepareSubmission(editing, t)
    setEditErrors(errors)
    if (!submission || !payload || !editing.id) {
      const message = firstErrorMessage(errors) || t('site_configs_error_invalid_form')
      setBanner({ kind: 'error', message })
      return
    }
    submission.id = editing.id
    submission.ownerUserId = editing.ownerUserId ?? null
    try {
      await site.updateSiteConfigSiteConfigsConfigIdPut({ configId: editing.id, body: submission })
      setBanner({ kind: 'success', message: t('site_configs_update_success') })
      setEditing(null)
      setEditErrors({})
      await mutate()
    } catch (err: any) {
      setBanner({ kind: 'error', message: err?.message || String(err) })
    }
  }

  const hasCommaSeparatedValues = (value: string | undefined) =>
    (value ?? '')
      .split(',')
      .map((part) => part.trim())
      .some((part) => part.length > 0)

  const hasAnyCookies = (
    state: SiteConfigFormState,
    overrides: { stored?: string; required?: string } = {},
  ) => {
    const requiredRaw = overrides.required ?? state.required_cookies ?? ''
    if (hasCommaSeparatedValues(requiredRaw)) {
      return true
    }
    if (state.login_type === 'selenium') {
      const storedRaw = overrides.stored ?? state.selenium_config?.cookies_to_store ?? ''
      return hasCommaSeparatedValues(storedRaw)
    }
    const storedRaw = overrides.stored ?? state.api_config?.cookies ?? ''
    return Boolean(storedRaw.trim())
  }

  const renderSeleniumFields = (
    current: SeleniumFormState,
    errors: LocalizedErrors,
    onChange: (updater: (prev: SiteConfigFormState) => SiteConfigFormState) => void,
    setErrors: (updater: (prev: LocalizedErrors) => LocalizedErrors) => void,
    prefix: 'create' | 'edit',
  ) => {
    const config = current.selenium_config
    const update = (updater: (prev: SeleniumFormState) => SeleniumFormState) => {
      onChange((prev) => updater(prev as SeleniumFormState))
    }
    const idPrefix = `${prefix}-site-config`
    return (
      <>
        <div>
          <input
            id={`${idPrefix}-username-selector`}
            className="input"
            placeholder={t('site_configs_field_username_selector_placeholder')}
            aria-label={t('site_configs_field_username_selector_placeholder')}
            aria-invalid={Boolean(errors['selenium.username_selector'])}
            aria-describedby={errors['selenium.username_selector'] ? `${idPrefix}-username-selector-error` : undefined}
            value={config?.username_selector ?? ''}
            onChange={(e) => {
              const value = e.target.value
              update((prev) => ({
                ...prev,
                selenium_config: { ...prev.selenium_config, username_selector: value },
              }))
              setErrors((prev) => ({ ...prev, 'selenium.username_selector': value.trim() ? '' : t('site_configs_error_required') }))
            }}
          />
          {errors['selenium.username_selector'] && (
            <div id={`${idPrefix}-username-selector-error`} className="text-sm text-red-600">{errors['selenium.username_selector']}</div>
          )}
        </div>
        <div>
          <input
            id={`${idPrefix}-password-selector`}
            className="input"
            placeholder={t('site_configs_field_password_selector_placeholder')}
            aria-label={t('site_configs_field_password_selector_placeholder')}
            aria-invalid={Boolean(errors['selenium.password_selector'])}
            aria-describedby={errors['selenium.password_selector'] ? `${idPrefix}-password-selector-error` : undefined}
            value={config?.password_selector ?? ''}
            onChange={(e) => {
              const value = e.target.value
              update((prev) => ({
                ...prev,
                selenium_config: { ...prev.selenium_config, password_selector: value },
              }))
              setErrors((prev) => ({ ...prev, 'selenium.password_selector': value.trim() ? '' : t('site_configs_error_required') }))
            }}
          />
          {errors['selenium.password_selector'] && (
            <div id={`${idPrefix}-password-selector-error`} className="text-sm text-red-600">{errors['selenium.password_selector']}</div>
          )}
        </div>
        <div>
          <input
            id={`${idPrefix}-login-selector`}
            className="input"
            placeholder={t('site_configs_field_login_selector_placeholder')}
            aria-label={t('site_configs_field_login_selector_placeholder')}
            aria-invalid={Boolean(errors['selenium.login_button_selector'])}
            aria-describedby={errors['selenium.login_button_selector'] ? `${idPrefix}-login-selector-error` : undefined}
            value={config?.login_button_selector ?? ''}
            onChange={(e) => {
              const value = e.target.value
              update((prev) => ({
                ...prev,
                selenium_config: { ...prev.selenium_config, login_button_selector: value },
              }))
              setErrors((prev) => ({ ...prev, 'selenium.login_button_selector': value.trim() ? '' : t('site_configs_error_required') }))
            }}
          />
          {errors['selenium.login_button_selector'] && (
            <div id={`${idPrefix}-login-selector-error`} className="text-sm text-red-600">{errors['selenium.login_button_selector']}</div>
          )}
        </div>
        <div>
          <input
            id={`${idPrefix}-post-login-selector`}
            className="input"
            placeholder={t('site_configs_field_post_login_selector_placeholder')}
            aria-label={t('site_configs_field_post_login_selector_placeholder')}
            value={config?.post_login_selector ?? ''}
            onChange={(e) => {
              const value = e.target.value
              update((prev) => ({
                ...prev,
                selenium_config: { ...prev.selenium_config, post_login_selector: value },
              }))
            }}
          />
        </div>
        <input
          id={`${idPrefix}-cookies`}
          className="input md:col-span-2"
          placeholder={t('site_configs_field_cookies_placeholder')}
          aria-label={t('site_configs_field_cookies_placeholder')}
          value={config?.cookies_to_store ?? ''}
          onChange={(e) => {
            const value = e.target.value
            update((prev) => ({
              ...prev,
              selenium_config: { ...prev.selenium_config, cookies_to_store: value },
            }))
            setErrors((prev) => ({
              ...prev,
              required_cookies: hasAnyCookies(current, { stored: value })
                ? ''
                : t('site_configs_error_required_cookies'),
            }))
          }}
        />
      </>
    )
  }

  const renderApiFields = (
    current: ApiFormState,
    errors: LocalizedErrors,
    onChange: (updater: (prev: SiteConfigFormState) => SiteConfigFormState) => void,
    setErrors: (updater: (prev: LocalizedErrors) => LocalizedErrors) => void,
    prefix: 'create' | 'edit',
  ) => {
    const config = current.api_config
    const update = (updater: (prev: ApiFormState) => ApiFormState) => {
      onChange((prev) => updater(prev as ApiFormState))
    }
    const idPrefix = `${prefix}-site-config`
    return (
      <>
        <div>
          <input
            id={`${idPrefix}-endpoint`}
            className="input"
            placeholder={t('site_configs_field_endpoint_placeholder')}
            aria-label={t('site_configs_field_endpoint_placeholder')}
            aria-invalid={Boolean(errors['api.endpoint'])}
            aria-describedby={errors['api.endpoint'] ? `${idPrefix}-endpoint-error` : undefined}
            value={config?.endpoint ?? ''}
          onChange={(e) => {
            const value = e.target.value
            update((prev) => ({ ...prev, api_config: { ...prev.api_config, endpoint: value } }))
            const trimmed = value.trim()
            let message = ''
            if (!trimmed) {
              message = t('site_configs_error_endpoint_required')
            } else if (!isValidUrl(trimmed)) {
              message = t('site_configs_error_endpoint_invalid')
            }
            setErrors((prev) => ({ ...prev, 'api.endpoint': message }))
          }}
        />
          {errors['api.endpoint'] && (
            <div id={`${idPrefix}-endpoint-error`} className="text-sm text-red-600">{errors['api.endpoint']}</div>
          )}
        </div>
        <div>
          <label className="sr-only" htmlFor={`${idPrefix}-method`}>
            {t('site_configs_field_method_placeholder')}
          </label>
          <select
            id={`${idPrefix}-method`}
            className="input"
            value={config?.method ?? 'POST'}
            aria-invalid={Boolean(errors['api.method'])}
            aria-describedby={errors['api.method'] ? `${idPrefix}-method-error` : undefined}
            onChange={(e) => {
              const value = e.target.value.toUpperCase()
              update((prev) => ({ ...prev, api_config: { ...prev.api_config, method: value } }))
              setErrors((prev) => ({ ...prev, 'api.method': '' }))
            }}
          >
            {API_METHOD_OPTIONS.map((method) => (
              <option key={method} value={method}>{method}</option>
            ))}
          </select>
          {errors['api.method'] && (
            <div id={`${idPrefix}-method-error`} className="text-sm text-red-600">{errors['api.method']}</div>
          )}
        </div>
        <div className="md:col-span-2">
          <textarea
            id={`${idPrefix}-headers`}
            className="input h-28"
            placeholder={t('site_configs_field_headers_placeholder')}
            aria-label={t('site_configs_field_headers_placeholder')}
            aria-invalid={Boolean(errors['api.headers'])}
            aria-describedby={errors['api.headers'] ? `${idPrefix}-headers-error` : undefined}
            value={config?.headers ?? ''}
            onChange={(e) => {
              const value = e.target.value
              update((prev) => ({ ...prev, api_config: { ...prev.api_config, headers: value } }))
              setErrors((prev) => ({ ...prev, 'api.headers': '' }))
            }}
          />
          {errors['api.headers'] && (
            <div id={`${idPrefix}-headers-error`} className="text-sm text-red-600">{errors['api.headers']}</div>
          )}
        </div>
        <div className="md:col-span-2">
          <textarea
            id={`${idPrefix}-body`}
            className="input h-28"
            placeholder={t('site_configs_field_body_placeholder')}
            aria-label={t('site_configs_field_body_placeholder')}
            aria-invalid={Boolean(errors['api.body'])}
            aria-describedby={errors['api.body'] ? `${idPrefix}-body-error` : undefined}
            value={config?.body ?? ''}
            onChange={(e) => {
              const value = e.target.value
              update((prev) => ({ ...prev, api_config: { ...prev.api_config, body: value } }))
              setErrors((prev) => ({ ...prev, 'api.body': '' }))
            }}
          />
          {errors['api.body'] && (
            <div id={`${idPrefix}-body-error`} className="text-sm text-red-600">{errors['api.body']}</div>
          )}
        </div>
        <div className="md:col-span-2">
          <textarea
            id={`${idPrefix}-cookies-json`}
            className="input h-28"
            placeholder={t('site_configs_field_cookies_json_placeholder')}
            aria-label={t('site_configs_field_cookies_json_placeholder')}
            aria-invalid={Boolean(errors['api.cookies'])}
            aria-describedby={errors['api.cookies'] ? `${idPrefix}-cookies-json-error` : undefined}
            value={config?.cookies ?? ''}
            onChange={(e) => {
              const value = e.target.value
              update((prev) => ({ ...prev, api_config: { ...prev.api_config, cookies: value } }))
              setErrors((prev) => ({
                ...prev,
                'api.cookies': '',
                required_cookies: hasAnyCookies(current, { stored: value })
                  ? ''
                  : t('site_configs_error_required_cookies'),
              }))
            }}
          />
          {errors['api.cookies'] && (
            <div id={`${idPrefix}-cookies-json-error`} className="text-sm text-red-600">{errors['api.cookies']}</div>
          )}
        </div>
      </>
    )
  }

  const renderSharedFields = (
    current: SiteConfigFormState,
    errors: LocalizedErrors,
    onChange: (updater: (prev: SiteConfigFormState) => SiteConfigFormState) => void,
    setErrors: (updater: (prev: LocalizedErrors) => LocalizedErrors) => void,
    prefix: 'create' | 'edit',
  ) => {
    const idPrefix = `${prefix}-site-config`
    const successClassId = `${idPrefix}-success-text-class`
    const expectedTextId = `${idPrefix}-expected-success-text`
    const requiredCookiesId = `${idPrefix}-required-cookies`
    return (
      <>
        <div>
          <input
            id={successClassId}
            className="input"
            placeholder={t('site_configs_field_success_text_class_placeholder')}
            aria-label={t('site_configs_field_success_text_class_placeholder')}
            aria-invalid={Boolean(errors.success_text_class)}
            aria-describedby={errors.success_text_class ? `${successClassId}-error` : undefined}
            value={current.success_text_class ?? ''}
            onChange={(e) => {
              const value = e.target.value
              onChange((prev) => ({ ...prev, success_text_class: value }))
              const trimmedClass = value.trim()
              const trimmedExpected = (current.expected_success_text ?? '').trim()
              setErrors((prev) => ({
                ...prev,
                success_text_class: trimmedExpected && !trimmedClass
                  ? t('site_configs_error_success_text_class_required')
                  : '',
                expected_success_text: trimmedClass && !trimmedExpected
                  ? t('site_configs_error_expected_success_text_required')
                  : '',
              }))
            }}
          />
          {errors.success_text_class && (
            <div id={`${successClassId}-error`} className="text-sm text-red-600">{errors.success_text_class}</div>
          )}
        </div>
        <div>
          <input
            id={expectedTextId}
            className="input"
            placeholder={t('site_configs_field_expected_success_text_placeholder')}
            aria-label={t('site_configs_field_expected_success_text_placeholder')}
            aria-invalid={Boolean(errors.expected_success_text)}
            aria-describedby={errors.expected_success_text ? `${expectedTextId}-error` : undefined}
            value={current.expected_success_text ?? ''}
            onChange={(e) => {
              const value = e.target.value
              onChange((prev) => ({ ...prev, expected_success_text: value }))
              const trimmedExpected = value.trim()
              const trimmedClass = (current.success_text_class ?? '').trim()
              setErrors((prev) => ({
                ...prev,
                expected_success_text: trimmedClass && !trimmedExpected
                  ? t('site_configs_error_expected_success_text_required')
                  : '',
                success_text_class: trimmedExpected && !trimmedClass
                  ? t('site_configs_error_success_text_class_required')
                  : '',
              }))
            }}
          />
          {errors.expected_success_text && (
            <div id={`${expectedTextId}-error`} className="text-sm text-red-600">{errors.expected_success_text}</div>
          )}
        </div>
        <div className="md:col-span-2">
          <input
            id={requiredCookiesId}
            className="input"
            placeholder={t('site_configs_field_required_cookies_placeholder')}
            aria-label={t('site_configs_field_required_cookies_placeholder')}
            aria-invalid={Boolean(errors.required_cookies)}
            aria-describedby={errors.required_cookies ? `${requiredCookiesId}-error` : undefined}
            value={current.required_cookies ?? ''}
            onChange={(e) => {
              const value = e.target.value
              onChange((prev) => ({ ...prev, required_cookies: value }))
              setErrors((prev) => ({
                ...prev,
                required_cookies: hasAnyCookies(current, { required: value })
                  ? ''
                  : t('site_configs_error_required_cookies'),
              }))
            }}
          />
          {errors.required_cookies && (
            <div id={`${requiredCookiesId}-error`} className="text-sm text-red-600">{errors.required_cookies}</div>
          )}
        </div>
      </>
    )
  }

  function resolveLoginTypeLabel(value: LoginType): string {
    return value === 'api' ? t('site_configs_login_type_api') : t('site_configs_login_type_selenium')
  }

  function resolveLoginType(value: SiteConfigRecord | SiteConfigApiOut | SiteConfigSeleniumOut): LoginType {
    return isApiConfig(value) ? 'api' : 'selenium'
  }

  function normalizeListItem(
    value: SiteConfigRecord | SiteConfigApiOut | SiteConfigSeleniumOut | Record<string, unknown>,
  ): SiteConfigRecord {
    if (isApiConfig(value)) {
      const normalizedApi: SiteConfigRecord = {
        ...(value as SiteConfigApiOut),
        loginType: 'api' as const,
      }
      return normalizedApi
    }
    if (isSeleniumConfig(value)) {
      const normalizedSelenium: SiteConfigRecord = {
        ...(value as SiteConfigSeleniumOut),
        loginType: 'selenium' as const,
      }
      return normalizedSelenium
    }
    if (value && typeof value === 'object') {
      if ('api_config' in value) {
        return normalizeListItem(SiteConfigApiOutFromJSON(value))
      }
      if ('selenium_config' in value) {
        return normalizeListItem(SiteConfigSeleniumOutFromJSON(value))
      }
      if ('login_type' in value) {
        const loginTypeRaw = value['login_type']
        const loginType = loginTypeRaw === 'api' ? 'api' : 'selenium'
        return normalizeListItem({ ...value, loginType } as SiteConfigRecord)
      }
    }
    return value as unknown as SiteConfigRecord
  }

  const listItems = Array.isArray(data)
    ? (data as Array<SiteConfigRecord | Record<string, unknown>>).map((item) => normalizeListItem(item))
    : (data as SiteConfigsPage | undefined)?.items?.map((item: any) => normalizeListItem(item)) ?? []

  return (
    <div>
      <Nav />
      <Breadcrumbs items={breadcrumbs} />
      <main className="container py-6">
        <h2 id="site-configs-heading" className="text-xl font-semibold mb-3">{t('site_configs_title')}</h2>
        {banner && (
          <div className="mb-3">
            <Alert kind={banner.kind} message={banner.message} onClose={() => setBanner(null)} />
          </div>
        )}
        {isLoading && <p className="text-gray-600">{t('loading_text')}</p>}
        {error && <Alert kind="error" message={String(error)} />}
        <form
          id="create-site-config"
          className="card p-4 mb-4 grid grid-cols-1 md:grid-cols-2 gap-2"
          role="form"
          aria-labelledby="create-site-config-heading"
          onSubmit={(e) => { e.preventDefault(); create() }}
        >
          <h3 id="create-site-config-heading" className="font-semibold md:col-span-2">
            {t('site_configs_create_heading')}
            <InlineTip className="ml-2" message={t('site_configs_create_tip')} />
          </h3>
          <div className="md:col-span-2">
            <fieldset>
              <legend className="text-sm font-medium mb-1">{t('site_configs_field_login_type_label')}</legend>
              <div className="flex flex-wrap gap-4">
                <label className="inline-flex items-center gap-2">
                  <input
                    type="radio"
                    name="create-login-type"
                    value="selenium"
                    checked={form.login_type === 'selenium'}
                    onChange={() => updateCreateLoginType('selenium')}
                  />
                  {t('site_configs_login_type_selenium')}
                </label>
                <label className="inline-flex items-center gap-2">
                  <input
                    type="radio"
                    name="create-login-type"
                    value="api"
                    checked={form.login_type === 'api'}
                    onChange={() => updateCreateLoginType('api')}
                  />
                  {t('site_configs_login_type_api')}
                </label>
              </div>
            </fieldset>
          </div>
          <div>
            <input
              id="create-site-config-name"
              className="input"
              placeholder={t('site_configs_field_name_placeholder')}
              aria-label={t('site_configs_field_name_placeholder')}
              aria-invalid={Boolean(createErrors.name)}
              aria-describedby={createErrors.name ? 'create-site-config-name-error' : undefined}
              value={form.name}
              onChange={(e) => {
                const value = e.target.value
                setForm((prev) => ({ ...prev, name: value }))
                setCreateErrors((prev) => ({ ...prev, name: value.trim() ? '' : t('site_configs_error_name_required') }))
              }}
            />
            {createErrors.name && <div id="create-site-config-name-error" className="text-sm text-red-600">{createErrors.name}</div>}
          </div>
          <div>
            <input
              id="create-site-config-url"
              className="input"
              placeholder={t('site_configs_field_url_placeholder')}
              aria-label={t('site_configs_field_url_placeholder')}
              aria-invalid={Boolean(createErrors.site_url)}
              aria-describedby={createErrors.site_url ? 'create-site-config-url-error' : undefined}
              value={form.site_url}
              onChange={(e) => {
                const value = e.target.value
                setForm((prev) => ({ ...prev, site_url: value }))
                setCreateErrors((prev) => ({ ...prev, site_url: value && isValidUrl(value) ? '' : t('site_configs_error_url_invalid') }))
              }}
            />
            {createErrors.site_url && <div id="create-site-config-url-error" className="text-sm text-red-600">{createErrors.site_url}</div>}
          </div>
          {form.login_type === 'selenium'
            ? renderSeleniumFields(form, createErrors, setForm, setCreateErrors, 'create')
            : renderApiFields(form, createErrors, setForm, setCreateErrors, 'create')}
          {renderSharedFields(form, createErrors, setForm, setCreateErrors, 'create')}
          <label className="inline-flex items-center gap-2 md:col-span-2">
            <input type="checkbox" checked={scopeGlobal} onChange={(e) => setScopeGlobal(e.target.checked)} />
            {t('site_configs_scope_global_label')}
          </label>
          <button
            type="submit"
            className="btn"
            disabled={!isFormReady(form)}
            title={t('form_fill_required')}
          >
            {t('btn_create')}
          </button>
        </form>
        {data && (
          <div className="card p-0 overflow-hidden">
            {(!('items' in (data as any)) && !Array.isArray(data)) || listItems.length === 0 ? (
              <div className="p-4">
                <EmptyState
                  icon={<span>🛠️</span>}
                  message={(
                    <div className="space-y-1">
                      <p className="text-lg font-semibold text-gray-700">{t('empty_site_configs_title')}</p>
                      <p>{t('empty_site_configs_desc')}</p>
                    </div>
                  )}
                />
              </div>
            ) : (
              <table className="table" role="table" aria-label={t('site_configs_table_label')}>
                <thead className="bg-gray-100">
                  <tr>
                    <th className="th" scope="col">{t('name_label')}</th>
                    <th className="th" scope="col">{t('url_label')}</th>
                    <th className="th" scope="col">{t('site_configs_column_type')}</th>
                    <th className="th" scope="col">{t('scope_label')}</th>
                    <th className="th" scope="col">{t('actions_label')}</th>
                  </tr>
                </thead>
                <tbody>
                  {listItems.map((sc: SiteConfigRecord) => {
                    const loginType = resolveLoginType(sc)
                    return (
                      <tr key={sc.id} className="odd:bg-white even:bg-gray-50">
                        <td className="td">{sc.name}</td>
                        <td className="td">{sc.siteUrl}</td>
                        <td className="td">{resolveLoginTypeLabel(loginType)}</td>
                        <td className="td">{sc.ownerUserId ? t('scope_user') : t('scope_global')}</td>
                        <td className="td">
                          <div className="flex flex-wrap items-center gap-2">
                            {!sc.ownerUserId && (
                              <button
                                type="button"
                                className="btn btn-compact"
                                onClick={() => copyToUser(sc.id)}
                                disabled={copyingId === sc.id}
                                aria-busy={copyingId === sc.id}
                              >
                                {t('copy_to_workspace')}
                              </button>
                            )}
                            <button
                              type="button"
                              className="btn btn-compact"
                              onClick={async () => {
                                try {
                                  const result = await v1.testSiteConfigV1SiteConfigsConfigIdTestPost({ configId: sc.id })
                                  setBanner({
                                    kind: result.ok ? 'success' : 'error',
                                    message: t('site_configs_test_result', { result: JSON.stringify(result) }),
                                  })
                                } catch (err: any) {
                                  setBanner({ kind: 'error', message: err?.message || String(err) })
                                }
                              }}
                            >
                              {t('site_configs_test_button')}
                            </button>
                            <button
                              type="button"
                              className="btn btn-compact"
                              onClick={() => {
                                if (isApiConfig(sc) || isSeleniumConfig(sc)) {
                                  setEditing(toFormState(sc))
                                  setEditErrors({})
                                }
                              }}
                            >
                              {t('btn_edit')}
                            </button>
                            <button
                              type="button"
                              className="btn btn-compact"
                              onClick={() => del(sc.id)}
                            >
                              {t('btn_delete')}
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}
        {editing && (
          <div className="card p-4 mt-3 grid grid-cols-1 md:grid-cols-2 gap-2" role="form" aria-labelledby="edit-site-config-heading">
            <h3 id="edit-site-config-heading" className="font-semibold md:col-span-2">{t('site_configs_edit_heading')}</h3>
            <div className="md:col-span-2">
              <fieldset>
                <legend className="text-sm font-medium mb-1">{t('site_configs_field_login_type_label')}</legend>
                <div className="flex flex-wrap gap-4">
                  <label className="inline-flex items-center gap-2">
                    <input
                      type="radio"
                      name="edit-login-type"
                      value="selenium"
                      checked={editing.login_type === 'selenium'}
                      onChange={() => updateEditLoginType('selenium')}
                    />
                    {t('site_configs_login_type_selenium')}
                  </label>
                  <label className="inline-flex items-center gap-2">
                    <input
                      type="radio"
                      name="edit-login-type"
                      value="api"
                      checked={editing.login_type === 'api'}
                      onChange={() => updateEditLoginType('api')}
                    />
                    {t('site_configs_login_type_api')}
                  </label>
                </div>
              </fieldset>
            </div>
            <div>
              <input
                id="edit-site-config-name"
                className="input"
                placeholder={t('site_configs_field_name_placeholder')}
                aria-label={t('site_configs_field_name_placeholder')}
                aria-invalid={Boolean(editErrors.name)}
                aria-describedby={editErrors.name ? 'edit-site-config-name-error' : undefined}
                value={editing.name}
                onChange={(e) => {
                  const value = e.target.value
                  setEditing((prev) => prev ? { ...prev, name: value } : prev)
                  setEditErrors((prev) => ({ ...prev, name: value.trim() ? '' : t('site_configs_error_name_required') }))
                }}
              />
              {editErrors.name && <div id="edit-site-config-name-error" className="text-sm text-red-600">{editErrors.name}</div>}
            </div>
            <div>
              <input
                id="edit-site-config-url"
                className="input"
                placeholder={t('site_configs_field_url_placeholder')}
                aria-label={t('site_configs_field_url_placeholder')}
                aria-invalid={Boolean(editErrors.site_url)}
                aria-describedby={editErrors.site_url ? 'edit-site-config-url-error' : undefined}
                value={editing.site_url}
                onChange={(e) => {
                  const value = e.target.value
                  setEditing((prev) => prev ? { ...prev, site_url: value } : prev)
                  setEditErrors((prev) => ({ ...prev, site_url: value && isValidUrl(value) ? '' : t('site_configs_error_url_invalid') }))
                }}
              />
              {editErrors.site_url && <div id="edit-site-config-url-error" className="text-sm text-red-600">{editErrors.site_url}</div>}
            </div>
            {editing.login_type === 'selenium'
              ? renderSeleniumFields(editing, editErrors, (updater) => setEditing((prev) => prev ? updater(prev) : prev), setEditErrors, 'edit')
              : renderApiFields(editing, editErrors, (updater) => setEditing((prev) => prev ? updater(prev) : prev), setEditErrors, 'edit')}
            {renderSharedFields(editing, editErrors, (updater) => setEditing((prev) => prev ? updater(prev) : prev), setEditErrors, 'edit')}
            <div className="md:col-span-2 flex gap-2">
              <button
                type="button"
                className="btn"
                disabled={!isFormReady(editing)}
                title={t('form_fill_required')}
                onClick={saveEditing}
              >
                {t('btn_save')}
              </button>
              <button type="button" className="btn" onClick={() => setEditing(null)}>{t('btn_cancel')}</button>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
