import React from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import EmptyState from '../components/EmptyState'

describe('EmptyState', () => {
  it('displays the provided message and action for empty datasets', () => {
    render(
      <EmptyState
        icon={<span role="img" aria-label="empty">
          📭
        </span>}
        message="No records found"
        action={<button type="button">Create first item</button>}
      />,
    )

    expect(screen.getByText('No records found')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create first item' })).toBeInTheDocument()
  })
})
