import type {
  ButtonHTMLAttributes,
  FormHTMLAttributes,
  ReactNode,
} from 'react'
import { useEffect, useRef } from 'react'

export type ConfigEditorPanelProps = {
  title: ReactNode
  description?: ReactNode
  children: ReactNode
  submitLabel: ReactNode
  cancelLabel?: ReactNode
  onCancel?: () => void
  isSubmitting?: boolean
  autoFocus?: boolean
  focusSelector?: string
  actions?: ReactNode
  contentClassName?: string
  actionsClassName?: string
  submitButtonProps?: ButtonHTMLAttributes<HTMLButtonElement>
  cancelButtonProps?: ButtonHTMLAttributes<HTMLButtonElement>
  headingLevel?: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'
} & Omit<FormHTMLAttributes<HTMLFormElement>, 'children'>

const DEFAULT_FOCUS_SELECTOR =
  '[data-config-editor-initial-focus], input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled])'

function mergeClassNames(...values: Array<string | undefined | null | false>) {
  return values.filter(Boolean).join(' ')
}

export default function ConfigEditorPanel({
  title,
  description,
  children,
  submitLabel,
  cancelLabel,
  onCancel,
  isSubmitting,
  autoFocus = false,
  focusSelector,
  actions,
  contentClassName,
  actionsClassName,
  submitButtonProps,
  cancelButtonProps,
  headingLevel = 'h3',
  className,
  onSubmit,
  ...rest
}: ConfigEditorPanelProps) {
  const formRef = useRef<HTMLFormElement | null>(null)
  const resolvedContentClassName = mergeClassNames(
    'grid grid-cols-1 gap-3',
    contentClassName || 'md:grid-cols-2',
  )

  // Only refocus when the auto focus flag or selector changes so we avoid
  // stealing focus on subsequent renders triggered by input updates.
  useEffect(() => {
    if (!autoFocus) return
    const node = formRef.current
    if (!node) return

    const selectors = [
      focusSelector,
      DEFAULT_FOCUS_SELECTOR,
      'button:not([type="button"]):not([disabled])',
      '[tabindex]:not([tabindex="-1"])',
    ].filter(Boolean) as string[]

    for (const selector of selectors) {
      const target = node.querySelector<HTMLElement>(selector)
      if (target && !target.hasAttribute('disabled') && target.getAttribute('aria-disabled') !== 'true') {
        target.focus()
        if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
          if (typeof target.select === 'function') {
            target.select()
          }
        }
        return
      }
    }
  }, [autoFocus, focusSelector])

  const HeadingTag = headingLevel as keyof JSX.IntrinsicElements

  return (
    <form
      ref={formRef}
      className={mergeClassNames('card w-full p-4', className)}
      onSubmit={onSubmit}
      {...rest}
    >
      <div className={resolvedContentClassName}>
        <div className="md:col-span-full space-y-1">
          <HeadingTag className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {title}
          </HeadingTag>
          {description ? (
            <div className="text-sm text-gray-600 dark:text-gray-300">{description}</div>
          ) : null}
        </div>
        {children}
        <div
          className={mergeClassNames(
            'flex flex-wrap justify-end gap-2 md:col-span-full',
            actionsClassName,
          )}
        >
          {actions || (
            <>
              <button
                type="submit"
                className="btn"
                disabled={Boolean(isSubmitting)}
                {...submitButtonProps}
              >
                {submitLabel}
              </button>
              {cancelLabel && onCancel ? (
                <button
                  type="button"
                  className="btn"
                  onClick={onCancel}
                  disabled={Boolean(isSubmitting)}
                  {...cancelButtonProps}
                >
                  {cancelLabel}
                </button>
              ) : null}
            </>
          )}
        </div>
      </div>
    </form>
  )
}
