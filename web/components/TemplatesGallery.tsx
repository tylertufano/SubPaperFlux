import { useEffect, useMemo, useState } from 'react'
import type { TemplateCategory } from '../sdk/src/models/TemplateCategory'
import type { TemplateMetadata } from '../sdk/src/models/TemplateMetadata'
import { getUiConfig, readUiConfigFromEnv } from '../lib/openapi'
import { useI18n } from '../lib/i18n'

export type TemplatesGalleryProps = {
  templates: TemplateMetadata[]
  categories: TemplateCategory[]
  isLoading?: boolean
  error?: string | null
  onRetry?: () => void
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B'
  }
  const units = ['B', 'KB', 'MB', 'GB']
  let size = bytes
  let index = 0
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024
    index += 1
  }
  return `${size % 1 === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[index]}`
}

function buildDownloadHref(apiBase: string, path: string): string {
  if (!apiBase) {
    return path
  }
  const normalizedBase = apiBase.endsWith('/') ? apiBase.slice(0, -1) : apiBase
  return `${normalizedBase}${path}`
}

export default function TemplatesGallery({
  templates,
  categories,
  isLoading = false,
  error,
  onRetry,
}: TemplatesGalleryProps) {
  const { t } = useI18n()
  const [selectedCategories, setSelectedCategories] = useState<string[]>([])
  const [apiBase, setApiBase] = useState<string>(() => {
    if (typeof window === 'undefined') {
      return readUiConfigFromEnv().apiBase || ''
    }
    return ''
  })

  useEffect(() => {
    if (typeof window === 'undefined' || apiBase) {
      return
    }
    let active = true
    getUiConfig()
      .then((config) => {
        if (!active) return
        setApiBase(config.apiBase || '')
      })
      .catch(() => {
        if (!active) return
        setApiBase('')
      })
    return () => {
      active = false
    }
  }, [apiBase])

  const categoryLookup = useMemo(() => {
    const map = new Map<string, string>()
    for (const category of categories) {
      if (category?.id) {
        map.set(category.id, category.label)
      }
    }
    return map
  }, [categories])

  const visibleTemplates = useMemo(() => {
    if (!selectedCategories.length) {
      return templates
    }
    const selectedSet = new Set(selectedCategories)
    return templates.filter((template) =>
      template.categories?.some((category: string) =>
        selectedSet.has(category ?? ''),
      ) ?? false,
    )
  }, [templates, selectedCategories])

  function toggleCategory(categoryId: string) {
    setSelectedCategories((current) => {
      if (current.includes(categoryId)) {
        return current.filter((id) => id !== categoryId)
      }
      return [...current, categoryId]
    })
  }

  function clearFilters() {
    setSelectedCategories([])
  }

  return (
    <section aria-live={isLoading ? 'polite' : undefined}>
      {categories.length > 0 ? (
        <fieldset className="mb-6 border border-gray-200 rounded-lg p-4">
          <legend className="px-1 text-sm font-semibold text-gray-700">
            {t('templates_filters_label')}
          </legend>
          <div className="flex flex-wrap gap-2 items-center">
            {categories.map((category) => {
              const active = selectedCategories.includes(category.id)
              return (
                <button
                  key={category.id}
                  type="button"
                  className={`px-3 py-1 rounded-full border text-sm transition-colors ${
                    active
                      ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                      : 'bg-white text-gray-700 border-gray-300 hover:border-blue-400'
                  }`}
                  onClick={() => toggleCategory(category.id)}
                >
                  {category.label}
                </button>
              )
            })}
            {selectedCategories.length > 0 ? (
              <button
                type="button"
                className="text-sm text-blue-600 hover:text-blue-800 underline"
                onClick={clearFilters}
              >
                {t('templates_filter_clear')}
              </button>
            ) : null}
          </div>
        </fieldset>
      ) : null}

      {isLoading ? (
        <p className="text-sm text-gray-600" data-testid="templates-loading">
          {t('templates_loading')}
        </p>
      ) : null}

      {error ? (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <p>{t('templates_error_loading', { reason: error })}</p>
          {onRetry ? (
            <button
              type="button"
              className="mt-2 inline-flex items-center gap-1 rounded-md border border-red-200 bg-white px-3 py-1 text-sm font-medium text-red-700 hover:border-red-300"
              onClick={onRetry}
            >
              {t('templates_retry')}
            </button>
          ) : null}
        </div>
      ) : null}

      {!isLoading && !error && visibleTemplates.length === 0 ? (
        <p className="text-sm text-gray-600" data-testid="templates-empty">
          {t('templates_empty')}
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {visibleTemplates.map((template) => (
          <article
            key={template.id}
            className="flex h-full flex-col justify-between rounded-lg border border-gray-200 bg-white p-4 shadow-sm"
          >
            <div>
              <h3 className="text-lg font-semibold text-gray-900">{template.title}</h3>
              <p className="mt-2 text-sm text-gray-600">{template.description}</p>
              <dl className="mt-3 space-y-1 text-sm text-gray-600">
                <div className="flex items-center gap-2">
                  <dt className="font-medium text-gray-700">{t('templates_format_label')}:</dt>
                  <dd className="uppercase tracking-wide">{template.format}</dd>
                </div>
                <div className="flex items-center gap-2">
                  <dt className="font-medium text-gray-700">{t('templates_size_label')}:</dt>
                  <dd>{formatBytes(template.sizeBytes)}</dd>
                </div>
                <div>
                  <dt className="font-medium text-gray-700">{t('templates_categories_label')}:</dt>
                  <dd className="mt-1 flex flex-wrap gap-2">
                    {(template.categories ?? []).map((categoryId) => (
                      <span
                        key={`${template.id}-${categoryId}`}
                        className="rounded-full border border-gray-300 bg-gray-100 px-2 py-0.5 text-xs text-gray-700"
                      >
                        {categoryLookup.get(categoryId) ?? categoryId}
                      </span>
                    ))}
                  </dd>
                </div>
              </dl>
            </div>
            <div className="mt-4 flex items-center justify-between">
              <span className="text-xs text-gray-400">{template.filename}</span>
              <a
                className="inline-flex items-center rounded-md bg-blue-600 px-3 py-1 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
                href={buildDownloadHref(apiBase, template.downloadUrl)}
              >
                {t('templates_download')}
              </a>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}
