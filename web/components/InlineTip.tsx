import { useState } from 'react'
import { useI18n } from '../lib/i18n'

type InlineTipProps = {
  message: string
  className?: string
  onDismiss?: () => void
  id?: string
}

export default function InlineTip({ message, className = '', onDismiss, id }: InlineTipProps) {
  const { t } = useI18n()
  const [visible, setVisible] = useState(true)

  if (!visible) return null

  const dismiss = () => {
    setVisible(false)
    if (onDismiss) onDismiss()
  }

  return (
    <span
      id={id}
      className={`inline-tip ${className}`.trim()}
      role="note"
      aria-live="polite"
    >
      <span aria-hidden="true" className="inline-tip__icon">ℹ️</span>
      <span className="inline-tip__text">{message}</span>
      <button
        type="button"
        className="inline-tip__dismiss"
        onClick={dismiss}
        aria-label={t('inline_tip_dismiss')}
      >
        ×
      </button>
    </span>
  )
}
