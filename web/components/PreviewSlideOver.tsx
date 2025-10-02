import { useEffect, useRef, type MouseEvent, type ReactNode } from 'react'
import PreviewPane from './PreviewPane'
import { useI18n } from '../lib/i18n'

type PreviewSlideOverProps = {
  id: string
  open: boolean
  heading: string
  labelledBy: string
  snippet?: string | null
  emptyState?: ReactNode
  onClose: () => void
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

export default function PreviewSlideOver({
  id,
  open,
  heading,
  labelledBy,
  snippet,
  emptyState,
  onClose,
}: PreviewSlideOverProps) {
  const { t } = useI18n()
  const panelRef = useRef<HTMLDivElement | null>(null)
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)
  const lastActiveElementRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open || typeof document === 'undefined') {
      return
    }

    lastActiveElementRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null

    const timer = window.setTimeout(() => {
      if (closeButtonRef.current) {
        closeButtonRef.current.focus()
        return
      }

      panelRef.current?.focus()
    }, 0)

    return () => window.clearTimeout(timer)
  }, [open])

  useEffect(() => {
    if (open || typeof document === 'undefined') {
      return
    }

    const timer = window.setTimeout(() => {
      lastActiveElementRef.current?.focus()
    }, 0)

    return () => window.clearTimeout(timer)
  }, [open])

  useEffect(() => {
    if (!open || typeof document === 'undefined') {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!panelRef.current) return

      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }

      if (event.key !== 'Tab') return

      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).filter((element) => !element.hasAttribute('disabled'))

      if (focusable.length === 0) {
        panelRef.current.focus()
        event.preventDefault()
        return
      }

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement as HTMLElement | null

      if (event.shiftKey) {
        if (!active || active === first) {
          event.preventDefault()
          last.focus()
        }
      } else if (!active || active === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose])

  if (!open) {
    return null
  }

  const handleContainerClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) {
      onClose()
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex"
      role="presentation"
      onClick={handleContainerClick}
    >
      <div className="absolute inset-0 bg-black/50" aria-hidden="true" />
      <div className="relative z-10 ml-auto flex h-full w-full justify-end">
        <div
          id={id}
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={labelledBy}
          tabIndex={-1}
          className="flex h-full w-full max-w-full flex-col bg-white shadow-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 dark:bg-gray-900 lg:max-w-2xl"
          onClick={(event) => event.stopPropagation()}
        >
          <header className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
            <h2 id={labelledBy} className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              {heading}
            </h2>
            <button
              type="button"
              ref={closeButtonRef}
              className="rounded px-3 py-1 text-sm font-medium text-gray-700 transition hover:bg-gray-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary dark:text-gray-200 dark:hover:bg-gray-800"
              onClick={onClose}
            >
              {t('btn_close')}
            </button>
          </header>
          <div className="flex-1 overflow-y-auto px-4 pb-6 pt-4">
            <PreviewPane
              snippet={snippet}
              emptyState={emptyState}
              labelledBy={labelledBy}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
