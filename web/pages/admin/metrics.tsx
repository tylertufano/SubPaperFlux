import { useCallback, useMemo, type ReactNode } from 'react'
import useSWR from 'swr'
import { useRouter } from 'next/router'
import { Alert, Breadcrumbs, ErrorBoundary, Nav } from '../../components'
import { buildBreadcrumbs } from '../../lib/breadcrumbs'
import { useI18n } from '../../lib/i18n'
import { formatNumberValue, useNumberFormatter } from '../../lib/format'
import type {
  PrometheusHistogramBucket,
  PrometheusHistogramSeries,
} from '../../lib/openapi'
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

function formatCount(value: number, formatter: Intl.NumberFormat): string {
  if (!Number.isFinite(value)) {
    return '0'
  }
  return formatNumberValue(value, formatter, '0')
}

function formatLabelEntries(labels: Record<string, string>, omitKeys: string[] = []): string {
  const omit = new Set(omitKeys)
  const entries = Object.entries(labels)
    .filter(([key]) => !omit.has(key))
    .sort(([a], [b]) => a.localeCompare(b))
  if (entries.length === 0) {
    return ''
  }
  return entries.map(([key, value]) => `${key}=${value}`).join(', ')
}

function formatGenericLabel(labels: Record<string, string>, fallback: string) {
  const label = formatLabelEntries(labels)
  return label || fallback
}

function formatAdminActionLabel(labels: Record<string, string>, fallback: string) {
  const action = labels.action?.trim()
  const extra = formatLabelEntries(labels, ['action'])
  if (action && extra) {
    return `${action} (${extra})`
  }
  if (action) {
    return action
  }
  return extra || fallback
}

function formatJobCounterLabel(labels: Record<string, string>, fallback: string) {
  const type = labels.type || labels.job || labels.name
  const extra = formatLabelEntries(labels, ['status', 'type', 'job', 'name'])
  if (type && extra) {
    return `${type} (${extra})`
  }
  if (type) {
    return type
  }
  return extra || fallback
}

type TrendColumn = {
  header: string
  numeric?: boolean
}

type TrendRow = {
  id: string
  values: Array<string | number>
}

type TrendCardProps = {
  title: string
  description: string
  totalLabel: string
  totalValue: number
  tableLabel: string
  emptyMessage: string
  columns: TrendColumn[]
  rows: TrendRow[]
  footer?: ReactNode
  countFormatter: Intl.NumberFormat
}

function TrendCard({
  title,
  description,
  totalLabel,
  totalValue,
  tableLabel,
  emptyMessage,
  columns,
  rows,
  footer,
  countFormatter,
}: TrendCardProps) {
  const formatTrendValue = useCallback(
    (value: number) => formatCount(value, countFormatter),
    [countFormatter],
  )
  const formattedTotal = formatTrendValue(totalValue)
  return (
    <section className="card p-4 space-y-4">
      <header className="space-y-1">
        <h3 className="text-lg font-semibold">{title}</h3>
        <p className="text-sm text-gray-600 dark:text-gray-300">{description}</p>
        <p className="text-3xl font-semibold text-gray-900 dark:text-gray-100" aria-live="polite">
          {formattedTotal}
        </p>
        <p className="text-sm text-gray-600 dark:text-gray-300">{totalLabel}</p>
      </header>
      {rows.length === 0 ? (
        <p className="text-sm text-gray-600 dark:text-gray-300">{emptyMessage}</p>
      ) : (
        <table className="table" aria-label={tableLabel}>
          <thead className="bg-gray-100 dark:bg-gray-800">
            <tr>
              {columns.map((column, columnIndex) => (
                <th
                  key={`${column.header}-${columnIndex}`}
                  className={`th ${column.numeric ? 'text-right' : 'text-left'}`}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="odd:bg-white even:bg-gray-50 dark:odd:bg-gray-800 dark:even:bg-gray-900">
                {row.values.map((value, valueIndex) => {
                  const column = columns[valueIndex]
                  const alignment = column?.numeric ? 'text-right' : 'text-left'
                  const content =
                    typeof value === 'number' && Number.isFinite(value)
                      ? formatTrendValue(value)
                      : value
                  return (
                    <td key={`${row.id}-${valueIndex}`} className={`td ${alignment}`}>
                      {content}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {footer ? <div className="text-sm text-gray-600 dark:text-gray-300">{footer}</div> : null}
    </section>
  )
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
  totalLabel: (series: PrometheusHistogramSeries, countFormatter: Intl.NumberFormat) => string
  sumLabel: (series: PrometheusHistogramSeries, sumFormatter: Intl.NumberFormat) => string | null
  countFormatter: Intl.NumberFormat
  sumFormatter: Intl.NumberFormat
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
  countFormatter,
  sumFormatter,
}: HistogramSectionProps) {
  return (
    <section className="card p-4 space-y-4">
      <header>
        <h3 className="text-lg font-semibold">{title}</h3>
        <p className="text-sm text-gray-600 dark:text-gray-300">{description}</p>
      </header>
      {series.length === 0 ? (
        <p className="text-sm text-gray-600 dark:text-gray-300">{emptyMessage}</p>
      ) : (
        <div className="space-y-6">
          {series.map((item) => {
            const label = resolveLabel(item)
            const sumText = sumLabel(item, sumFormatter)
            return (
              <div key={label} className="space-y-3">
                <h4 className="font-semibold text-gray-800 dark:text-gray-200">{label}</h4>
                <table className="table" role="table" aria-label={tableLabel}>
                  <thead className="bg-gray-100 dark:bg-gray-800">
                    <tr>
                      <th className="th text-left">{bucketHeading}</th>
                      <th className="th text-right">{countHeading}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {item.buckets.map((bucket) => (
                      <tr key={bucket.rawUpperBound} className="odd:bg-white even:bg-gray-50 dark:odd:bg-gray-800 dark:even:bg-gray-900">
                        <td className="td">{formatBucket(bucket)}</td>
                        <td className="td text-right">{formatCount(bucket.cumulativeCount, countFormatter)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="text-sm text-gray-700 dark:text-gray-300">
                  <p>{totalLabel(item, countFormatter)}</p>
                  {sumText ? <p>{sumText}</p> : null}
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

  const countFormatter = useNumberFormatter({ maximumFractionDigits: 2, minimumFractionDigits: 0 })
  const sumFormatter = useNumberFormatter({ maximumFractionDigits: 3, minimumFractionDigits: 3 })
  const formatCountValue = useCallback(
    (value: number) => formatCount(value, countFormatter),
    [countFormatter],
  )

  const counters = data?.counters ?? {}
  const requestSeries = data?.histograms['api_request_duration_seconds'] ?? []
  const jobSeries = data?.histograms['job_duration_seconds'] ?? []

  const loginSamples = counters['user_logins_total'] ?? []
  let loginTotal = 0
  const loginAggregates = new Map<string, { label: string; value: number }>()
  for (const sample of loginSamples) {
    loginTotal += sample.value
    const sortedEntries = Object.entries(sample.labels).sort(([a], [b]) => a.localeCompare(b))
    const key = JSON.stringify(sortedEntries)
    const label = formatGenericLabel(sample.labels, t('admin_metrics_total_label'))
    const existing = loginAggregates.get(key)
    if (existing) {
      existing.value += sample.value
    } else {
      loginAggregates.set(key, { label, value: sample.value })
    }
  }
  const loginRows = Array.from(loginAggregates.values())
    .sort((a, b) => a.label.localeCompare(b.label))
    .map((entry, index) => ({
      id: `login-${index}-${entry.label}`,
      values: [entry.label, entry.value],
    }))

  const adminSamples = counters['admin_actions_total'] ?? []
  let adminTotal = 0
  const adminAggregates = new Map<string, { label: string; value: number }>()
  for (const sample of adminSamples) {
    adminTotal += sample.value
    const sortedEntries = Object.entries(sample.labels).sort(([a], [b]) => a.localeCompare(b))
    const key = JSON.stringify(sortedEntries)
    const label = formatAdminActionLabel(sample.labels, t('admin_metrics_unknown_label'))
    const existing = adminAggregates.get(key)
    if (existing) {
      existing.value += sample.value
    } else {
      adminAggregates.set(key, { label, value: sample.value })
    }
  }
  const adminRows = Array.from(adminAggregates.values())
    .sort((a, b) => a.label.localeCompare(b.label))
    .map((entry, index) => ({
      id: `admin-${index}-${entry.label}`,
      values: [entry.label, entry.value],
    }))

  const jobSamples = counters['jobs_processed_total'] ?? []
  let jobTotal = 0
  const jobAggregates = new Map<
    string,
    { label: string; success: number; error: number; other: Map<string, number> }
  >()
  const additionalStatusTotals = new Map<string, number>()
  for (const sample of jobSamples) {
    jobTotal += sample.value
    const status = (sample.labels.status || '').toLowerCase()
    const sortedEntries = Object.entries(sample.labels)
      .filter(([key]) => key !== 'status')
      .sort(([a], [b]) => a.localeCompare(b))
    const key = JSON.stringify(sortedEntries)
    const label = formatJobCounterLabel(sample.labels, t('admin_metrics_unknown_label'))
    let aggregate = jobAggregates.get(key)
    if (!aggregate) {
      aggregate = { label, success: 0, error: 0, other: new Map<string, number>() }
      jobAggregates.set(key, aggregate)
    }
    if (status === 'done' || status === 'success' || status === 'succeeded' || status === 'completed') {
      aggregate.success += sample.value
    } else if (status === 'failed' || status === 'error') {
      aggregate.error += sample.value
    } else {
      const normalizedStatus = status || 'unknown'
      aggregate.other.set(normalizedStatus, (aggregate.other.get(normalizedStatus) ?? 0) + sample.value)
      additionalStatusTotals.set(
        normalizedStatus,
        (additionalStatusTotals.get(normalizedStatus) ?? 0) + sample.value,
      )
    }
  }

  const jobRows = Array.from(jobAggregates.values())
    .sort((a, b) => a.label.localeCompare(b.label))
    .map((entry, index) => ({
      id: `job-${index}-${entry.label}`,
      values: [entry.label, entry.success, entry.error],
    }))

  const jobAdditionalStatusesText =
    additionalStatusTotals.size > 0
      ? t('admin_metrics_jobs_status_other_note', {
          statuses: Array.from(additionalStatusTotals.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([status, count]) => `${status}: ${formatCountValue(count)}`)
            .join(', '),
        })
      : null

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
          <section className="grid gap-4 md:grid-cols-3">
            <TrendCard
              title={t('admin_metrics_logins_heading')}
              description={t('admin_metrics_logins_description')}
              totalLabel={t('admin_metrics_logins_total_label')}
              totalValue={loginTotal}
              tableLabel={t('admin_metrics_logins_table_label')}
              emptyMessage={t('admin_metrics_logins_empty')}
              columns={[
                { header: t('admin_metrics_logins_column_segment') },
                { header: t('admin_metrics_logins_column_count'), numeric: true },
              ]}
              rows={loginRows}
              countFormatter={countFormatter}
            />
            <TrendCard
              title={t('admin_metrics_actions_heading')}
              description={t('admin_metrics_actions_description')}
              totalLabel={t('admin_metrics_actions_total_label')}
              totalValue={adminTotal}
              tableLabel={t('admin_metrics_actions_table_label')}
              emptyMessage={t('admin_metrics_actions_empty')}
              columns={[
                { header: t('admin_metrics_actions_column_action') },
                { header: t('admin_metrics_actions_column_count'), numeric: true },
              ]}
              rows={adminRows}
              countFormatter={countFormatter}
            />
            <TrendCard
              title={t('admin_metrics_jobs_status_heading')}
              description={t('admin_metrics_jobs_status_description')}
              totalLabel={t('admin_metrics_jobs_status_total_label')}
              totalValue={jobTotal}
              tableLabel={t('admin_metrics_jobs_status_table_label')}
              emptyMessage={t('admin_metrics_jobs_status_empty')}
              columns={[
                { header: t('admin_metrics_jobs_status_column_type') },
                { header: t('admin_metrics_jobs_status_column_success'), numeric: true },
                { header: t('admin_metrics_jobs_status_column_error'), numeric: true },
              ]}
              rows={jobRows}
              footer={jobAdditionalStatusesText}
              countFormatter={countFormatter}
            />
          </section>
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
            totalLabel={(series, formatter) =>
              t('admin_metrics_total_count', {
                count: formatCount(
                  series.count != null ? series.count : series.buckets.at(-1)?.cumulativeCount ?? 0,
                  formatter,
                ),
              })
            }
            sumLabel={(series, formatter) =>
              series.sum != null
                ? t('admin_metrics_total_sum', { sum: formatNumberValue(series.sum, formatter, '0') })
                : null
            }
            countFormatter={countFormatter}
            sumFormatter={sumFormatter}
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
            totalLabel={(series, formatter) =>
              t('admin_metrics_total_count', {
                count: formatCount(
                  series.count != null ? series.count : series.buckets.at(-1)?.cumulativeCount ?? 0,
                  formatter,
                ),
              })
            }
            sumLabel={(series, formatter) =>
              series.sum != null
                ? t('admin_metrics_total_sum', { sum: formatNumberValue(series.sum, formatter, '0') })
                : null
            }
            countFormatter={countFormatter}
            sumFormatter={sumFormatter}
          />
        </main>
      </div>
    </ErrorBoundary>
  )
}
