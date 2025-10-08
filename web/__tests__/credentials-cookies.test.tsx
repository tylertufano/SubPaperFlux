import { screen, within, waitFor, fireEvent } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { setup, getCredentialCookiesMock } from './credentials-form.test'

describe('Credentials cookies viewer', () => {
  it('displays cookies returned by the API', async () => {
    await setup({
      data: {
        items: [
          {
            id: 'cred-1',
            description: 'Site Login',
            kind: 'site_login',
            site_config_id: 'sc-1',
          },
        ],
      },
    })

    getCredentialCookiesMock.mockResolvedValue({
      cookies: [
        {
          name: 'session',
          value: 'abc123',
          domain: '.example.com',
          path: '/',
          expiry: '2024-05-01T00:00:00Z',
        },
      ],
      lastRefresh: '2024-05-01T12:00:00Z',
      expiryHint: 'Session',
    })

    const viewCookiesButton = await screen.findByRole('button', { name: 'View cookies' })
    fireEvent.click(viewCookiesButton)

    await waitFor(() => {
      expect(getCredentialCookiesMock).toHaveBeenCalledWith({ credId: 'cred-1' })
    })

    const dialog = await screen.findByRole('dialog', { name: /Cookies for/i })
    const table = within(dialog).getByRole('table', { name: 'Cookies' })

    expect(within(table).getByText('session')).toBeInTheDocument()
    expect(within(table).getByText('.example.com')).toBeInTheDocument()
    expect(within(table).getByText('/')).toBeInTheDocument()
    expect(within(dialog).getByText(/Last refresh:/)).toBeInTheDocument()
  })
})
