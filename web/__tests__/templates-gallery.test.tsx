import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TemplatesGallery from '../components/TemplatesGallery'
import { I18nProvider } from '../lib/i18n'

const uiConfig = {
  apiBase: 'https://api.example.com',
  userMgmtCore: true,
  userMgmtUi: true,
  profile: 'test',
}

vi.mock('../lib/openapi', () => ({
  __esModule: true,
  getUiConfig: () => Promise.resolve(uiConfig),
  readUiConfigFromEnv: () => uiConfig,
}))

function renderGallery(props: React.ComponentProps<typeof TemplatesGallery>) {
  return render(
    <I18nProvider>
      <TemplatesGallery {...props} />
    </I18nProvider>,
  )
}

describe('TemplatesGallery', () => {
  afterEach(() => {
    cleanup()
  })

  const templates = [
    {
      id: 'docker-compose-api',
      title: 'Docker Compose (API)',
      description: 'Run the API locally',
      filename: 'docker-compose.api.example.yml',
      downloadUrl: '/v1/templates/docker-compose-api/download',
      format: 'yml',
      sizeBytes: 1536,
      categories: ['docker'],
    },
    {
      id: 'subpaperflux-config',
      title: 'Worker configuration',
      description: 'Configure SubPaperFlux',
      filename: 'subpaperflux.example.ini',
      downloadUrl: '/v1/templates/subpaperflux-config/download',
      format: 'ini',
      sizeBytes: 4096,
      categories: ['configuration'],
    },
  ]

  const categories = [
    { id: 'docker', label: 'Docker' },
    { id: 'configuration', label: 'Configuration' },
  ]

  beforeEach(() => {
    try {
      localStorage.setItem('locale', 'en')
    } catch {}
  })

  it('renders templates and filters by category', async () => {
    renderGallery({ templates, categories })

    expect(await screen.findByRole('heading', { name: 'Docker Compose (API)' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Worker configuration' })).toBeInTheDocument()
    expect(screen.getByText('1.5 KB')).toBeInTheDocument()

    const dockerFilter = screen.getByRole('button', { name: 'Docker' })
    fireEvent.click(dockerFilter)

    expect(screen.getByRole('heading', { name: 'Docker Compose (API)' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Worker configuration' })).toBeNull()

    const clearButton = screen.getByRole('button', { name: 'Clear filters' })
    fireEvent.click(clearButton)

    expect(screen.getByRole('heading', { name: 'Worker configuration' })).toBeInTheDocument()
  })

  it('shows download links using the configured API base', async () => {
    renderGallery({ templates, categories })

    const downloadLinks = await screen.findAllByRole('link', { name: 'Download' })
    expect(downloadLinks).toHaveLength(2)
    expect(downloadLinks[0]).toHaveAttribute(
      'href',
      'https://api.example.com/v1/templates/docker-compose-api/download',
    )
  })

  it('renders loading and error states', () => {
    const retry = vi.fn()
    renderGallery({ templates: [], categories: [], isLoading: true, error: 'Timeout', onRetry: retry })

    expect(screen.getByTestId('templates-loading')).toHaveTextContent('Loading templates…')
    expect(screen.getByText("We couldn't load templates: Timeout")).toBeInTheDocument()

    const retryButton = screen.getByRole('button', { name: 'Try again' })
    fireEvent.click(retryButton)
    expect(retry).toHaveBeenCalledTimes(1)
  })

  it('formats size using localized units', async () => {
    try {
      localStorage.setItem('locale', 'pseudo')
    } catch {}

    renderGallery({ templates, categories })

    expect(await screen.findByText('1.5 KB ✨')).toBeInTheDocument()

    try {
      localStorage.setItem('locale', 'en')
    } catch {}
  })
})
