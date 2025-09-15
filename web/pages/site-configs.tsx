import useSWR from 'swr'
import Nav from '../components/Nav'
import { v1, siteConfigs as site } from '../lib/openapi'
import { useState } from 'react'
import Alert from '../components/Alert'
import { validateSiteConfig } from '../lib/validate'

export default function SiteConfigs() {
  const { data, error, isLoading, mutate } = useSWR(['/v1/site-configs'], () => v1.listSiteConfigsV1V1SiteConfigsGet({}))
  const [form, setForm] = useState({ name: '', site_url: '', username_selector: '', password_selector: '', login_button_selector: '', cookies_to_store: '' })
  const [createErrors, setCreateErrors] = useState<Record<string,string>>({})
  const [scopeGlobal, setScopeGlobal] = useState(false)
  const [banner, setBanner] = useState<{ kind: 'success' | 'error'; message: string } | null>(null)
  const [editing, setEditing] = useState<any | null>(null)
  const [editErrors, setEditErrors] = useState<Record<string,string>>({})

  async function create() {
    const body: any = {
      ...form,
      cookies_to_store: form.cookies_to_store.split(',').map(s => s.trim()).filter(Boolean)
    }
    try {
      const err = validateSiteConfig(body)
      if (err) { setBanner({ kind: 'error', message: err }); return }
      await site.createSiteConfigSiteConfigsPost({ siteConfig: { ...body, ownerUserId: scopeGlobal ? null : undefined } })
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
      await site.deleteSiteConfigSiteConfigsConfigIdDelete({ configId: id })
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
          <h3 className="font-semibold md:col-span-2">
            Create Site Config
            <span className="ml-2 text-gray-500 cursor-help" title="Provide CSS selectors for the login form and any cookies to persist.">?</span>
          </h3>
          <div>
            <input className="input" placeholder="Name" value={form.name} onChange={e => { const v=e.target.value; setForm({ ...form, name: v }); setCreateErrors(prev=>({ ...prev, name: v.trim()? '' : 'Name is required' })) }} />
            {createErrors.name && <div className="text-sm text-red-600">{createErrors.name}</div>}
          </div>
          <div>
            <input className="input" placeholder="Site URL" value={form.site_url} onChange={e => { const v=e.target.value; setForm({ ...form, site_url: v }); setCreateErrors(prev=>({ ...prev, site_url: v.startsWith('http')? '' : 'Valid URL required' })) }} />
            {createErrors.site_url && <div className="text-sm text-red-600">{createErrors.site_url}</div>}
          </div>
          <div>
            <input className="input" placeholder="Username selector" value={form.username_selector} onChange={e => { const v=e.target.value; setForm({ ...form, username_selector: v }); setCreateErrors(prev=>({ ...prev, username_selector: v.trim()? '' : 'Required' })) }} />
            {createErrors.username_selector && <div className="text-sm text-red-600">{createErrors.username_selector}</div>}
          </div>
          <div>
            <input className="input" placeholder="Password selector" value={form.password_selector} onChange={e => { const v=e.target.value; setForm({ ...form, password_selector: v }); setCreateErrors(prev=>({ ...prev, password_selector: v.trim()? '' : 'Required' })) }} />
            {createErrors.password_selector && <div className="text-sm text-red-600">{createErrors.password_selector}</div>}
          </div>
          <div>
            <input className="input" placeholder="Login button selector" value={form.login_button_selector} onChange={e => { const v=e.target.value; setForm({ ...form, login_button_selector: v }); setCreateErrors(prev=>({ ...prev, login_button_selector: v.trim()? '' : 'Required' })) }} />
            {createErrors.login_button_selector && <div className="text-sm text-red-600">{createErrors.login_button_selector}</div>}
          </div>
          <input className="input md:col-span-2" placeholder="Cookies to store (comma-separated)" value={form.cookies_to_store} onChange={e => setForm({ ...form, cookies_to_store: e.target.value })} />
          <label className="inline-flex items-center gap-2"><input type="checkbox" checked={scopeGlobal} onChange={e => setScopeGlobal(e.target.checked)} /> Global (admin)</label>
          <button
            className="btn"
            disabled={
              !(
                (form.name || '').trim() &&
                (form.site_url || '').startsWith('http') &&
                (form.username_selector || '').trim() &&
                (form.password_selector || '').trim() &&
                (form.login_button_selector || '').trim()
              )
            }
            title="Fill required fields"
            onClick={create}
          >
            Create
          </button>
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
                      <button className="btn" onClick={async () => { try { const r = await v1.testSiteConfigV1SiteConfigsConfigIdTestPost({ configId: sc.id }); setBanner({ kind: r.ok ? 'success' : 'error', message: `Test: ${JSON.stringify(r)}` }) } catch (e: any) { setBanner({ kind: 'error', message: e.message || String(e) }) } }}>Test Login</button>
                      <button className="btn" onClick={() => setEditing({ ...sc, cookies_to_store: (sc.cookies_to_store || []).join(',') })}>Edit</button>
                      <button className="btn" onClick={() => del(sc.id)}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )}
          {editing && (
            <div className="card p-4 mt-3 grid grid-cols-1 md:grid-cols-2 gap-2">
              <h3 className="font-semibold md:col-span-2">Edit Site Config</h3>
              <div>
                <input className="input" placeholder="Name" value={editing.name} onChange={e => { const v=e.target.value; setEditing({ ...editing, name: v }); setEditErrors(prev=>({ ...prev, name: v.trim()? '' : 'Name is required' })) }} />
                {editErrors.name && <div className="text-sm text-red-600">{editErrors.name}</div>}
              </div>
              <div>
                <input className="input" placeholder="Site URL" value={editing.site_url} onChange={e => { const v=e.target.value; setEditing({ ...editing, site_url: v }); setEditErrors(prev=>({ ...prev, site_url: v.startsWith('http')? '' : 'Valid URL required' })) }} />
                {editErrors.site_url && <div className="text-sm text-red-600">{editErrors.site_url}</div>}
              </div>
              <div>
                <input className="input" placeholder="Username selector" value={editing.username_selector} onChange={e => { const v=e.target.value; setEditing({ ...editing, username_selector: v }); setEditErrors(prev=>({ ...prev, username_selector: v.trim()? '' : 'Required' })) }} />
                {editErrors.username_selector && <div className="text-sm text-red-600">{editErrors.username_selector}</div>}
              </div>
              <div>
                <input className="input" placeholder="Password selector" value={editing.password_selector} onChange={e => { const v=e.target.value; setEditing({ ...editing, password_selector: v }); setEditErrors(prev=>({ ...prev, password_selector: v.trim()? '' : 'Required' })) }} />
                {editErrors.password_selector && <div className="text-sm text-red-600">{editErrors.password_selector}</div>}
              </div>
              <div>
                <input className="input" placeholder="Login button selector" value={editing.login_button_selector} onChange={e => { const v=e.target.value; setEditing({ ...editing, login_button_selector: v }); setEditErrors(prev=>({ ...prev, login_button_selector: v.trim()? '' : 'Required' })) }} />
                {editErrors.login_button_selector && <div className="text-sm text-red-600">{editErrors.login_button_selector}</div>}
              </div>
              <input className="input md:col-span-2" placeholder="Cookies to store (comma-separated)" value={editing.cookies_to_store} onChange={e => setEditing({ ...editing, cookies_to_store: e.target.value })} />
              <div className="md:col-span-2 flex gap-2">
                <button
                  className="btn"
                  disabled={
                    !(
                      (editing.name || '').trim() &&
                      (editing.site_url || '').startsWith('http') &&
                      (editing.username_selector || '').trim() &&
                      (editing.password_selector || '').trim() &&
                      (editing.login_button_selector || '').trim()
                    )
                  }
                  title="Fill required fields"
                  onClick={async () => {
                  const body: any = { ...editing, cookies_to_store: String(editing.cookies_to_store || '').split(',').map((s: string) => s.trim()).filter(Boolean) }
                  const err = validateSiteConfig(body)
                  if (err) { setBanner({ kind: 'error', message: err }); return }
                  try {
                    await site.updateSiteConfigSiteConfigsConfigIdPut({ configId: editing.id, siteConfig: body })
                    setBanner({ kind: 'success', message: 'Site config updated' })
                    setEditing(null)
                    mutate()
                  } catch (e: any) {
                    setBanner({ kind: 'error', message: e?.message || String(e) })
                  }
                }}>Save</button>
                <button className="btn" onClick={() => setEditing(null)}>Cancel</button>
              </div>
            </div>
          )}
      </main>
    </div>
  )
}
