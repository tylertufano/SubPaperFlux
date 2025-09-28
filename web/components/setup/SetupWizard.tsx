import { useCallback, useEffect, useMemo, useState } from 'react'
import useSWR from 'swr'
import Link from 'next/link'
import Alert from '../Alert'
import StepWelcome from './StepWelcome'
import StepCredentials from './StepCredentials'
import StepFeeds from './StepFeeds'
import { useI18n } from '../../lib/i18n'
import {
  v1,
  type SetupStepId,
  type SiteSetupStatus,
  type SiteSetupStatusOut,
} from '../../lib/openapi'

type SetupWizardProps = {
  onSetupFinished?: () => void
}

const stepOrder: SetupStepId[] = ['welcome', 'credentials', 'feeds', 'complete']

const defaultStatus: SiteSetupStatus = {
  completed: false,
  current_step: 'welcome',
  last_completed_step: null,
  welcome_configured: false,
  credentials_created: false,
  feeds_imported: false,
}

function isSetupStep(value: unknown): value is SetupStepId {
  return typeof value === 'string' && (stepOrder as readonly string[]).includes(value)
}

function normalizeStatus(value?: SiteSetupStatusOut['value'] | null): SiteSetupStatus {
  if (!value) {
    return { ...defaultStatus }
  }
  const normalized: SiteSetupStatus = { ...defaultStatus, ...value }
  if (!isSetupStep(normalized.current_step)) {
    normalized.current_step = defaultStatus.current_step
  }
  return normalized
}

function resolveActiveStep(status: SiteSetupStatus | undefined): SetupStepId {
  if (!status) {
    return 'welcome'
  }
  if (status.completed) {
    return 'complete'
  }
  if (isSetupStep(status.current_step)) {
    return status.current_step
  }
  if (isSetupStep(status.last_completed_step)) {
    const previousIndex = stepOrder.indexOf(status.last_completed_step)
    if (previousIndex >= 0 && previousIndex + 1 < stepOrder.length) {
      return stepOrder[previousIndex + 1]
    }
    return 'complete'
  }
  if (status.welcome_configured && !status.credentials_created) {
    return 'credentials'
  }
  if (status.welcome_configured && status.credentials_created && !status.feeds_imported) {
    return 'feeds'
  }
  if (status.welcome_configured && status.credentials_created && status.feeds_imported) {
    return 'complete'
  }
  return 'welcome'
}

export default function SetupWizard({ onSetupFinished }: SetupWizardProps) {
  const { t } = useI18n()
  const {
    data: statusData,
    error: statusError,
    isLoading: statusLoading,
    mutate: mutateStatus,
  } = useSWR(['/v1/site-settings/setup-status', 'wizard'], () => v1.getSiteSetupStatus())
  const { data: welcomeSetting } = useSWR(['/v1/site-settings/welcome', 'setup'], () => v1.getSiteWelcomeSetting())
  const [statusValue, setStatusValue] = useState<SiteSetupStatus>(defaultStatus)
  const [activeStep, setActiveStep] = useState<SetupStepId>('welcome')
  const [statusUpdateError, setStatusUpdateError] = useState<string | null>(null)
  const [banner, setBanner] = useState<{ kind: 'success' | 'error'; message: string } | null>(null)

  useEffect(() => {
    if (!statusData?.value) {
      setStatusValue({ ...defaultStatus })
      setActiveStep('welcome')
      return
    }
    const normalized = normalizeStatus(statusData.value)
    setStatusValue(normalized)
    setActiveStep(resolveActiveStep(normalized))
  }, [statusData])

  useEffect(() => {
    if (statusValue.completed && typeof onSetupFinished === 'function') {
      onSetupFinished()
    }
  }, [statusValue.completed, onSetupFinished])

  const completions = useMemo(
    () => ({
      welcome: Boolean(statusValue.welcome_configured),
      credentials: Boolean(statusValue.credentials_created),
      feeds: Boolean(statusValue.feeds_imported),
      complete: Boolean(statusValue.completed),
    }),
    [statusValue],
  )

  const stepLabels = useMemo(
    () => ({
      welcome: t('setup_step_welcome_title'),
      credentials: t('setup_step_credentials_title'),
      feeds: t('setup_step_feeds_title'),
      complete: t('setup_step_complete_title'),
    }),
    [t],
  )

  const stepDescriptions = useMemo(
    () => ({
      welcome: t('setup_step_welcome_description'),
      credentials: t('setup_step_credentials_description'),
      feeds: t('setup_step_feeds_description'),
      complete: t('setup_step_complete_description'),
    }),
    [t],
  )

  const activeDescription = stepDescriptions[activeStep]
  const welcomeContent = welcomeSetting?.value ?? null

  const persistStatus = useCallback(
    async (updates: Partial<SiteSetupStatus>) => {
      const merged = normalizeStatus({ ...statusValue, ...updates })
      if (merged.completed) {
        merged.current_step = 'complete'
        merged.last_completed_step = 'feeds'
      } else if (!isSetupStep(merged.current_step)) {
        merged.current_step = resolveActiveStep(merged)
      }

      setStatusUpdateError(null)
      try {
        const response = await v1.updateSiteSetupStatus({
          siteSetupStatusUpdate: merged,
        })
        const nextValue = normalizeStatus(response.value)
        setStatusValue(nextValue)
        setActiveStep(resolveActiveStep(nextValue))
        void mutateStatus(response, { revalidate: false })
        return nextValue
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        setStatusUpdateError(t('setup_status_save_error', { reason: message }))
        setBanner(null)
        throw error
      }
    },
    [mutateStatus, statusValue, t],
  )

  const handleWelcomeComplete = useCallback(async () => {
    await persistStatus({
      completed: false,
      current_step: 'credentials',
      last_completed_step: 'welcome',
      welcome_configured: true,
    })
    setBanner({ kind: 'success', message: t('setup_welcome_success') })
  }, [persistStatus, t])

  const handleCredentialComplete = useCallback(async () => {
    await persistStatus({
      completed: false,
      current_step: 'feeds',
      last_completed_step: 'credentials',
      welcome_configured: true,
      credentials_created: true,
    })
    setBanner({ kind: 'success', message: t('setup_credentials_success') })
  }, [persistStatus, t])

  const handleFeedsComplete = useCallback(async () => {
    await persistStatus({
      completed: true,
      current_step: 'complete',
      last_completed_step: 'feeds',
      welcome_configured: true,
      credentials_created: true,
      feeds_imported: true,
    })
    setBanner({ kind: 'success', message: t('setup_feeds_submit_success') })
  }, [persistStatus, t])

  const statusErrorMessage = statusError
    ? t('setup_status_error', { reason: statusError instanceof Error ? statusError.message : String(statusError) })
    : null

  return (
    <section className="card p-6" aria-live="polite">
      <div className="mb-4">
        <ol className="flex flex-col gap-3 md:flex-row" aria-label={t('setup_step_list_label')}>
          {stepOrder.map((step, index) => {
            const isActive = activeStep === step
            const isComplete = completions[step]
            const baseCircle =
              'inline-flex h-7 w-7 items-center justify-center rounded-full border text-sm font-medium'
            const circleClass = isComplete
              ? `${baseCircle} border-green-500 bg-green-500 text-white`
              : isActive
              ? `${baseCircle} border-blue-500 bg-blue-500 text-white`
              : `${baseCircle} border-gray-300 text-gray-600`
            const labelClass = isActive
              ? 'font-semibold text-blue-700'
              : isComplete
              ? 'text-green-700'
              : 'text-gray-600'
            return (
              <li key={step} className="flex items-center gap-3" aria-current={isActive ? 'step' : undefined}>
                <span className={circleClass}>{index + 1}</span>
                <span className={labelClass}>{stepLabels[step]}</span>
              </li>
            )
          })}
        </ol>
      </div>
      {banner ? <Alert kind={banner.kind} message={banner.message} /> : null}
      {statusErrorMessage ? <Alert kind="error" message={statusErrorMessage} /> : null}
      {statusUpdateError ? <Alert kind="error" message={statusUpdateError} /> : null}
      {statusLoading ? (
        <p className="text-gray-600">{t('setup_status_loading')}</p>
      ) : null}
      {activeDescription ? <p className="mt-2 text-gray-700">{activeDescription}</p> : null}
      <div className="mt-6">
        {activeStep === 'welcome' ? (
          <StepWelcome defaultContent={welcomeContent} onComplete={handleWelcomeComplete} />
        ) : null}
        {activeStep === 'credentials' ? <StepCredentials onComplete={handleCredentialComplete} /> : null}
        {activeStep === 'feeds' ? <StepFeeds onComplete={handleFeedsComplete} /> : null}
        {activeStep === 'complete' ? (
          <div className="space-y-3">
            <Alert kind="success" message={t('setup_step_complete_title')} />
            <p className="text-gray-700">{t('setup_step_complete_description')}</p>
            <Link href="/" className="btn inline-flex items-center justify-center">
              {t('setup_complete_go_home')}
            </Link>
          </div>
        ) : null}
      </div>
    </section>
  )
}
