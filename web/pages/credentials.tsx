import useSWR from 'swr'
import Nav from '../components/Nav'
import { v1, creds } from '../lib/openapi'
import { useState } from 'react'
import Alert from '../components/Alert'
import EmptyState from '../components/EmptyState'
import { parseJsonSafe, validateCredential, isValidUrl } from '../lib/validate'
import { useI18n } from '../lib/i18n'

export default function Credentials() {
  const { t } = useI18n()
  const { data, error, isLoading, mutate } = useSWR(['/v1/credentials'], () => v1.listCredentialsV1V1CredentialsGet({}))
  const [kind, setKind] = useState('site_login')
  const [scopeGlobal, setScopeGlobal] = useState(false)
  const [jsonData, setJsonData] = useState('{\n  "username": "",\n  "password": ""\n}')
  const [banner, setBanner] = useState<{ kind: 'success' | 'error'; message: string } | null>(null)
  const [editing, setEditing] = useState<{ id: string; kind: string; json: string } | null>(null)
  const [createErrors, setCreateErrors] = useState<Record<string, string>>({})
  const [editErrors, setEditErrors] = useState<Record<string, string>>({})
  const createObj = (() => { try { return JSON.parse(jsonData || '{}') } catch { return {} } })() as any
  const editingObj = editing ? (() => { try { return JSON.parse(editing.json || '{}') } catch { return {} } })() as any : null

  async function testCred(c: any) {
    try {
      if (c.kind === 'instapaper') {
        const res = await v1.testInstapaperV1IntegrationsInstapaperTestPost({ requestBody: { credential_id: c.id } })
        setBanner({ kind: res.ok ? 'success' : 'error', message: `Instapaper: ${JSON.stringify(res)}` })
      } else if (c.kind === 'miniflux') {
        const res = await v1.testMinifluxV1IntegrationsMinifluxTestPost({ requestBody: { credential_id: c.id } })
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
      await creds.createCredentialCredentialsPost({ credential: { kind, data: parsed.data, ownerUserId: scopeGlobal ? null : undefined } })
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
      await creds.deleteCredentialCredentialsCredIdDelete({ credId: id })
      setBanner({ kind: 'success', message: 'Credential deleted' })
      mutate()
    } catch (e: any) {
      setBanner({ kind: 'error', message: e.message || String(e) })
    }
  }

  async function startEdit(id: string, kind: string) {
    try {
      const full = await creds.getCredentialCredentialsCredIdGet({ credId: id })
      const body = full?.data ?? {}
      setEditing({ id, kind, json: JSON.stringify(body, null, 2) })
    } catch (e: any) {
      setBanner({ kind: 'error', message: e?.message || String(e) })
    }
  }

  async function saveEdit() {
    if (!editing) return
    const parsed = parseJsonSafe(editing.json)
    if (!parsed.ok) { setBanner({ kind: 'error', message: parsed.error }); return }
    // Prune masked/empty values so backend preserves existing secrets
    const data: any = {}
    for (const [k, v] of Object.entries(parsed.data || {})) {
      if (typeof v === 'string') {
        const trimmed = v.trim()
        if (!trimmed) continue
        if (/[\*•]/.test(trimmed)) continue
      }
      (data as any)[k] = v as any
    }
    try {
      await creds.updateCredentialCredentialsCredIdPut({ credId: editing.id, credential: { kind: editing.kind, data } })
      setEditing(null)
      setBanner({ kind: 'success', message: 'Credential updated' })
      mutate()
    } catch (e: any) {
      setBanner({ kind: 'error', message: e?.message || String(e) })
    }
  }

  return (
    <div>
      <Nav />
      <main className="container py-6">
        <h2 className="text-xl font-semibold mb-3">{t('credentials_title')}</h2>
        {isLoading && <p className="text-gray-600">Loading...</p>}
        {error && <p className="text-red-600">{String(error)}</p>}
        {banner && <div className="mb-3"><Alert kind={banner.kind} message={banner.message} onClose={() => setBanner(null)} /></div>}
        {data && (
          <>
          <div id="create-credential" className="card p-4 mb-4 flex flex-col gap-2">
            <h3 className="font-semibold">Create Credential</h3>
            <div className="flex items-center gap-2 flex-wrap">
              <label>Kind <span className="ml-1 text-gray-500 cursor-help" title="Choose credential type. Fields vary by type.">?</span>:</label>
              <select className="input" value={kind} onChange={(e) => setKind(e.target.value)}>
                <option value="site_login">site_login</option>
                <option value="miniflux">miniflux</option>
                <option value="instapaper">instapaper</option>
                <option value="instapaper_app">instapaper_app (admin/global)</option>
              </select>
              <label className="inline-flex items-center gap-2"><input type="checkbox" checked={scopeGlobal} onChange={e => setScopeGlobal(e.target.checked)} /> Global (admin)</label>
            </div>
            {kind === 'site_login' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <div>
                  <input className="input" placeholder="Username" value={createObj.username || ''} onChange={e => { const v=e.target.value; setJsonData(JSON.stringify({ username: v, password: createObj.password || '' })); setCreateErrors(prev=>({ ...prev, username: v.trim()? '' : 'Username is required' })) }} />
                  {createErrors.username && <div className="text-sm text-red-600">{createErrors.username}</div>}
                </div>
                <div>
                  <input className="input" placeholder="Password" type="password" value={createObj.password || ''} onChange={e => { const v=e.target.value; setJsonData(JSON.stringify({ username: createObj.username || '', password: v })); setCreateErrors(prev=>({ ...prev, password: v.trim()? '' : 'Password is required' })) }} />
                  {createErrors.password && <div className="text-sm text-red-600">{createErrors.password}</div>}
                </div>
              </div>
            )}
            {kind === 'miniflux' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <div>
                  <input className="input" placeholder="Miniflux URL" value={createObj.miniflux_url || ''} onChange={e => { const v=e.target.value; setJsonData(JSON.stringify({ miniflux_url: v, api_key: createObj.api_key || '' })); setCreateErrors(prev=>({ ...prev, miniflux_url: isValidUrl(v)? '' : 'Valid URL required' })) }} />
                  {createErrors.miniflux_url && <div className="text-sm text-red-600">{createErrors.miniflux_url}</div>}
                </div>
                <div>
                  <input className="input" placeholder="API Key" value={createObj.api_key || ''} onChange={e => { const v=e.target.value; setJsonData(JSON.stringify({ miniflux_url: createObj.miniflux_url || '', api_key: v })); setCreateErrors(prev=>({ ...prev, api_key: v.trim()? '' : 'API key is required' })) }} />
                  {createErrors.api_key && <div className="text-sm text-red-600">{createErrors.api_key}</div>}
                </div>
              </div>
            )}
            {kind === 'instapaper' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <div>
                  <input className="input" placeholder="OAuth Token" value={createObj.oauth_token || ''} onChange={e => { const v=e.target.value; setJsonData(JSON.stringify({ oauth_token: v, oauth_token_secret: createObj.oauth_token_secret || '' })); setCreateErrors(prev=>({ ...prev, oauth_token: v.trim()? '' : 'Required' })) }} />
                  {createErrors.oauth_token && <div className="text-sm text-red-600">{createErrors.oauth_token}</div>}
                </div>
                <div>
                  <input className="input" placeholder="OAuth Token Secret" value={createObj.oauth_token_secret || ''} onChange={e => { const v=e.target.value; setJsonData(JSON.stringify({ oauth_token: createObj.oauth_token || '', oauth_token_secret: v })); setCreateErrors(prev=>({ ...prev, oauth_token_secret: v.trim()? '' : 'Required' })) }} />
                  {createErrors.oauth_token_secret && <div className="text-sm text-red-600">{createErrors.oauth_token_secret}</div>}
                </div>
              </div>
            )}
            {kind === 'instapaper_app' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <div>
                  <input className="input" placeholder="Consumer Key" value={createObj.consumer_key || ''} onChange={e => { const v=e.target.value; setJsonData(JSON.stringify({ consumer_key: v, consumer_secret: createObj.consumer_secret || '' })); setCreateErrors(prev=>({ ...prev, consumer_key: v.trim()? '' : 'Required' })) }} />
                  {createErrors.consumer_key && <div className="text-sm text-red-600">{createErrors.consumer_key}</div>}
                </div>
                <div>
                  <input className="input" placeholder="Consumer Secret" value={createObj.consumer_secret || ''} onChange={e => { const v=e.target.value; setJsonData(JSON.stringify({ consumer_key: createObj.consumer_key || '', consumer_secret: v })); setCreateErrors(prev=>({ ...prev, consumer_secret: v.trim()? '' : 'Required' })) }} />
                  {createErrors.consumer_secret && <div className="text-sm text-red-600">{createErrors.consumer_secret}</div>}
                </div>
              </div>
            )}
            <div>
              <button
                className="btn"
                disabled={
                  !(
                    (kind === 'site_login' && !!(createObj.username?.trim() && createObj.password?.trim())) ||
                    (kind === 'miniflux' && !!(createObj.miniflux_url && isValidUrl(createObj.miniflux_url) && createObj.api_key?.trim())) ||
                    (kind === 'instapaper' && !!(createObj.oauth_token?.trim() && createObj.oauth_token_secret?.trim())) ||
                    (kind === 'instapaper_app' && !!(createObj.consumer_key?.trim() && createObj.consumer_secret?.trim()))
                  )
                }
                title="Fill required fields"
                onClick={createCred}
              >
                Create
              </button>
            </div>
          </div>
          <div className="card p-0 overflow-hidden">
            {(!data.items && !Array.isArray(data)) || (Array.isArray(data) ? data.length === 0 : (data.items?.length ?? 0) === 0) ? (
              <div className="p-4">
                <EmptyState
                  title={t('empty_credentials_title')}
                  description={t('empty_credentials_desc')}
                />
              </div>
            ) : (
            <table className="table" aria-label="Credentials">
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
                      <button className="btn" onClick={() => startEdit(c.id, c.kind)}>Edit</button>
                      <button className="btn" onClick={() => deleteCred(c.id)}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            )}
          </div>
          {editing && (
            <div className="card p-4 mt-3">
              <h3 className="font-semibold mb-2">Edit Credential {editing.id}</h3>
              <div className="mb-2 text-sm text-gray-700">Kind: {editing.kind}</div>
              {editing.kind === 'site_login' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <div>
                    <input className="input" placeholder={editingObj?.username || 'Username'} value={editingObj?.username ? (editingObj.username.includes('*') ? '' : editingObj.username) : ''} onChange={e => { const v=e.target.value; setEditing({ ...editing, json: JSON.stringify({ ...(editingObj||{}), username: v }) }); setEditErrors(prev=>({ ...prev, username: v.trim()? '' : 'Username is required' })) }} />
                    {editErrors.username && <div className="text-sm text-red-600">{editErrors.username}</div>}
                  </div>
                  <div>
                    <input className="input" placeholder={(editingObj?.password && editingObj.password.includes('*')) ? '••••' : 'Password (leave blank to keep)'} type="password" value={(editingObj?.password && editingObj.password.includes('*')) ? '' : (editingObj?.password || '')} onChange={e => { const v=e.target.value; setEditing({ ...editing, json: JSON.stringify({ ...(editingObj||{}), password: v }) }) }} />
                  </div>
                  </div>
              )}
              {editing.kind === 'miniflux' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <div>
                    <input className="input" placeholder={editingObj?.miniflux_url || 'Miniflux URL'} value={editingObj?.miniflux_url || ''} onChange={e => { const v=e.target.value; setEditing({ ...editing, json: JSON.stringify({ ...(editingObj||{}), miniflux_url: v }) }); setEditErrors(prev=>({ ...prev, miniflux_url: isValidUrl(v)? '' : 'Valid URL required' })) }} />
                    {editErrors.miniflux_url && <div className="text-sm text-red-600">{editErrors.miniflux_url}</div>}
                  </div>
                  <div>
                    <input className="input" placeholder={(editingObj?.api_key && editingObj.api_key.includes('*')) ? '••••' : 'API Key (leave blank to keep)'} value={(editingObj?.api_key && editingObj.api_key.includes('*')) ? '' : (editingObj?.api_key || '')} onChange={e => { const v=e.target.value; setEditing({ ...editing, json: JSON.stringify({ ...(editingObj||{}), api_key: v }) }) }} />
                  </div>
                </div>
              )}
              {editing.kind === 'instapaper' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <div>
                    <input className="input" placeholder={(editingObj?.oauth_token && editingObj.oauth_token.includes('*')) ? '••••' : 'OAuth Token (leave blank to keep)'} value={(editingObj?.oauth_token && editingObj.oauth_token.includes('*')) ? '' : (editingObj?.oauth_token || '')} onChange={e => { const v=e.target.value; setEditing({ ...editing, json: JSON.stringify({ ...(editingObj||{}), oauth_token: v }) }) }} />
                  </div>
                  <div>
                    <input className="input" placeholder={(editingObj?.oauth_token_secret && editingObj.oauth_token_secret.includes('*')) ? '••••' : 'OAuth Token Secret (leave blank to keep)'} value={(editingObj?.oauth_token_secret && editingObj.oauth_token_secret.includes('*')) ? '' : (editingObj?.oauth_token_secret || '')} onChange={e => { const v=e.target.value; setEditing({ ...editing, json: JSON.stringify({ ...(editingObj||{}), oauth_token_secret: v }) }) }} />
                  </div>
                </div>
              )}
              {editing.kind === 'instapaper_app' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <div>
                    <input className="input" placeholder={editingObj?.consumer_key || 'Consumer Key'} value={editingObj?.consumer_key || ''} onChange={e => { const v=e.target.value; setEditing({ ...editing, json: JSON.stringify({ ...(editingObj||{}), consumer_key: v }) }) }} />
                  </div>
                  <div>
                    <input className="input" placeholder={(editingObj?.consumer_secret && editingObj.consumer_secret.includes('*')) ? '••••' : 'Consumer Secret (leave blank to keep)'} value={(editingObj?.consumer_secret && editingObj.consumer_secret.includes('*')) ? '' : (editingObj?.consumer_secret || '')} onChange={e => { const v=e.target.value; setEditing({ ...editing, json: JSON.stringify({ ...(editingObj||{}), consumer_secret: v }) }) }} />
                  </div>
                </div>
              )}
              <div className="mt-2 flex gap-2">
                <button
                  className="btn"
                  disabled={
                    !editing ||
                    !(
                      (editing.kind === 'site_login' && !!(editingObj?.username?.trim())) ||
                      (editing.kind === 'miniflux' && !!(editingObj?.miniflux_url && isValidUrl(editingObj.miniflux_url))) ||
                      (editing.kind === 'instapaper') ||
                      (editing.kind === 'instapaper_app' && !!(editingObj?.consumer_key?.trim()))
                    )
                  }
                  title="Fill required fields"
                  onClick={saveEdit}
                >
                  Save
                </button>
                <button className="btn" onClick={() => setEditing(null)}>Cancel</button>
              </div>
            </div>
          )}
          </>
        )}
      </main>
    </div>
  )
}
