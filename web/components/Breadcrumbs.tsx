import Link from 'next/link'
import type { BreadcrumbItem } from '../lib/breadcrumbs'

type BreadcrumbsProps = {
  items: BreadcrumbItem[]
  className?: string
}

export default function Breadcrumbs({ items, className }: BreadcrumbsProps) {
  if (!items || items.length === 0) return null

  const containerClass = className ?? 'border-b border-gray-200 bg-gray-50'

  return (
    <nav aria-label="Breadcrumb" className={containerClass}>
      <ol className="container flex flex-wrap items-center gap-2 py-2 text-sm text-gray-600">
        {items.map((item, index) => {
          const isLast = index === items.length - 1
          const content = isLast ? (
            <span aria-current="page" className="font-medium text-gray-900">
              {item.label}
            </span>
          ) : item.href ? (
            <Link href={item.href} className="text-blue-600 hover:underline">
              {item.label}
            </Link>
          ) : (
            <span className="text-gray-700">{item.label}</span>
          )
          return (
            <li key={`${item.label}-${index}`} className="flex items-center gap-2">
              {content}
              {!isLast && (
                <span className="text-gray-400" aria-hidden>
                  /
                </span>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
