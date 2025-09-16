import React from 'react'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import PreviewPane from '../components/PreviewPane'

describe('PreviewPane', () => {
  it('removes unsafe markup but preserves safe content', () => {
    const snippet = [
      '# Hello World',
      "<script>alert('pwnd')</script>",
      '<style>body { background: red; }</style>',
      'Paragraph with [link](https://example.com)',
      '![Sneaky](data:image/gif;base64,AAAA)',
    ].join('\n\n')

    render(<PreviewPane snippet={snippet} ariaLabel="Bookmark preview" />)

    const region = screen.getByRole('region', { name: 'Bookmark preview' })
    expect(region).toHaveAttribute('tabindex', '0')
    expect(region.querySelector('script')).toBeNull()
    expect(region.querySelector('style')).toBeNull()
    expect(region).toHaveTextContent('Hello World')
    expect(region).toHaveTextContent('Paragraph with link')
    const link = region.querySelector('a') as HTMLAnchorElement | null
    expect(link).not.toBeNull()
    expect(link?.getAttribute('href')).toBe('https://example.com')
    const image = region.querySelector('img') as HTMLImageElement | null
    expect(image).not.toBeNull()
    expect(image?.getAttribute('alt')).toBe('Sneaky')
    expect(image?.getAttribute('src')).toBeNull()
  })
})
