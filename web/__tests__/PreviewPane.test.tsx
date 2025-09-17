import React from 'react'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import PreviewPane from '../components/PreviewPane'

describe('PreviewPane', () => {
  it('removes unsafe markup but preserves safe content', () => {
    const snippet = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>.noop { color: red; }</style>
        </head>
        <body style="background: red">
          <script>alert('pwnd')</script>
          <div onclick="alert('xss')">
            <p>Hello <strong>World</strong></p>
            <p>
              Paragraph with <a href="javascript:alert('oops')">link</a>
              and <a href="https://example.com" title="Example">safe link</a>.
            </p>
            <img src="data:image/gif;base64,AAAA" alt="Sneaky" />
            <img src="https://safe.test/image.jpg" alt="Legit" />
          </div>
        </body>
      </html>
    `

    render(<PreviewPane snippet={snippet} ariaLabel="Bookmark preview" />)

    const region = screen.getByRole('region', { name: 'Bookmark preview' })
    expect(region).toHaveAttribute('tabindex', '0')
    expect(region.querySelector('script')).toBeNull()
    expect(region.querySelector('style')).toBeNull()
    expect(region).toHaveTextContent('Hello World')
    expect(region).toHaveTextContent('Paragraph with link and safe link')
    const allLinks = Array.from(region.querySelectorAll('a')) as HTMLAnchorElement[]
    const safeLinks = allLinks.filter(link => link.hasAttribute('href'))
    expect(safeLinks).toHaveLength(1)
    expect(safeLinks[0].getAttribute('href')).toBe('https://example.com')
    expect(safeLinks[0].getAttribute('title')).toBe('Example')
    const inertLinks = allLinks.filter(link => !link.hasAttribute('href'))
    expect(inertLinks).toHaveLength(1)
    expect(inertLinks[0].textContent).toContain('link')
    const images = Array.from(region.querySelectorAll('img')) as HTMLImageElement[]
    const safeImages = images.filter(img => img.hasAttribute('src'))
    expect(safeImages).toHaveLength(1)
    expect(safeImages[0].getAttribute('alt')).toBe('Legit')
    expect(safeImages[0].getAttribute('src')).toBe('https://safe.test/image.jpg')
    const inertImages = images.filter(img => !img.hasAttribute('src'))
    expect(inertImages).toHaveLength(1)
    expect(inertImages[0].getAttribute('alt')).toBe('Sneaky')
    expect(region.innerHTML.toLowerCase()).not.toContain('javascript:')
    expect(region.innerHTML.toLowerCase()).not.toContain('data:')
    expect(region.innerHTML.toLowerCase()).not.toContain('onclick')
  })
})
