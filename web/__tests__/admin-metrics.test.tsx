import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, screen, within } from '@testing-library/react'
import { renderWithSWR, makeSWRSuccess } from './helpers/renderWithSWR'
import { parsePrometheusMetrics } from '../lib/openapi'
import AdminMetrics from '../pages/admin/metrics'

vi.mock('next/router', () => ({
  useRouter: () => ({ pathname: '/admin/metrics' }),
}))

vi.mock('../components', () => ({
  __esModule: true,
  Nav: () => <nav data-testid="nav">Nav</nav>,
  Breadcrumbs: ({ items }: { items: Array<{ label: string }> }) => (
    <nav data-testid="breadcrumbs">{items.map((item) => item.label).join(' / ')}</nav>
  ),
  Alert: ({ message }: { message: React.ReactNode }) => <div data-testid="alert">{message}</div>,
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

describe('AdminMetrics page', () => {
  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    localStorage.clear()
  })

  it('renders aggregated counters and histogram buckets', () => {
    const metricsText = `# HELP user_logins_total Login count\n` +
      `# TYPE user_logins_total counter\n` +
      `user_logins_total 42\n` +
      `# HELP admin_actions_total Admin actions\n` +
      `# TYPE admin_actions_total counter\n` +
      `admin_actions_total{action="create_user"} 3\n` +
      `admin_actions_total{action="delete_user"} 1\n` +
      `# HELP jobs_processed_total Jobs processed\n` +
      `# TYPE jobs_processed_total counter\n` +
      `jobs_processed_total{type="ingest",status="done"} 10\n` +
      `jobs_processed_total{type="ingest",status="failed"} 2\n` +
      `jobs_processed_total{type="sync",status="done"} 5\n` +
      `# HELP api_request_duration_seconds Request latency\n` +
      `# TYPE api_request_duration_seconds histogram\n` +
      `api_request_duration_seconds_bucket{le="0.10",method="GET",path="/v1/status"} 3\n` +
      `api_request_duration_seconds_bucket{le="0.25",method="GET",path="/v1/status"} 8\n` +
      `api_request_duration_seconds_bucket{le="+Inf",method="GET",path="/v1/status"} 9\n` +
      `api_request_duration_seconds_sum{method="GET",path="/v1/status"} 1.234\n` +
      `api_request_duration_seconds_count{method="GET",path="/v1/status"} 9\n` +
      `# HELP job_duration_seconds Job durations\n` +
      `# TYPE job_duration_seconds histogram\n` +
      `job_duration_seconds_bucket{le="0.50",type="ingest"} 5\n` +
      `job_duration_seconds_bucket{le="+Inf",type="ingest"} 6\n` +
      `job_duration_seconds_sum{type="ingest"} 2.5\n` +
      `job_duration_seconds_count{type="ingest"} 6\n`

    const parsed = parsePrometheusMetrics(metricsText)

    renderWithSWR(<AdminMetrics />, {
      locale: 'en',
      swr: {
        handlers: [
          {
            matcher: (key: any) => Array.isArray(key) && key[0] === 'admin-metrics',
            value: makeSWRSuccess(parsed),
          },
        ],
      },
    })

    expect(screen.getByRole('heading', { name: 'Metrics' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Login activity' })).toBeInTheDocument()
    expect(screen.getByText('Total logins recorded')).toBeInTheDocument()
    const loginTable = screen.getByRole('table', { name: 'Login counters' })
    expect(within(loginTable).getByText('Total')).toBeInTheDocument()
    expect(within(loginTable).getByText('42')).toBeInTheDocument()

    expect(screen.getByRole('heading', { name: 'Admin actions' })).toBeInTheDocument()
    const adminTable = screen.getByRole('table', { name: 'Administrative action counters' })
    expect(within(adminTable).getByText('create_user')).toBeInTheDocument()
    expect(within(adminTable).getByText('3')).toBeInTheDocument()
    expect(within(adminTable).getByText('delete_user')).toBeInTheDocument()
    expect(within(adminTable).getByText('1')).toBeInTheDocument()

    expect(screen.getByRole('heading', { name: 'Job execution status' })).toBeInTheDocument()
    const statusTable = screen.getByRole('table', { name: 'Job status counters' })
    expect(within(statusTable).getByText('ingest')).toBeInTheDocument()
    expect(within(statusTable).getByText('10')).toBeInTheDocument()
    expect(within(statusTable).getByText('2')).toBeInTheDocument()
    expect(within(statusTable).getByText('sync')).toBeInTheDocument()
    expect(within(statusTable).getByText('5')).toBeInTheDocument()

    expect(screen.getByRole('heading', { name: 'API request latency' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Job execution duration' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'GET /v1/status' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'ingest' })).toBeInTheDocument()

    const requestTable = screen.getByRole('table', { name: 'Request latency buckets' })
    expect(within(requestTable).getByText('≤ 0.25s')).toBeInTheDocument()
    expect(within(requestTable).getByText('Total')).toBeInTheDocument()
    expect(within(requestTable).getByText('8')).toBeInTheDocument()
    expect(within(requestTable).getByText('9')).toBeInTheDocument()
    expect(screen.getByText('Samples recorded: 9')).toBeInTheDocument()
    expect(screen.getByText('Total duration: 1.234s')).toBeInTheDocument()

    const jobTable = screen.getByRole('table', { name: 'Job duration buckets' })
    expect(within(jobTable).getByText('≤ 0.50s')).toBeInTheDocument()
    expect(within(jobTable).getByText('Total')).toBeInTheDocument()
    expect(within(jobTable).getByText('6')).toBeInTheDocument()
    expect(screen.getByText('Samples recorded: 6')).toBeInTheDocument()
    expect(screen.getByText('Total duration: 2.500s')).toBeInTheDocument()
  })

  it('localizes metrics when using a non-English locale', () => {
    const metricsText = `# HELP user_logins_total Login count\n` +
      `# TYPE user_logins_total counter\n` +
      `user_logins_total 1234\n` +
      `# HELP admin_actions_total Admin actions\n` +
      `# TYPE admin_actions_total counter\n` +
      `admin_actions_total{action="create_user"} 9876\n` +
      `# HELP jobs_processed_total Jobs processed\n` +
      `# TYPE jobs_processed_total counter\n` +
      `jobs_processed_total{type="ingest",status="done"} 4321\n` +
      `jobs_processed_total{type="ingest",status="failed"} 210\n` +
      `# HELP api_request_duration_seconds Request latency\n` +
      `# TYPE api_request_duration_seconds histogram\n` +
      `api_request_duration_seconds_bucket{le="1.00",method="GET",path="/v1/status"} 1000\n` +
      `api_request_duration_seconds_bucket{le="2.00",method="GET",path="/v1/status"} 2000\n` +
      `api_request_duration_seconds_bucket{le="+Inf",method="GET",path="/v1/status"} 3000\n` +
      `api_request_duration_seconds_sum{method="GET",path="/v1/status"} 123.456\n` +
      `api_request_duration_seconds_count{method="GET",path="/v1/status"} 3000\n`

    const parsed = parsePrometheusMetrics(metricsText)

    renderWithSWR(<AdminMetrics />, {
      locale: 'de',
      swr: {
        handlers: [
          {
            matcher: (key: any) => Array.isArray(key) && key[0] === 'admin-metrics',
            value: makeSWRSuccess(parsed),
          },
        ],
      },
    })

    const loginTable = screen.getByRole('table', { name: 'Login counters' })
    expect(within(loginTable).getByText('1.234')).toBeInTheDocument()

    const adminTable = screen.getByRole('table', { name: 'Administrative action counters' })
    expect(within(adminTable).getByText('9.876')).toBeInTheDocument()

    const statusTable = screen.getByRole('table', { name: 'Job status counters' })
    expect(within(statusTable).getByText('4.321')).toBeInTheDocument()
    expect(within(statusTable).getByText('210')).toBeInTheDocument()

    const requestTable = screen.getByRole('table', { name: 'Request latency buckets' })
    expect(within(requestTable).getByText('1.000')).toBeInTheDocument()
    expect(within(requestTable).getByText('2.000')).toBeInTheDocument()
    expect(within(requestTable).getByText('3.000')).toBeInTheDocument()

    expect(screen.getByText('Samples recorded: 3.000')).toBeInTheDocument()
    expect(screen.getByText('Total duration: 123,456s')).toBeInTheDocument()
  })
})
