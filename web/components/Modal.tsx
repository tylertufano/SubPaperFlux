import { ReactNode, useEffect, useId, useRef } from 'react'

const FOCUSABLE = 'a[href], button:not([disabled]), textarea, input, select, details,[tabindex]:not([tabindex="-1"])'

type ModalProps = {
  isOpen: boolean
  onClose: () => void
  title: string
  description?: ReactNode
  children: ReactNode
  footer?: ReactNode
  initialFocusRef?: React.RefObject<HTMLElement>
  closeLabel?: string
}

export default function Modal({ isOpen, onClose, title, description, children, footer, initialFocusRef, closeLabel }: ModalProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const prevFocus = useRef<Element | null>(null)
  const titleId = useId()
  const descId = description ? useId() : undefined

  useEffect(() => {
    if (!isOpen) return
    prevFocus.current = document.activeElement
    const body = document.body
    const originalOverflow = body.style.overflow
    body.style.overflow = 'hidden'

    function handleKeydown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
        return
      }
      if (e.key === 'Tab') {
        const dialog = dialogRef.current
        if (!dialog) return
        const focusables = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(el => !el.hasAttribute('disabled') && el.getAttribute('aria-hidden') !== 'true')
        if (!focusables.length) {
          e.preventDefault()
          dialog.focus()
          return
        }
        const first = focusables[0]
        const last = focusables[focusables.length - 1]
        if (e.shiftKey) {
          if (document.activeElement === first || dialog === document.activeElement) {
            e.preventDefault()
            last.focus()
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault()
            first.focus()
          }
        }
      }
    }

    function handleFocus(event: FocusEvent) {
      const dialog = dialogRef.current
      if (!dialog) return
      if (!dialog.contains(event.target as Node)) {
        const focusables = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE))
        const fallback = initialFocusRef?.current || focusables[0] || dialog
        fallback.focus()
      }
    }

    document.addEventListener('keydown', handleKeydown)
    document.addEventListener('focus', handleFocus, true)

    const dialog = dialogRef.current
    const focusables = dialog ? Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)) : []
    const target = initialFocusRef?.current || focusables[0] || dialog
    target?.focus()

    return () => {
      document.removeEventListener('keydown', handleKeydown)
      document.removeEventListener('focus', handleFocus, true)
      body.style.overflow = originalOverflow
      const prev = prevFocus.current as HTMLElement | null
      prev?.focus?.()
    }
  }, [isOpen, onClose, initialFocusRef])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="presentation">
      <div
        className="absolute inset-0 bg-black/40 dark:bg-black/60"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        className="relative z-10 w-full max-w-xl rounded-md bg-white dark:bg-gray-800 shadow-xl outline-none focus:outline-none"
        tabIndex={-1}
      >
        <div className="flex items-start justify-between border-b border-gray-200 dark:border-gray-700 px-4 py-3">
          <div>
            <h2 id={titleId} className="text-lg font-semibold text-gray-900 dark:text-gray-100">{title}</h2>
            {description ? (
              <div id={descId} className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                {description}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-xl text-gray-500 hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:text-gray-100 dark:focus:ring-offset-gray-800"
            aria-label={closeLabel || 'Close dialog'}
            title={closeLabel || 'Close dialog'}
          >
            ×
          </button>
        </div>
        <div className="px-4 py-4 max-h-[70vh] overflow-y-auto text-sm text-gray-800 dark:text-gray-100">
          {children}
        </div>
        {footer ? (
          <div className="flex items-center justify-end gap-2 border-t border-gray-200 dark:border-gray-700 px-4 py-3 bg-gray-50 dark:bg-gray-900/40">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  )
}
