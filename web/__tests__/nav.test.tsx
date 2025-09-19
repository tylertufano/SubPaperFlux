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
    data: { user: { name: 'Test User', roles: ['admin'] } },
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
      data: { user: { name: 'Test User', roles: ['admin'] } },
      status: 'authenticated' as const,
    })
  })

  function getAccountDropdowns() {
    return screen.getAllByTestId('dropdown-Test User')
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
      accountDropdowns.some((dropdown) => within(dropdown).queryByText('Audit Log')),
    ).toBe(true)
    expect(
      accountDropdowns.some((dropdown) => within(dropdown).queryByText('Admin')),
    ).toBe(true)
  })

  it('hides admin links for users without admin privileges', () => {
    useSessionMock.mockReturnValue({
      data: { user: { name: 'Test User', roles: [] } },
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
  })
})
