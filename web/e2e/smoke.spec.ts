import { createServer, type Server } from 'node:http'
import { randomUUID } from 'node:crypto'
import { test, expect, type ApiHelper } from './fixtures'

type CredentialResponse = { id?: string }
type BookmarkResponse = { id?: string }

type StubServerContext = {
  server: Server
  baseUrl: string
  getMinifluxHits: () => number
}

async function startStubServer(previewSnippets: Map<string, string>): Promise<StubServerContext> {
  let baseUrl = ''
  let minifluxHits = 0

  const server = createServer((req, res) => {
    const requestUrl = new URL(req.url ?? '/', 'http://127.0.0.1')

    if (req.method === 'GET' && requestUrl.pathname.startsWith('/v1/feeds')) {
      minifluxHits += 1
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ items: [] }))
      return
    }

    if (req.method === 'GET' && previewSnippets.has(requestUrl.pathname)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(previewSnippets.get(requestUrl.pathname))
      return
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('not found')
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        reject(new Error('Unable to determine stub server address'))
        return
      }
      baseUrl = `http://127.0.0.1:${address.port}`
      server.off('error', reject)
      resolve()
    })
  })

  return {
    server,
    baseUrl,
    getMinifluxHits: () => minifluxHits,
  }
}

async function createBookmark(api: ApiHelper, seed: { url: string; title: string; contentLocation: string; instapaperBookmarkId: string }) {
  const result = (await api.createBookmark({
    url: seed.url,
    title: seed.title,
    contentLocation: seed.contentLocation,
    instapaperBookmarkId: seed.instapaperBookmarkId,
  })) as BookmarkResponse
  const id = result?.id
  if (!id) {
    throw new Error('Bookmark creation response did not include an id')
  }
  return id
}

test.describe('smoke flows', () => {
  test('can create credentials and preview bookmarks with bulk delete dry run', async ({ page, api }: { page: any; api: ApiHelper }) => {
    const uniqueSlug = randomUUID()
    const previewSnippets = new Map<string, string>()
    const stub = await startStubServer(previewSnippets)
    const createdCredentialIds: string[] = []
    const createdBookmarkIds: string[] = []

    try {
      await test.step('create and test a Miniflux credential', async () => {
        const minifluxUrl = stub.baseUrl
        const apiKey = `pw-key-${uniqueSlug}`

        await page.goto('/credentials', { waitUntil: 'networkidle' })
        await expect(page.getByRole('heading', { name: 'Credentials' })).toBeVisible()

        await page.fill('#create-credential-description', `Miniflux credential ${uniqueSlug}`)
        await page.selectOption('#credential-kind-select', 'miniflux')
        await page.fill('#create-credential-miniflux-url', `${minifluxUrl}`)
        await page.fill('#create-credential-api-key', apiKey)

        const createResponsePromise = page.waitForResponse((response: any) =>
          response.url().includes('/v1/credentials') && response.request().method() === 'POST',
        )
        await page.locator('#create-credential').getByRole('button', { name: 'Create' }).click()
        const createResponse = await createResponsePromise
        const created = (await createResponse.json()) as CredentialResponse
        const credentialId = created?.id
        if (!credentialId) {
          throw new Error('Credential creation response did not include an id')
        }
        createdCredentialIds.push(credentialId)

        const credentialBanner = page.locator('div[role="status"]').first()
        await expect(credentialBanner).toContainText('Credential created')

        const credentialRow = page.getByRole('row', { name: new RegExp(credentialId) })
        await expect(credentialRow).toBeVisible()

        const minifluxTestResponsePromise = page.waitForResponse((response: any) =>
          response.url().includes('/v1/integrations/miniflux/test') && response.request().method() === 'POST',
        )
        await credentialRow.getByRole('button', { name: 'Test' }).click()
        const minifluxTestResponse = await minifluxTestResponsePromise
        const minifluxPayload = await minifluxTestResponse.json()
        expect(minifluxPayload?.ok ?? false).toBeTruthy()

        await expect(credentialBanner).toContainText('Miniflux:')
      })

      await test.step('seed bookmarks via API', async () => {
        const titles = [
          `E2E Bookmark ${uniqueSlug} A`,
          `E2E Bookmark ${uniqueSlug} B`,
        ]
        const previewPaths = titles.map((_, index) => `/preview/${uniqueSlug}-${index}`)
        const snippets = titles.map((title, index) => `<article><h1>${title}</h1><p>Preview snippet ${index + 1}</p></article>`)

        previewPaths.forEach((path, index) => {
          previewSnippets.set(path, snippets[index])
        })

        for (let index = 0; index < titles.length; index += 1) {
          const bookmarkId = await createBookmark(api, {
            url: `${stub.baseUrl}${previewPaths[index]}`,
            title: titles[index],
            contentLocation: `${stub.baseUrl}${previewPaths[index]}`,
            instapaperBookmarkId: `pw-${uniqueSlug}-${index}`,
          })
          createdBookmarkIds.push(bookmarkId)
        }
      })

      await test.step('preview bookmarks and dry-run bulk delete', async () => {
        const keyword = `E2E Bookmark ${uniqueSlug}`
        const [firstTitle, secondTitle] = [
          `E2E Bookmark ${uniqueSlug} A`,
          `E2E Bookmark ${uniqueSlug} B`,
        ]

        await page.goto('/bookmarks', { waitUntil: 'networkidle' })
        await expect(page.getByRole('heading', { name: 'Bookmarks' })).toBeVisible()

        await page.getByLabel('Keyword').fill(keyword)
        await page.getByRole('button', { name: 'Search' }).click()

        const firstRow = page.getByRole('row', { name: new RegExp(firstTitle) })
        const secondRow = page.getByRole('row', { name: new RegExp(secondTitle) })
        await expect(firstRow).toBeVisible()
        await expect(secondRow).toBeVisible()

        const previewResponsePromise = page.waitForResponse((response: any) =>
          response.url().includes(`/v1/bookmarks/${createdBookmarkIds[0]}/preview`) && response.request().method() === 'GET',
        )
        await firstRow.click()
        await previewResponsePromise
        const previewRegion = page.getByRole('region', { name: 'Preview' })
        await expect(previewRegion).toContainText('Preview snippet 1')

        await page.getByRole('checkbox', { name: `Select bookmark ${firstTitle}` }).check()
        await page.getByRole('checkbox', { name: `Select bookmark ${secondTitle}` }).check()
        await expect(page.getByText('2 selected')).toBeVisible()

        const bulkDeletePayloads: Array<{ ids?: string[]; delete_remote?: boolean }> = []
        const handler = async (route: any) => {
          const body = route.request().postDataJSON()
          bulkDeletePayloads.push(body ?? {})
          await route.fulfill({ status: 204, body: '' })
        }

        await page.route('**/v1/bookmarks/bulk-delete', handler)

        const dialogPromise = page.waitForEvent('dialog')
        await page.getByRole('button', { name: 'Delete Selected' }).click()
        const dialog = await dialogPromise
        expect(dialog.type()).toBe('confirm')
        expect(dialog.message()).toContain('Delete 2 bookmarks?')
        await dialog.accept()

        await expect.poll(() => bulkDeletePayloads.length).toBe(1)
        const statusBanner = page.locator('div[role="status"]').first()
        await expect(statusBanner).toContainText('Deleted 2 bookmarks.')

        await page.unroute('**/v1/bookmarks/bulk-delete', handler)

        const payload = bulkDeletePayloads[0] ?? {}
        const ids = Array.isArray(payload.ids) ? payload.ids : []
        expect(new Set(ids)).toEqual(new Set(createdBookmarkIds))
        expect(payload.delete_remote).toBe(true)

        await page.reload({ waitUntil: 'networkidle' })
        await page.getByLabel('Keyword').fill(keyword)
        await page.getByRole('button', { name: 'Search' }).click()
        await expect(page.getByRole('row', { name: new RegExp(firstTitle) })).toBeVisible()
        await expect(page.getByRole('row', { name: new RegExp(secondTitle) })).toBeVisible()
      })
    } finally {
      for (const bookmarkId of createdBookmarkIds) {
        await api.deleteBookmark(bookmarkId, { deleteRemote: false }).catch(() => {})
      }
      for (const credentialId of createdCredentialIds) {
        await api.deleteCredential(credentialId).catch(() => {})
      }
      await new Promise<void>((resolve) => {
        stub.server.close(() => resolve())
      })
      expect(stub.getMinifluxHits()).toBeGreaterThan(0)
    }
  })
})
