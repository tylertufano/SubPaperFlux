import { useMemo } from 'react'
import useSWR from 'swr'
import { useRouter } from 'next/router'
import { Breadcrumbs, Nav, TemplatesGallery } from '../components'
import { useI18n } from '../lib/i18n'
import { buildBreadcrumbs } from '../lib/breadcrumbs'
import { v1 } from '../lib/openapi'

export default function TemplatesPage() {
  const { t } = useI18n()
  const router = useRouter()
  const breadcrumbs = useMemo(() => buildBreadcrumbs(router.pathname, t), [router.pathname, t])
  const { data, error, isLoading, mutate } = useSWR(['/v1/templates'], () => v1.listTemplates())

  return (
    <>
      <Nav />
      <main className="container my-8 space-y-6">
        <Breadcrumbs items={breadcrumbs} />
        <header className="space-y-2">
          <h1 className="text-2xl font-semibold text-gray-900">{t('templates_title')}</h1>
          <p className="text-sm text-gray-600">{t('templates_description')}</p>
        </header>
        <TemplatesGallery
          templates={data?.templates ?? []}
          categories={data?.categories ?? []}
          isLoading={isLoading}
          error={error ? error.message ?? String(error) : null}
          onRetry={() => mutate()}
        />
      </main>
    </>
  )
}
