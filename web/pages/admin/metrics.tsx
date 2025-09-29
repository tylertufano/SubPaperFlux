import { useMemo } from 'react'
import useSWR from 'swr'
import { useRouter } from 'next/router'
import { Alert, Breadcrumbs, ErrorBoundary, Nav } from '../../components'
import { buildBreadcrumbs } from '../../lib/breadcrumbs'
import { useI18n } from '../../lib/i18n'
import type { PrometheusHistogramBucket, PrometheusHistogramSeries } from '../../lib/openapi'
import { fetchPrometheusMetrics } from '../../lib/openapi'

function formatEndpointLabel(series: PrometheusHistogramSeries, fallback: string) {
  const method = series.labels.method
  const path = series.labels.path
  if (method || path) {
    return [method, path].filter(Boolean).join(' ')
  }
  if (Object.keys(series.labels).length > 0) {
    return Object.entries(series.labels)
      .map(([key, value]) => `${key}=${value}`)
      .join(', ')
  }
  return fallback
}

function formatJobLabel(series: PrometheusHistogramSeries, fallback: string) {
  const type = series.labels.type || series.labels.job || series.labels.name
  const status = series.labels.status
  if (type && status) {
    return `${type} (${status})`
  }
  if (type) {
    return type
  }
  if (Object.keys(series.labels).length > 0) {
    return Object.entries(series.labels)
      .map(([key, value]) => `${key}=${value}`)
      .join(', ')
  }
  return fallback
}

function formatBucketLabel(bucket: PrometheusHistogramBucket, formatter: (value: string) => string, infLabel: string) {
  if (bucket.rawUpperBound === '+Inf' || bucket.upperBound === null) {
    return infLabel
  }
  return formatter(bucket.rawUpperBound)
}

type HistogramSectionProps = {
  title: string
  description: string
  emptyMessage: string
  tableLabel: string
  bucketHeading: string
  countHeading: string
  series: PrometheusHistogramSeries[]
  resolveLabel: (series: PrometheusHistogramSeries) => string
  formatBucket: (bucket: PrometheusHistogramBucket) => string
  totalLabel: (series: PrometheusHistogramSeries) => string
  sumLabel: (series: PrometheusHistogramSeries) => string | null
}

function HistogramSection({
  title,
  description,
  emptyMessage,
  tableLabel,
  bucketHeading,
  countHeading,
  series,
  resolveLabel,
  formatBucket,
  totalLabel,
  sumLabel,
}: HistogramSectionProps) {
  return (
    <section className="card p-4 space-y-4">
      <header>
        <h3 className="text-lg font-semibold">{title}</h3>
        <p className="text-sm text-gray-600">{description}</p>
      </header>
      {series.length === 0 ? (
        <p className="text-sm text-gray-600">{emptyMessage}</p>
      ) : (
        <div className="space-y-6">
          {series.map((item) => {
            const label = resolveLabel(item)
            return (
              <div key={label} className="space-y-3">
                <h4 className="font-semibold text-gray-800">{label}</h4>
                <table className="table" role="table" aria-label={tableLabel}>
                  <thead className="bg-gray-100">
                    <tr>
                      <th className="th text-left">{bucketHeading}</th>
                      <th className="th text-right">{countHeading}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {item.buckets.map((bucket) => (
                      <tr key={bucket.rawUpperBound} className="odd:bg-white even:bg-gray-50">
                        <td className="td">{formatBucket(bucket)}</td>
                        <td className="td text-right">{bucket.cumulativeCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="text-sm text-gray-700">
                  <p>{totalLabel(item)}</p>
                  {sumLabel(item) ? <p>{sumLabel(item)}</p> : null}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

export default function AdminMetrics() {
  const { t } = useI18n()
  const router = useRouter()
  const breadcrumbs = useMemo(() => buildBreadcrumbs(router.pathname, t), [router.pathname, t])
  const { data, error, isLoading, mutate } = useSWR(['admin-metrics'], () => fetchPrometheusMetrics())

  const requestSeries = data?.histograms['api_request_duration_seconds'] ?? []
  const jobSeries = data?.histograms['job_duration_seconds'] ?? []

  const handleRetry = () => {
    void mutate()
  }

  const requestBucketFormatter = (value: string) => t('admin_metrics_bucket_value', { value })
  const jobBucketFormatter = (value: string) => t('admin_metrics_bucket_value', { value })

  return (
    <ErrorBoundary onRetry={handleRetry}>
      <div>
        <Nav />
        <Breadcrumbs items={breadcrumbs} />
        <main className="container py-6 space-y-6">
          <header className="space-y-2">
            <h2 className="text-xl font-semibold">{t('admin_metrics_heading')}</h2>
            <p className="text-sm text-gray-600">{t('admin_metrics_description')}</p>
          </header>
          {isLoading ? <p className="text-sm text-gray-600">{t('loading_text')}</p> : null}
          {error ? (
            <Alert
              kind="error"
              message={error instanceof Error ? error.message : t('admin_metrics_generic_error')}
            />
          ) : null}
          <HistogramSection
            title={t('admin_metrics_requests_heading')}
            description={t('admin_metrics_requests_description')}
            emptyMessage={t('admin_metrics_requests_empty')}
            tableLabel={t('admin_metrics_table_label_requests')}
            bucketHeading={t('admin_metrics_bucket_column')}
            countHeading={t('admin_metrics_count_column')}
            series={requestSeries}
            resolveLabel={(series) => formatEndpointLabel(series, t('admin_metrics_all_requests'))}
            formatBucket={(bucket) =>
              formatBucketLabel(bucket, requestBucketFormatter, t('admin_metrics_bucket_plus_inf'))
            }
            totalLabel={(series) =>
              t('admin_metrics_total_count', {
                count: series.count != null ? series.count : series.buckets.at(-1)?.cumulativeCount ?? 0,
              })
            }
            sumLabel={(series) =>
              series.sum != null
                ? t('admin_metrics_total_sum', { sum: series.sum.toFixed(3) })
                : null
            }
          />
          <HistogramSection
            title={t('admin_metrics_jobs_heading')}
            description={t('admin_metrics_jobs_description')}
            emptyMessage={t('admin_metrics_jobs_empty')}
            tableLabel={t('admin_metrics_table_label_jobs')}
            bucketHeading={t('admin_metrics_bucket_column')}
            countHeading={t('admin_metrics_count_column')}
            series={jobSeries}
            resolveLabel={(series) => formatJobLabel(series, t('admin_metrics_all_jobs'))}
            formatBucket={(bucket) =>
              formatBucketLabel(bucket, jobBucketFormatter, t('admin_metrics_bucket_plus_inf'))
            }
            totalLabel={(series) =>
              t('admin_metrics_total_count', {
                count: series.count != null ? series.count : series.buckets.at(-1)?.cumulativeCount ?? 0,
              })
            }
            sumLabel={(series) =>
              series.sum != null ? t('admin_metrics_total_sum', { sum: series.sum.toFixed(3) }) : null
            }
          />
        </main>
      </div>
    </ErrorBoundary>
  )
}
