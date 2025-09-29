import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
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
  it('renders parsed histogram buckets for requests and jobs', () => {
    const metricsText = `# HELP api_request_duration_seconds Request latency\n` +
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
})
