type Props = {
  title: string
  description?: string
  actionLabel?: string
  onAction?: () => void
}

export default function EmptyState({ title, description, actionLabel, onAction }: Props) {
  return (
    <div className="card p-6 text-center text-gray-700">
      <h3 className="text-lg font-semibold mb-2">{title}</h3>
      {description && <p className="mb-4 text-gray-600">{description}</p>}
      {actionLabel && onAction && (
        <button className="btn" onClick={onAction}>{actionLabel}</button>
      )}
    </div>
  )
}

