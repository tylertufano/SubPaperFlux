import { useI18n } from '../lib/i18n'

type Props = {
  kind?: 'info' | 'success' | 'warning' | 'error'
  message: string
  onClose?: () => void
}

export default function Alert({ kind = 'info', message, onClose }: Props) {
  const { t } = useI18n()
  const color = kind === 'success' ? 'green' : kind === 'warning' ? 'yellow' : kind === 'error' ? 'red' : 'blue'
  return (
    <div
      className={`rounded-md border px-3 py-2 bg-${color}-50 border-${color}-200 text-${color}-800 flex items-start justify-between gap-2`}
      role={kind === 'error' ? 'alert' : 'status'}
      aria-live={kind === 'error' ? 'assertive' : 'polite'}
    >
      <div>{message}</div>
      {onClose && <button className={`text-${color}-800`} aria-label={t('alert_dismiss')} onClick={onClose}>×</button>}
    </div>
  )
}
