import React from 'react'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import PreviewPane from '../components/PreviewPane'

describe('PreviewPane', () => {
  it('removes script and style tags from snippets', () => {
    const snippet = `# Hello World\n\n<script>alert('pwnd')</script>\n\n<style>body { background: red; }</style>\n\nParagraph with [link](https://example.com)`

    render(<PreviewPane snippet={snippet} ariaLabel="Bookmark preview" />)

    const region = screen.getByRole('region', { name: 'Bookmark preview' })
    expect(region.querySelector('script')).toBeNull()
    expect(region.querySelector('style')).toBeNull()
    expect(region).toHaveTextContent('Hello World')
    expect(region).toHaveTextContent('Paragraph with link')
    const link = region.querySelector('a') as HTMLAnchorElement | null
    expect(link).not.toBeNull()
    expect(link?.getAttribute('href')).toBe('https://example.com')
  })
})
