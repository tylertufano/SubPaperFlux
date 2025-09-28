import { FormEvent, useState } from 'react'
import { v1 } from '../../lib/openapi'
import { useI18n } from '../../lib/i18n'
import Alert from '../Alert'

type CredentialsStepProps = {
  onComplete: () => Promise<void>
}

export default function StepCredentials({ onComplete }: CredentialsStepProps) {
  const { t } = useI18n()
  const [description, setDescription] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [kind, setKind] = useState<'site_login' | 'instapaper'>('site_login')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)

    if (!description.trim()) {
      setError(t('setup_credentials_description_required'))
      return
    }
    if (!username.trim()) {
      setError(t('setup_credentials_username_required'))
      return
    }
    if (!password.trim()) {
      setError(t('setup_credentials_password_required'))
      return
    }

    setSubmitting(true)
    try {
      await v1.createCredentialCredentialsPost({
        credential: {
          kind,
          description,
          data: {
            username,
            password,
          },
        },
      })
      setDescription('')
      setUsername('')
      setPassword('')
      await onComplete()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      setError(t('setup_credentials_error', { reason: message }))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit} aria-label={t('setup_step_credentials_title')}>
      {error ? <Alert kind="error" message={error} /> : null}
      <div className="grid gap-2 md:grid-cols-2 md:gap-4">
        <div className="grid gap-2">
          <label className="font-medium" htmlFor="setup-credential-description">
            {t('setup_credentials_description_label')}
          </label>
          <input
            id="setup-credential-description"
            type="text"
            className="input"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </div>
        <div className="grid gap-2">
          <label className="font-medium" htmlFor="setup-credential-kind">
            {t('setup_credentials_kind_label')}
          </label>
          <select
            id="setup-credential-kind"
            className="input"
            value={kind}
            onChange={(event) => setKind(event.target.value as 'site_login' | 'instapaper')}
          >
            <option value="site_login">{t('setup_credentials_kind_site_login')}</option>
            <option value="instapaper">{t('setup_credentials_kind_instapaper')}</option>
          </select>
        </div>
      </div>
      <div className="grid gap-2 md:grid-cols-2 md:gap-4">
        <div className="grid gap-2">
          <label className="font-medium" htmlFor="setup-credential-username">
            {t('setup_credentials_username_label')}
          </label>
          <input
            id="setup-credential-username"
            type="text"
            className="input"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
        </div>
        <div className="grid gap-2">
          <label className="font-medium" htmlFor="setup-credential-password">
            {t('setup_credentials_password_label')}
          </label>
          <input
            id="setup-credential-password"
            type="password"
            className="input"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
      </div>
      <div className="flex justify-end">
        <button type="submit" className="btn" disabled={submitting}>
          {submitting ? t('setup_saving_label') : t('setup_step_credentials_submit')}
        </button>
      </div>
    </form>
  )
}
