import type { ReactNode } from 'react'

type Props = {
  icon?: ReactNode
  message: ReactNode
  action?: ReactNode
}

export default function EmptyState({ icon, message, action }: Props) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-gray-300 bg-gray-50 px-8 py-12 text-center text-gray-600">
      {icon && (
        <div className="mb-4 text-4xl text-gray-300" aria-hidden="true">
          {icon}
        </div>
      )}
      <div className="mb-4 max-w-md text-base text-gray-600">{message}</div>
      {action && <div className="mt-2 flex items-center justify-center gap-2">{action}</div>}
    </div>
  )
}

