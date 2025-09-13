import useSWR from 'swr'
import Nav from '../components/Nav'
import { sdk } from '../lib/sdk'
import { useState } from 'react'
import Alert from '../components/Alert'
import { parseJsonSafe, validateCredential } from '../lib/validate'

export default function Credentials() {
  const { data, error, isLoading, mutate } = useSWR(['/v1/credentials'], () => sdk.listCredentials())
  const [kind, setKind] = useState('site_login')
  const [scopeGlobal, setScopeGlobal] = useState(false)
  const [jsonData, setJsonData] = useState('{\n  "username": "",\n  "password": ""\n}')
  const [banner, setBanner] = useState<{ kind: 'success' | 'error'; message: string } | null>(null)

  async function testCred(c: any) {
    try {
      if (c.kind === 'instapaper') {
        const res = await sdk.testInstapaper(c.id)
        setBanner({ kind: res.ok ? 'success' : 'error', message: `Instapaper: ${JSON.stringify(res)}` })
      } else if (c.kind === 'miniflux') {
        const res = await sdk.testMiniflux(c.id)
        setBanner({ kind: res.ok ? 'success' : 'error', message: `Miniflux: ${JSON.stringify(res)}` })
      }
    } catch (e: any) {
      setBanner({ kind: 'error', message: e.message || String(e) })
    }
  }

  async function createCred() {
    const parsed = parseJsonSafe(jsonData)
    if (!parsed.ok) { setBanner({ kind: 'error', message: parsed.error }); return }
    const err = validateCredential(kind, parsed.data)
    if (err) { setBanner({ kind: 'error', message: err }); return }
    try {
      await sdk.createCredential(kind, parsed.data, scopeGlobal)
      setJsonData('')
      setBanner({ kind: 'success', message: 'Credential created' })
      mutate()
    } catch (e: any) {
      setBanner({ kind: 'error', message: e.message || String(e) })
    }
  }

  async function deleteCred(id: string) {
    if (!confirm('Delete credential?')) return
    try {
      await sdk.deleteCredential(id)
      setBanner({ kind: 'success', message: 'Credential deleted' })
      mutate()
    } catch (e: any) {
      setBanner({ kind: 'error', message: e.message || String(e) })
    }
  }

  return (
    <div>
      <Nav />
      <main className="container py-6">
        <h2 className="text-xl font-semibold mb-3">Credentials</h2>
        {isLoading && <p className="text-gray-600">Loading...</p>}
        {error && <p className="text-red-600">{String(error)}</p>}
        {banner && <div className="mb-3"><Alert kind={banner.kind} message={banner.message} onClose={() => setBanner(null)} /></div>}
        {data && (
          <>
          <div className="card p-4 mb-4 flex flex-col gap-2">
            <h3 className="font-semibold">Create Credential</h3>
            <div className="flex items-center gap-2 flex-wrap">
              <label>Kind:</label>
              <select className="input" value={kind} onChange={(e) => setKind(e.target.value)}>
                <option value="site_login">site_login</option>
                <option value="miniflux">miniflux</option>
                <option value="instapaper">instapaper</option>
                <option value="instapaper_app">instapaper_app (admin/global)</option>
              </select>
              <label className="inline-flex items-center gap-2"><input type="checkbox" checked={scopeGlobal} onChange={e => setScopeGlobal(e.target.checked)} /> Global (admin)</label>
            </div>
            <textarea className="input min-h-[120px]" value={jsonData} onChange={e => setJsonData(e.target.value)} placeholder="JSON data"></textarea>
            <div>
              <button className="btn" onClick={createCred}>Create</button>
            </div>
          </div>
          <div className="card p-0 overflow-hidden">
            <table className="table">
              <thead className="bg-gray-100">
                <tr>
                  <th className="th" scope="col">ID</th>
                  <th className="th" scope="col">Kind</th>
                  <th className="th" scope="col">Scope</th>
                  <th className="th" scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {(data.items ?? data).map((c: any) => (
                  <tr key={c.id} className="odd:bg-white even:bg-gray-50">
                    <td className="td">{c.id}</td>
                    <td className="td">{c.kind}</td>
                  <td className="td">{c.ownerUserId ? 'User' : 'Global'}</td>
                    <td className="td flex gap-2">
                      {(c.kind === 'instapaper' || c.kind === 'miniflux') && (
                        <button className="btn" onClick={() => testCred(c)}>Test</button>
                      )}
                      <button className="btn" onClick={() => deleteCred(c.id)}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
      </main>
    </div>
  )
}
