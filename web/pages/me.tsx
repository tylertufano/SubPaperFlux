import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Breadcrumbs, ErrorBoundary, Nav } from '../components'
import { useI18n } from '../lib/i18n'
import { me, type MeNotificationPreferences, type MeProfile } from '../lib/openapi'
import { buildBreadcrumbs } from '../lib/breadcrumbs'
import { useRouter } from 'next/router'

type FlashMessage = { kind: 'success' | 'error'; message: string }

type NotificationFormState = {
  emailJobUpdates: boolean
  emailDigest: boolean
}

const DEFAULT_NOTIFICATIONS: NotificationFormState = {
  emailJobUpdates: true,
  emailDigest: false,
}

function normalizeNotificationState(preferences?: MeNotificationPreferences | null): NotificationFormState {
  return {
    emailJobUpdates: preferences?.email_job_updates ?? DEFAULT_NOTIFICATIONS.emailJobUpdates,
    emailDigest: preferences?.email_digest ?? DEFAULT_NOTIFICATIONS.emailDigest,
  }
}

function getLocaleLabel(code: string, translate: (key: string, vars?: Record<string, string | number>) => string) {
  const key = `locale_${code}`
  const label = translate(key)
  return label === key ? code : label
}

export default function Me() {
  const { t, locales, locale: activeLocale, setLocale } = useI18n()
  const router = useRouter()
  const breadcrumbs = useMemo(() => buildBreadcrumbs(router.pathname, t), [router.pathname, t])
  const [profile, setProfile] = useState<MeProfile | null>(null)
  const [localeValue, setLocaleValue] = useState('')
  const [notifications, setNotifications] = useState<NotificationFormState>(DEFAULT_NOTIFICATIONS)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [flash, setFlash] = useState<FlashMessage | null>(null)
  const [savingLocale, setSavingLocale] = useState(false)
  const [savingNotifications, setSavingNotifications] = useState(false)
  const didLoadRef = useRef(false)

  const loadErrorMessage = useMemo(() => t('me_preferences_load_error'), [t])
  const saveErrorMessage = useMemo(() => t('me_preferences_save_error'), [t])

  useEffect(() => {
    if (flash) {
      if (typeof window === 'undefined') return undefined
      const timer = window.setTimeout(() => setFlash(null), 4000)
      return () => window.clearTimeout(timer)
    }
    return undefined
  }, [flash])

  useEffect(() => {
    if (didLoadRef.current) return
    didLoadRef.current = true
    let cancelled = false
    async function loadProfile() {
      setIsLoading(true)
      setError(null)
      try {
        const data = await me.getProfile()
        if (cancelled) return
        setProfile(data)
        setLocaleValue(data.locale ?? '')
        setNotifications(normalizeNotificationState(data.notification_preferences))
        if (data.locale && data.locale !== activeLocale) {
          setLocale(data.locale)
        }
      } catch (err) {
        if (cancelled) return
        const message = err instanceof Error ? err.message : String(err)
        setError(message || loadErrorMessage)
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }
    void loadProfile()
    return () => {
      cancelled = true
    }
  }, [activeLocale, loadErrorMessage, setLocale])

  const handleLocaleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSavingLocale(true)
    setFlash(null)
    try {
      const payload = { locale: localeValue ? localeValue : null }
      const updated = await me.updateProfile(payload)
      setProfile(updated)
      setLocaleValue(updated.locale ?? '')
      if (updated.locale) {
        setLocale(updated.locale)
      }
      setFlash({ kind: 'success', message: t('me_locale_saved') })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setFlash({ kind: 'error', message: message || saveErrorMessage })
    } finally {
      setSavingLocale(false)
    }
  }

  const handleNotificationsSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSavingNotifications(true)
    setFlash(null)
    try {
      const payload = {
        notification_preferences: {
          email_job_updates: notifications.emailJobUpdates,
          email_digest: notifications.emailDigest,
        },
      }
      const updated = await me.updateProfile(payload)
      setProfile(updated)
      setNotifications(normalizeNotificationState(updated.notification_preferences))
      setFlash({ kind: 'success', message: t('me_notifications_saved') })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setFlash({ kind: 'error', message: message || saveErrorMessage })
    } finally {
      setSavingNotifications(false)
    }
  }

  const defaultLocaleLabel = getLocaleLabel('en', t)
  const localeDisabled = isLoading || savingLocale
  const notificationsDisabled = isLoading || savingNotifications

  return (
    <ErrorBoundary>
      <div>
        <Nav />
        <Breadcrumbs items={breadcrumbs} />
        <main className="container py-6">
          <h2 className="text-xl font-semibold mb-1">{t('nav_profile')}</h2>
          {profile?.email ? (
            <p className="text-sm text-gray-600 mb-4">{t('me_signed_in_as', { email: profile.email })}</p>
          ) : (
            <p className="text-gray-600 mb-4">{t('profile_description')}</p>
          )}
          <div className="space-y-4">
            {flash && (
              <Alert kind={flash.kind} message={flash.message} onClose={() => setFlash(null)} />
            )}
            {error && <Alert kind="error" message={error} />}
            <section className="card p-4">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">{t('me_locale_heading')}</h3>
              <p className="text-sm text-gray-600 mb-4">{t('me_locale_description')}</p>
              <form className="space-y-4" onSubmit={handleLocaleSubmit}>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300" htmlFor="locale-select">
                  {t('me_locale_label')}
                  <select
                    id="locale-select"
                    className="input mt-1 w-full"
                    value={localeValue}
                    onChange={(event) => setLocaleValue(event.target.value)}
                    disabled={localeDisabled}
                  >
                    <option value="">{t('me_locale_option_default', { locale: defaultLocaleLabel })}</option>
                    {locales.map((code) => (
                      <option key={code} value={code}>
                        {getLocaleLabel(code, t)}
                      </option>
                    ))}
                  </select>
                </label>
                <div>
                  <button type="submit" className="btn" disabled={localeDisabled}>
                    {savingLocale ? t('loading_text') : t('me_locale_save')}
                  </button>
                </div>
              </form>
            </section>
            <section className="card p-4">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">{t('me_notifications_heading')}</h3>
              <p className="text-sm text-gray-600 mb-4">{t('me_notifications_description')}</p>
              <form className="space-y-4" onSubmit={handleNotificationsSubmit}>
                <div className="space-y-3">
                  <label className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={notifications.emailJobUpdates}
                      onChange={(event) =>
                        setNotifications((prev) => ({ ...prev, emailJobUpdates: event.target.checked }))
                      }
                      disabled={notificationsDisabled}
                    />
                    <span>{t('me_notifications_email_job_updates')}</span>
                  </label>
                  <label className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={notifications.emailDigest}
                      onChange={(event) =>
                        setNotifications((prev) => ({ ...prev, emailDigest: event.target.checked }))
                      }
                      disabled={notificationsDisabled}
                    />
                    <span>{t('me_notifications_email_digest')}</span>
                  </label>
                </div>
                <div>
                  <button type="submit" className="btn" disabled={notificationsDisabled}>
                    {savingNotifications ? t('loading_text') : t('me_notifications_save')}
                  </button>
                </div>
              </form>
            </section>
            {isLoading && (
              <p className="text-sm text-gray-500">{t('loading_text')}</p>
            )}
          </div>
        </main>
      </div>
    </ErrorBoundary>
  )
}

