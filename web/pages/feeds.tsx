import useSWR from 'swr'
import Nav from '../components/Nav'
import { v1, feeds as feedsApi } from '../lib/openapi'
import { useState } from 'react'
import Alert from '../components/Alert'

export default function Feeds() {
  const { data, error, isLoading, mutate } = useSWR(['/v1/feeds'], () => v1.listFeedsV1V1FeedsGet({}))
  const [url, setUrl] = useState('')
  const [poll, setPoll] = useState('1h')
  const [lookback, setLookback] = useState('')
  const [paywalled, setPaywalled] = useState(false)
  const [rssAuth, setRssAuth] = useState(false)
  const [siteConfigId, setSiteConfigId] = useState('')
  const [banner, setBanner] = useState<{ kind: 'success' | 'error'; message: string } | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editRow, setEditRow] = useState<any | null>(null)

  async function createFeed() {
    if (!url.trim()) { setBanner({ kind: 'error', message: 'URL is required' }); return }
    try {
      await feedsApi.createFeedFeedsPost({ feed: {
        url,
        pollFrequency: poll,
        initialLookbackPeriod: lookback || undefined,
        isPaywalled: paywalled,
        rssRequiresAuth: rssAuth,
        siteConfigId: siteConfigId || undefined,
      } as any })
      setUrl(''); setLookback(''); setSiteConfigId(''); setPaywalled(false); setRssAuth(false)
      setBanner({ kind: 'success', message: 'Feed created' })
      mutate()
    } catch (e: any) {
      setBanner({ kind: 'error', message: e?.message || String(e) })
    }
  }

  async function deleteFeed(id: string) {
    if (!confirm('Delete feed?')) return
    try {
      await feedsApi.deleteFeedFeedsFeedIdDelete({ feedId: id })
      setBanner({ kind: 'success', message: 'Feed deleted' })
      mutate()
    } catch (e: any) {
      setBanner({ kind: 'error', message: e?.message || String(e) })
    }
  }

  async function startEdit(f: any) {
    setEditingId(f.id)
    setEditRow({
      url: f.url || '',
      pollFrequency: f.poll_frequency || f.pollFrequency || '1h',
      initialLookbackPeriod: f.initial_lookback_period || f.initialLookbackPeriod || '',
      isPaywalled: !!(f.is_paywalled ?? f.isPaywalled),
      rssRequiresAuth: !!(f.rss_requires_auth ?? f.rssRequiresAuth),
      siteConfigId: f.site_config_id || f.siteConfigId || '',
    })
  }

  function cancelEdit() {
    setEditingId(null)
    setEditRow(null)
  }

  async function saveEdit(id: string) {
    try {
      await feedsApi.updateFeedFeedsFeedIdPut({
        feedId: id,
        feed: {
          url: editRow.url,
          pollFrequency: editRow.pollFrequency,
          initialLookbackPeriod: editRow.initialLookbackPeriod || undefined,
          isPaywalled: !!editRow.isPaywalled,
          rssRequiresAuth: !!editRow.rssRequiresAuth,
          siteConfigId: editRow.siteConfigId || undefined,
        } as any,
      })
      setBanner({ kind: 'success', message: 'Feed updated' })
      setEditingId(null)
      setEditRow(null)
      mutate()
    } catch (e: any) {
      setBanner({ kind: 'error', message: e?.message || String(e) })
    }
  }

  return (
    <div>
      <Nav />
      <main className="container py-6">
        <h2 className="text-xl font-semibold mb-3">Feeds</h2>
        {banner && <div className="mb-3"><Alert kind={banner.kind} message={banner.message} onClose={() => setBanner(null)} /></div>}
        <div className="card p-4 mb-4 grid grid-cols-1 md:grid-cols-3 gap-2">
          <h3 className="font-semibold md:col-span-3">Create Feed</h3>
          <input className="input md:col-span-2" placeholder="Feed URL" value={url} onChange={e => setUrl(e.target.value)} />
          <input className="input" placeholder="Poll frequency (e.g., 1h)" value={poll} onChange={e => setPoll(e.target.value)} />
          <input className="input" placeholder="Initial lookback (e.g., 7d)" value={lookback} onChange={e => setLookback(e.target.value)} />
          <input className="input" placeholder="Site Config ID (optional)" value={siteConfigId} onChange={e => setSiteConfigId(e.target.value)} />
          <label className="inline-flex items-center gap-2"><input type="checkbox" checked={paywalled} onChange={e => setPaywalled(e.target.checked)} /> Paywalled</label>
          <label className="inline-flex items-center gap-2"><input type="checkbox" checked={rssAuth} onChange={e => setRssAuth(e.target.checked)} /> RSS requires auth</label>
          <button className="btn" onClick={createFeed}>Create</button>
        </div>
        {isLoading && <p className="text-gray-600">Loading...</p>}
        {error && <Alert kind="error" message={String(error)} />}
        {data && (
          <div className="card p-0 overflow-hidden">
            <table className="table">
              <thead className="bg-gray-100">
                <tr>
                  <th className="th">URL</th>
                  <th className="th">Poll</th>
                  <th className="th">Lookback</th>
                  <th className="th">Paywalled</th>
                  <th className="th">RSS Auth</th>
                  <th className="th">Site Config</th>
                  <th className="th">Actions</th>
                </tr>
              </thead>
              <tbody>
                {(data.items || data).map((f: any) => (
                  <tr key={f.id} className="odd:bg-white even:bg-gray-50">
                    {editingId === f.id ? (
                      <>
                        <td className="td"><input className="input w-full" value={editRow.url} onChange={e => setEditRow({ ...editRow, url: e.target.value })} /></td>
                        <td className="td"><input className="input w-full" value={editRow.pollFrequency} onChange={e => setEditRow({ ...editRow, pollFrequency: e.target.value })} /></td>
                        <td className="td"><input className="input w-full" value={editRow.initialLookbackPeriod} onChange={e => setEditRow({ ...editRow, initialLookbackPeriod: e.target.value })} /></td>
                        <td className="td"><input type="checkbox" checked={editRow.isPaywalled} onChange={e => setEditRow({ ...editRow, isPaywalled: e.target.checked })} /></td>
                        <td className="td"><input type="checkbox" checked={editRow.rssRequiresAuth} onChange={e => setEditRow({ ...editRow, rssRequiresAuth: e.target.checked })} /></td>
                        <td className="td"><input className="input w-full" value={editRow.siteConfigId} onChange={e => setEditRow({ ...editRow, siteConfigId: e.target.value })} /></td>
                        <td className="td flex gap-2">
                          <button className="btn" onClick={() => saveEdit(f.id)}>Save</button>
                          <button className="btn" onClick={cancelEdit}>Cancel</button>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="td">{f.url}</td>
                        <td className="td">{f.poll_frequency || f.pollFrequency}</td>
                        <td className="td">{f.initial_lookback_period || f.initialLookbackPeriod || ''}</td>
                        <td className="td">{String(f.is_paywalled ?? f.isPaywalled)}</td>
                        <td className="td">{String(f.rss_requires_auth ?? f.rssRequiresAuth)}</td>
                        <td className="td">{f.site_config_id || f.siteConfigId || ''}</td>
                        <td className="td flex gap-2">
                          <button className="btn" onClick={() => startEdit(f)}>Edit</button>
                          <button className="btn" onClick={() => deleteFeed(f.id)}>Delete</button>
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  )
}
