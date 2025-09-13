import useSWR from 'swr'
import Nav from '../components/Nav'
import { sdk } from '../lib/sdk'
import { useEffect, useState } from 'react'
import Alert from '../components/Alert'

type SavedView = { name: string; search?: string; feed_id?: string; since?: string; until?: string; fuzzy?: boolean }

export default function Bookmarks() {
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [views, setViews] = useState<SavedView[]>([])
  const [newViewName, setNewViewName] = useState('')
  const [feedId, setFeedId] = useState('')
  const [since, setSince] = useState('')
  const [until, setUntil] = useState('')
  const [fuzzy, setFuzzy] = useState(false)
  function addZ(v?: string) { if (!v) return undefined; return v.endsWith('Z') ? v : v + ':00Z' }
  const { data, error, isLoading, mutate } = useSWR([`/v1/bookmarks`, page, search, feedId, since, until, fuzzy],
    ([, p, q, f, s, u, z]) => sdk.listBookmarks({ page: p, search: q, feed_id: f || undefined, since: addZ(s), until: addZ(u), fuzzy: z || undefined }))
  const { data: feeds } = useSWR([`/v1/feeds`], () => sdk.listFeeds())
  const feedItems = Array.isArray(feeds) ? feeds : feeds?.items ?? []
  const [banner, setBanner] = useState<{ kind: 'success' | 'error'; message: string } | null>(null)
  const [selected, setSelected] = useState<Record<string, boolean>>({})

  function clearFilters() {
    setSearch('')
    setFeedId('')
    setSince('')
    setUntil('')
    setFuzzy(false)
    setPage(1)
    mutate()
  }

  useEffect(() => {
    const raw = localStorage.getItem('bookmarkViews')
    if (raw) setViews(JSON.parse(raw))
  }, [])

  function saveView() {
    if (!newViewName.trim()) return
    const updated = [...views.filter(v => v.name !== newViewName.trim()), { name: newViewName.trim(), search, feed_id: feedId || undefined, since: since || undefined, until: until || undefined, fuzzy }]
    setViews(updated)
    localStorage.setItem('bookmarkViews', JSON.stringify(updated))
    setNewViewName('')
  }

  function applyView(v: SavedView) {
    setSearch(v.search || '')
    setFeedId(v.feed_id || '')
    setSince(v.since || '')
    setUntil(v.until || '')
    setFuzzy(!!v.fuzzy)
    setPage(1)
    mutate()
  }

  function toggleOne(id: string, checked: boolean) {
    setSelected(prev => ({ ...prev, [id]: checked }))
  }
  function toggleAll(checked: boolean) {
    const next: Record<string, boolean> = {}
    for (const b of data?.items ?? []) next[b.id] = checked
    setSelected(next)
  }
  async function bulkDelete() {
    const ids = Object.entries(selected).filter(([, v]) => v).map(([k]) => k)
    if (!ids.length) return
    if (!confirm(`Delete ${ids.length} bookmarks? This also deletes in Instapaper.`)) return
    try {
      await sdk.bulkDeleteBookmarks(ids, true)
      setBanner({ kind: 'success', message: `Deleted ${ids.length} bookmarks.` })
      setSelected({})
      mutate()
    } catch (e: any) {
      setBanner({ kind: 'error', message: `Delete failed: ${e.message || e}` })
    }
  }
  function exportSelected(fmt: 'json' | 'csv') {
    const items = (data?.items ?? []).filter((b: any) => selected[b.id])
    if (!items.length) return
    if (fmt === 'json') {
      const blob = new Blob([JSON.stringify(items, null, 2)], { type: 'application/json' })
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'bookmarks.json'; a.click()
    } else {
      const headers = ['id','instapaper_bookmark_id','title','url','content_location','feed_id','published_at']
      const rows = [headers.join(',')].concat(items.map((b: any) => headers.map(h => JSON.stringify(b[h] ?? '')).join(',')))
      const blob = new Blob([rows.join('\n')], { type: 'text/csv' })
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'bookmarks.csv'; a.click()
    }
  }
  return (
    <div>
      <Nav />
      <main className="container py-6">
        <div className="flex items-center gap-2 mb-3">
          <h2 className="text-xl font-semibold">Bookmarks</h2>
        </div>
        <div className="card p-4 mb-4 grid grid-cols-1 md:grid-cols-7 gap-2 items-center">
          <input className="input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search" />
          <select className="input" value={feedId} onChange={(e) => setFeedId(e.target.value)}>
            <option value="">All Feeds</option>
              {feedItems.map((f: any) => (
                <option key={f.id} value={f.id}>{f.url}</option>
              ))}
          </select>
          <input className="input" type="datetime-local" value={since} onChange={(e) => setSince(e.target.value)} title="Since" />
          <input className="input" type="datetime-local" value={until} onChange={(e) => setUntil(e.target.value)} title="Until" />
          <label className="inline-flex items-center gap-2 text-gray-700"><input type="checkbox" checked={fuzzy} onChange={(e) => setFuzzy(e.target.checked)} /> Fuzzy</label>
          <button className="btn" onClick={() => { setPage(1); mutate() }}>Search</button>
          <button className="btn" onClick={clearFilters}>Clear</button>
          <select className="input md:col-span-2" onChange={(e) => { const v = views.find(x => x.name === e.target.value); if (v) applyView(v) }} defaultValue="">
            <option value="" disabled>Saved Views</option>
            {views.map(v => <option key={v.name} value={v.name}>{v.name}</option>)}
          </select>
          <div className="flex items-center gap-2">
            <input className="input" placeholder="Save as..." value={newViewName} onChange={e => setNewViewName(e.target.value)} />
            <button className="btn" onClick={saveView}>Save View</button>
          </div>
        </div>
        {banner && <div className="mb-3"><Alert kind={banner.kind} message={banner.message} onClose={() => setBanner(null)} /></div>}
        {isLoading && <p className="text-gray-600">Loading...</p>}
        {error && <Alert kind="error" message={String(error)} />}
        {data && (
          <>
            <div className="card p-0 overflow-hidden">
              <div className="p-3 flex items-center gap-2">
                <button className="btn" disabled={!data.items?.length} onClick={bulkDelete}>Delete Selected</button>
                <button className="btn" disabled={!data.items?.length} onClick={() => exportSelected('json')}>Export JSON</button>
                <button className="btn" disabled={!data.items?.length} onClick={() => exportSelected('csv')}>Export CSV</button>
              </div>
              <table className="table">
                <thead className="bg-gray-100">
                  <tr>
                    <th className="th"><input type="checkbox" onChange={(e) => toggleAll(e.target.checked)} /></th>
                    <th className="th">Title</th>
                    <th className="th">URL</th>
                    <th className="th">Published</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((b: any) => (
                    <tr key={b.id} className="odd:bg-white even:bg-gray-50">
                      <td className="td"><input type="checkbox" checked={selected[b.id] || false} onChange={(e) => toggleOne(b.id, e.target.checked)} /></td>
                      <td className="td">{b.title}</td>
                      <td className="td"><a className="text-blue-600 hover:underline" href={b.url} target="_blank" rel="noreferrer">{b.url}</a></td>
                      <td className="td">{b.published_at || ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <button className="btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>Prev</button>
              <span className="text-gray-700">Page {page} / {data.totalPages}</span>
              <button className="btn" disabled={!data.hasNext} onClick={() => setPage(page + 1)}>Next</button>
            </div>
          </>
        )}
      </main>
    </div>
  )
}
