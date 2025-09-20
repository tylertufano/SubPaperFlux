import React from 'react'
import { renderWithSWR } from './helpers/renderWithSWR'
import { cleanup, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Nav from '../components/Nav'

const { useFeatureFlagsMock } = vi.hoisted(() => ({
  useFeatureFlagsMock: vi.fn(() => ({ userMgmtCore: true, userMgmtUi: true, isLoaded: true })),
}))

const { useSessionMock } = vi.hoisted(() => ({
  useSessionMock: vi.fn(() => ({
    data: {
      user: {
        name: 'Test User',
        displayName: 'Test User',
        roles: ['admin'],
        permissions: ['site_configs:manage', 'credentials:manage', 'bookmarks:manage'],
      },
    },
    status: 'authenticated' as const,
  })),
}))

vi.mock('next/router', () => ({
  useRouter: () => ({ pathname: '/' }),
}))

vi.mock('next-auth/react', () => ({
  __esModule: true,
  useSession: () => useSessionMock(),
  signIn: vi.fn(),
  signOut: vi.fn(),
}))

vi.mock('../components/DropdownMenu', () => ({
  __esModule: true,
  default: ({ label, items }: { label: string; items: { label: string }[] }) => (
    <div data-testid={`dropdown-${label}`}>
      <span>{label}</span>
      <ul>
        {items.map((item, index) => (
          <li key={`${label}-${index}`}>{item.label}</li>
        ))}
      </ul>
    </div>
  ),
}))

vi.mock('../lib/featureFlags', () => ({
  __esModule: true,
  useFeatureFlags: () => useFeatureFlagsMock(),
}))

describe('Nav component', () => {
  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    useFeatureFlagsMock.mockReset()
    useFeatureFlagsMock.mockReturnValue({ userMgmtCore: true, userMgmtUi: true, isLoaded: true })
    useSessionMock.mockReset()
    useSessionMock.mockReturnValue({
      data: {
        user: {
          name: 'Test User',
          displayName: 'Test User',
          roles: ['admin'],
          permissions: ['site_configs:manage', 'credentials:manage', 'bookmarks:manage'],
        },
      },
      status: 'authenticated' as const,
    })
  })

  function getAccountDropdowns() {
    return screen.getAllByTestId('dropdown-Test')
  }

  function getFeedsDropdown() {
    return screen.getByTestId('dropdown-Feeds')
  }

  it('shows admin navigation inside the account dropdown by default', () => {
    renderWithSWR(<Nav />, { locale: 'en' })

    const accountDropdowns = getAccountDropdowns()
    expect(screen.queryByRole('link', { name: 'Admin' })).toBeNull()
    expect(
      accountDropdowns.some((dropdown) => within(dropdown).queryByText('Users')),
    ).toBe(true)
    expect(
      accountDropdowns.some((dropdown) => within(dropdown).queryByText('Organizations')),
    ).toBe(true)
    expect(
      accountDropdowns.some((dropdown) => within(dropdown).queryByText('Site settings')),
    ).toBe(true)
    expect(
      accountDropdowns.some((dropdown) => within(dropdown).queryByText('Audit Log')),
    ).toBe(true)
    expect(
      accountDropdowns.some((dropdown) => within(dropdown).queryByText('Admin')),
    ).toBe(true)

    const feedsDropdown = getFeedsDropdown()
    expect(within(feedsDropdown).getByText('Create Feed')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Credentials' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Site Configs' })).toBeInTheDocument()
  })

  it('hides admin links for users without admin privileges', () => {
    useSessionMock.mockReturnValue({
      data: {
        user: {
          name: 'Test User',
          displayName: 'Test User',
          roles: [],
          permissions: [],
        },
      },
      status: 'authenticated' as const,
    })

    renderWithSWR(<Nav />, { locale: 'en' })

    const accountDropdowns = getAccountDropdowns()
    expect(
      accountDropdowns.every((dropdown) => !within(dropdown).queryByText('Admin')),
    ).toBe(true)
    expect(
      accountDropdowns.every((dropdown) => !within(dropdown).queryByText('Users')),
    ).toBe(true)
    expect(
      accountDropdowns.every((dropdown) => !within(dropdown).queryByText('Site settings')),
    ).toBe(true)

    const feedsDropdown = getFeedsDropdown()
    expect(within(feedsDropdown).queryByText('Create Feed')).toBeNull()
    expect(screen.queryByRole('link', { name: 'Credentials' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Site Configs' })).toBeNull()
  })

  it('shows partially privileged navigation when users hold specific permissions', () => {
    useSessionMock.mockReturnValue({
      data: {
        user: {
          name: 'Test User',
          displayName: 'Test User',
          roles: [],
          permissions: ['credentials:manage'],
        },
      },
      status: 'authenticated' as const,
    })

    renderWithSWR(<Nav />, { locale: 'en' })

    const feedsDropdown = getFeedsDropdown()
    expect(within(feedsDropdown).queryByText('Create Feed')).toBeNull()
    expect(screen.getByRole('link', { name: 'Credentials' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Site Configs' })).toBeNull()
  })
})
