import { FormEvent, useState } from 'react'
import { v1 } from '../../lib/openapi'
import { useI18n } from '../../lib/i18n'
import Alert from '../Alert'

type FeedsStepProps = {
  onComplete: () => Promise<void>
}

export default function StepFeeds({ onComplete }: FeedsStepProps) {
  const { t } = useI18n()
  const [url, setUrl] = useState('')
  const [pollFrequency, setPollFrequency] = useState('1h')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)

    if (!url.trim()) {
      setError(t('setup_feeds_url_required'))
      return
    }

    setSubmitting(true)
    try {
      await v1.createFeedFeedsPost({
        feed: {
          url,
          pollFrequency,
        },
      })
      setUrl('')
      setPollFrequency('1h')
      await onComplete()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      setError(t('setup_feeds_error', { reason: message }))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit} aria-label={t('setup_step_feeds_title')}>
      {error ? <Alert kind="error" message={error} /> : null}
      <div className="grid gap-2">
        <label className="font-medium" htmlFor="setup-feed-url">
          {t('setup_feeds_url_label')}
        </label>
        <input
          id="setup-feed-url"
          type="url"
          className="input"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://example.com/feed.xml"
        />
      </div>
      <div className="grid gap-2 md:grid-cols-2 md:gap-4">
        <div className="grid gap-2">
          <label className="font-medium" htmlFor="setup-feed-frequency">
            {t('setup_feeds_poll_label')}
          </label>
          <select
            id="setup-feed-frequency"
            className="input"
            value={pollFrequency}
            onChange={(event) => setPollFrequency(event.target.value)}
          >
            <option value="15m">15m</option>
            <option value="30m">30m</option>
            <option value="1h">1h</option>
            <option value="6h">6h</option>
            <option value="12h">12h</option>
            <option value="24h">24h</option>
          </select>
        </div>
      </div>
      <div className="flex justify-end">
        <button type="submit" className="btn" disabled={submitting}>
          {submitting ? t('setup_saving_label') : t('setup_step_feeds_submit')}
        </button>
      </div>
    </form>
  )
}
