import useSWR from 'swr'
import Nav from '../components/Nav'
import { sdk } from '../lib/sdk'
import { useState } from 'react'
import Alert from '../components/Alert'
import { validateSiteConfig } from '../lib/validate'

export default function SiteConfigs() {
  const { data, error, isLoading, mutate } = useSWR(['/v1/site-configs'], () => sdk.listSiteConfigs())
  const [form, setForm] = useState({ name: '', site_url: '', username_selector: '', password_selector: '', login_button_selector: '', cookies_to_store: '' })
  const [scopeGlobal, setScopeGlobal] = useState(false)
  const [banner, setBanner] = useState<{ kind: 'success' | 'error'; message: string } | null>(null)

  async function create() {
    const body: any = {
      ...form,
      cookies_to_store: form.cookies_to_store.split(',').map(s => s.trim()).filter(Boolean)
    }
    try {
      const err = validateSiteConfig(body)
      if (err) { setBanner({ kind: 'error', message: err }); return }
      await sdk.createSiteConfig(body, scopeGlobal)
      setForm({ name: '', site_url: '', username_selector: '', password_selector: '', login_button_selector: '', cookies_to_store: '' })
      setScopeGlobal(false)
      setBanner({ kind: 'success', message: 'Site config created' })
      mutate()
    } catch (e: any) {
      setBanner({ kind: 'error', message: e.message || String(e) })
    }
  }

  async function del(id: string) {
    if (!confirm('Delete site config?')) return
    try {
      await sdk.deleteSiteConfig(id)
      setBanner({ kind: 'success', message: 'Site config deleted' })
      mutate()
    } catch (e: any) {
      setBanner({ kind: 'error', message: e.message || String(e) })
    }
  }
  return (
    <div>
      <Nav />
      <main className="container py-6">
        <h2 className="text-xl font-semibold mb-3">Site Configs</h2>
        {banner && <div className="mb-3"><Alert kind={banner.kind} message={banner.message} onClose={() => setBanner(null)} /></div>}
        {isLoading && <p className="text-gray-600">Loading...</p>}
        {error && <Alert kind="error" message={String(error)} />}
        <div className="card p-4 mb-4 grid grid-cols-1 md:grid-cols-2 gap-2">
          <h3 className="font-semibold md:col-span-2">Create Site Config</h3>
          <input className="input" placeholder="Name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
          <input className="input" placeholder="Site URL" value={form.site_url} onChange={e => setForm({ ...form, site_url: e.target.value })} />
          <input className="input" placeholder="Username selector" value={form.username_selector} onChange={e => setForm({ ...form, username_selector: e.target.value })} />
          <input className="input" placeholder="Password selector" value={form.password_selector} onChange={e => setForm({ ...form, password_selector: e.target.value })} />
          <input className="input" placeholder="Login button selector" value={form.login_button_selector} onChange={e => setForm({ ...form, login_button_selector: e.target.value })} />
          <input className="input md:col-span-2" placeholder="Cookies to store (comma-separated)" value={form.cookies_to_store} onChange={e => setForm({ ...form, cookies_to_store: e.target.value })} />
          <label className="inline-flex items-center gap-2"><input type="checkbox" checked={scopeGlobal} onChange={e => setScopeGlobal(e.target.checked)} /> Global (admin)</label>
          <button className="btn" onClick={create}>Create</button>
        </div>
        {data && (
          <div className="card p-0 overflow-hidden">
            <table className="table">
              <thead className="bg-gray-100">
                <tr>
                  <th className="th" scope="col">Name</th>
                  <th className="th" scope="col">URL</th>
                  <th className="th" scope="col">Scope</th>
                  <th className="th" scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {(data.items || data).map((sc: any) => (
                  <tr key={sc.id} className="odd:bg-white even:bg-gray-50">
                    <td className="td">{sc.name}</td>
                    <td className="td">{sc.site_url}</td>
                    <td className="td">{sc.owner_user_id ? 'User' : 'Global'}</td>
                    <td className="td flex gap-2">
                      <button className="btn" onClick={async () => { try { const r = await sdk.testSiteConfig(sc.id); setBanner({ kind: r.ok ? 'success' : 'error', message: `Test: ${JSON.stringify(r)}` }) } catch (e: any) { setBanner({ kind: 'error', message: e.message || String(e) }) } }}>Test Login</button>
                      <button className="btn" onClick={() => del(sc.id)}>Delete</button>
                    </td>
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
