import { FormEvent, useEffect, useState } from 'react'
import { v1 } from '../../lib/openapi'
import { useI18n } from '../../lib/i18n'
import Alert from '../Alert'

type WelcomeContent = {
  headline?: string | null
  subheadline?: string | null
  body?: string | null
  cta_text?: string | null
  cta_url?: string | null
  [key: string]: unknown
}

type WelcomeStepProps = {
  defaultContent?: WelcomeContent | null
  onComplete: () => Promise<void>
}

export default function StepWelcome({ defaultContent, onComplete }: WelcomeStepProps) {
  const { t } = useI18n()
  const [headline, setHeadline] = useState('')
  const [subheadline, setSubheadline] = useState('')
  const [body, setBody] = useState('')
  const [ctaText, setCtaText] = useState('')
  const [ctaUrl, setCtaUrl] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    setHeadline(defaultContent?.headline ?? '')
    setSubheadline(defaultContent?.subheadline ?? '')
    setBody(defaultContent?.body ?? '')
    setCtaText(defaultContent?.cta_text ?? '')
    setCtaUrl(defaultContent?.cta_url ?? '')
  }, [defaultContent])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)

    try {
      await v1.updateSiteWelcomeSetting({
        siteWelcomeSettingUpdate: {
          headline: headline || undefined,
          subheadline: subheadline || undefined,
          body: body || undefined,
          cta_text: ctaText || undefined,
          cta_url: ctaUrl || undefined,
        },
      })
      await onComplete()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      setError(t('setup_welcome_error', { reason: message }))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit} aria-label={t('setup_step_welcome_title')}>
      {error ? <Alert kind="error" message={error} /> : null}
      <div className="grid gap-2">
        <label className="font-medium" htmlFor="setup-welcome-headline">
          {t('setup_welcome_headline_label')}
        </label>
        <input
          id="setup-welcome-headline"
          type="text"
          className="input"
          value={headline}
          onChange={(event) => setHeadline(event.target.value)}
        />
      </div>
      <div className="grid gap-2">
        <label className="font-medium" htmlFor="setup-welcome-subheadline">
          {t('setup_welcome_subheadline_label')}
        </label>
        <input
          id="setup-welcome-subheadline"
          type="text"
          className="input"
          value={subheadline}
          onChange={(event) => setSubheadline(event.target.value)}
        />
      </div>
      <div className="grid gap-2">
        <label className="font-medium" htmlFor="setup-welcome-body">
          {t('setup_welcome_body_label')}
        </label>
        <textarea
          id="setup-welcome-body"
          className="input min-h-24"
          value={body}
          onChange={(event) => setBody(event.target.value)}
        />
      </div>
      <div className="grid gap-2 md:grid-cols-2 md:gap-4">
        <div className="grid gap-2">
          <label className="font-medium" htmlFor="setup-welcome-cta-text">
            {t('setup_welcome_cta_text_label')}
          </label>
          <input
            id="setup-welcome-cta-text"
            type="text"
            className="input"
            value={ctaText}
            onChange={(event) => setCtaText(event.target.value)}
          />
        </div>
        <div className="grid gap-2">
          <label className="font-medium" htmlFor="setup-welcome-cta-url">
            {t('setup_welcome_cta_url_label')}
          </label>
          <input
            id="setup-welcome-cta-url"
            type="url"
            className="input"
            value={ctaUrl}
            onChange={(event) => setCtaUrl(event.target.value)}
            placeholder="https://example.com"
          />
        </div>
      </div>
      <div className="flex justify-end">
        <button type="submit" className="btn" disabled={submitting}>
          {submitting ? t('setup_saving_label') : t('setup_step_welcome_submit')}
        </button>
      </div>
    </form>
  )
}
