import { type ChangeEvent, type FormEvent, type ReactNode, useEffect, useMemo, useState } from 'react'
import useSWR from 'swr'
import { Alert, Breadcrumbs, ErrorBoundary, Nav } from '../../components'
import { useI18n } from '../../lib/i18n'
import { useFeatureFlags } from '../../lib/featureFlags'
import { buildBreadcrumbs } from '../../lib/breadcrumbs'
import { useRouter } from 'next/router'
import { v1, type SiteWelcomeSettingOut, type SiteWelcomeSettingUpdate } from '../../lib/openapi'

type WelcomeFormState = {
  headline: string
  subheadline: string
  body: string
  ctaText: string
  ctaUrl: string
}

type FlashMessage = { kind: 'success' | 'error'; message: ReactNode }

type WelcomeKey = ['/v1/site-settings/welcome']

function createFormState(setting?: SiteWelcomeSettingOut | null): WelcomeFormState {
  return {
    headline: setting?.value?.headline ?? '',
    subheadline: setting?.value?.subheadline ?? '',
    body: setting?.value?.body ?? '',
    ctaText: setting?.value?.cta_text ?? '',
    ctaUrl: setting?.value?.cta_url ?? '',
  }
}

function hasChanges(current: WelcomeFormState, initial: WelcomeFormState): boolean {
  return (
    current.headline !== initial.headline ||
    current.subheadline !== initial.subheadline ||
    current.body !== initial.body ||
    current.ctaText !== initial.ctaText ||
    current.ctaUrl !== initial.ctaUrl
  )
}

export default function AdminSiteSettings() {
  const { t } = useI18n()
  const router = useRouter()
  const breadcrumbs = useMemo(() => buildBreadcrumbs(router.pathname, t), [router.pathname, t])
  const { userMgmtCore, userMgmtUi, isLoaded: flagsLoaded } = useFeatureFlags()
  const siteSettingsEnabled = userMgmtCore && userMgmtUi
  const canFetch = flagsLoaded && siteSettingsEnabled
  const [formState, setFormState] = useState<WelcomeFormState>(createFormState)
  const [initialState, setInitialState] = useState<WelcomeFormState | null>(null)
  const [flash, setFlash] = useState<FlashMessage | null>(null)
  const [validationErrors, setValidationErrors] = useState<string[]>([])
  const [isSaving, setIsSaving] = useState(false)

  const swrKey: WelcomeKey | null = canFetch ? ['/v1/site-settings/welcome'] : null
  const { data, error, isLoading, mutate } = useSWR<SiteWelcomeSettingOut, Error, WelcomeKey | null>(
    swrKey,
    () => v1.getSiteWelcomeSetting(),
  )

  useEffect(() => {
    if (!data) {
      return
    }
    const nextState = createFormState(data)
    setInitialState(nextState)
    setFormState(nextState)
  }, [data])

  useEffect(() => {
    if (!flash) {
      return
    }
    const timer = window.setTimeout(() => setFlash(null), 5000)
    return () => window.clearTimeout(timer)
  }, [flash])

  const isDirty = useMemo(() => {
    if (!initialState) {
      return false
    }
    return hasChanges(formState, initialState)
  }, [formState, initialState])

  const handleReset = () => {
    if (!initialState) {
      return
    }
    setFormState(initialState)
    setValidationErrors([])
    setFlash(null)
  }

  const handleChange = (
    field: keyof WelcomeFormState,
  ) => (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const value = event.target.value
    setFormState((prev) => ({ ...prev, [field]: value }))
    if (validationErrors.length > 0) {
      setValidationErrors([])
    }
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!initialState || isSaving) {
      return
    }

    const trimmedHeadline = formState.headline.trim()
    const trimmedSubheadline = formState.subheadline.trim()
    const trimmedBody = formState.body.trim()
    const trimmedCtaText = formState.ctaText.trim()
    const trimmedCtaUrl = formState.ctaUrl.trim()

    const errors: string[] = []
    if (trimmedCtaUrl && !/^https?:\/\//i.test(trimmedCtaUrl)) {
      errors.push(t('admin_site_settings_invalid_cta_url'))
    }
    if (trimmedCtaUrl && !trimmedCtaText) {
      errors.push(t('admin_site_settings_missing_cta_text'))
    }
    if (trimmedCtaText && !trimmedCtaUrl) {
      errors.push(t('admin_site_settings_missing_cta_url'))
    }

    if (errors.length > 0) {
      setValidationErrors(errors)
      setFlash(null)
      return
    }

    const payload: SiteWelcomeSettingUpdate = {
      headline: trimmedHeadline || null,
      subheadline: trimmedSubheadline || null,
      body: trimmedBody || null,
      cta_text: trimmedCtaText || null,
      cta_url: trimmedCtaUrl || null,
    }

    setIsSaving(true)
    setFlash(null)

    try {
      const updated = await v1.updateSiteWelcomeSetting({ siteWelcomeSettingUpdate: payload })
      const nextState = createFormState(updated)
      setInitialState(nextState)
      setFormState(nextState)
      try {
        await mutate()
      } catch {
        // Swallow revalidation errors; the local state already reflects the update.
      }
      setFlash({ kind: 'success', message: t('admin_site_settings_save_success') })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setFlash({ kind: 'error', message })
    } finally {
      setIsSaving(false)
    }
  }

  if (!flagsLoaded) {
    return (
      <ErrorBoundary>
        <div>
          <Nav />
          <Breadcrumbs items={breadcrumbs} />
          <main className="container py-6">
            <h2 className="text-xl font-semibold mb-1">{t('nav_site_settings')}</h2>
            <p className="text-gray-600 mb-4">{t('loading_text')}</p>
          </main>
        </div>
      </ErrorBoundary>
    )
  }

  if (!siteSettingsEnabled) {
    return (
      <ErrorBoundary>
        <div>
          <Nav />
          <Breadcrumbs items={breadcrumbs} />
          <main className="container py-6">
            <h2 className="text-xl font-semibold mb-4">{t('nav_site_settings')}</h2>
            <Alert kind="info" message={t('admin_site_settings_disabled_message')} />
          </main>
        </div>
      </ErrorBoundary>
    )
  }

  return (
    <ErrorBoundary>
      <div>
        <Nav />
        <Breadcrumbs items={breadcrumbs} />
        <main className="container py-6">
          <div className="max-w-3xl space-y-4">
            <div>
              <h2 className="text-xl font-semibold mb-1">{t('nav_site_settings')}</h2>
              <p className="text-gray-600">{t('admin_site_settings_description')}</p>
            </div>

            {flash && (
              <Alert kind={flash.kind} message={flash.message} />
            )}

            {validationErrors.length > 0 && (
              <Alert
                kind="error"
                message={
                  <ul className="list-disc list-inside space-y-1">
                    {validationErrors.map((msg, index) => (
                      <li key={index}>{msg}</li>
                    ))}
                  </ul>
                }
              />
            )}

            {error && <Alert kind="error" message={error instanceof Error ? error.message : String(error)} />}
            {isLoading && <p className="text-gray-600">{t('loading_text')}</p>}

            <form className="card p-4 space-y-4" onSubmit={handleSubmit} aria-labelledby="admin-site-settings-heading">
              <div>
                <h3 id="admin-site-settings-heading" className="text-lg font-semibold mb-2">
                  {t('admin_site_settings_form_heading')}
                </h3>
                <p className="text-gray-600 text-sm">{t('admin_site_settings_form_description')}</p>
              </div>

              <label className="block text-sm font-medium text-gray-700" htmlFor="welcome-headline">
                {t('admin_site_settings_headline_label')}
                <input
                  id="welcome-headline"
                  type="text"
                  className="input mt-1 w-full"
                  value={formState.headline}
                  onChange={handleChange('headline')}
                  placeholder={t('admin_site_settings_headline_placeholder')}
                />
              </label>

              <label className="block text-sm font-medium text-gray-700" htmlFor="welcome-subheadline">
                {t('admin_site_settings_subheadline_label')}
                <input
                  id="welcome-subheadline"
                  type="text"
                  className="input mt-1 w-full"
                  value={formState.subheadline}
                  onChange={handleChange('subheadline')}
                  placeholder={t('admin_site_settings_subheadline_placeholder')}
                />
              </label>

              <label className="block text-sm font-medium text-gray-700" htmlFor="welcome-body">
                {t('admin_site_settings_body_label')}
                <textarea
                  id="welcome-body"
                  className="input mt-1 w-full"
                  rows={5}
                  value={formState.body}
                  onChange={handleChange('body')}
                  placeholder={t('admin_site_settings_body_placeholder')}
                />
              </label>

              <div className="grid gap-4 md:grid-cols-2">
                <label className="block text-sm font-medium text-gray-700" htmlFor="welcome-cta-text">
                  {t('admin_site_settings_cta_text_label')}
                  <input
                    id="welcome-cta-text"
                    type="text"
                    className="input mt-1 w-full"
                    value={formState.ctaText}
                    onChange={handleChange('ctaText')}
                    placeholder={t('admin_site_settings_cta_text_placeholder')}
                  />
                </label>

                <label className="block text-sm font-medium text-gray-700" htmlFor="welcome-cta-url">
                  {t('admin_site_settings_cta_url_label')}
                  <input
                    id="welcome-cta-url"
                    type="url"
                    className="input mt-1 w-full"
                    value={formState.ctaUrl}
                    onChange={handleChange('ctaUrl')}
                    placeholder={t('admin_site_settings_cta_url_placeholder')}
                  />
                </label>
              </div>

              <div className="flex flex-wrap gap-2">
                <button type="submit" className="btn" disabled={!isDirty || isSaving}>
                  {isSaving ? t('admin_site_settings_save_pending') : t('admin_site_settings_save_button')}
                </button>
                <button type="button" className="btn" onClick={handleReset} disabled={!isDirty || isSaving}>
                  {t('admin_site_settings_reset_button')}
                </button>
              </div>
            </form>
          </div>
        </main>
      </div>
    </ErrorBoundary>
  )
}
