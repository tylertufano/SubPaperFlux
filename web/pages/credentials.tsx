import useSWR from 'swr'
import { Alert, Breadcrumbs, EmptyState, Nav } from '../components'
import { v1, creds } from '../lib/openapi'
import { useMemo, useState } from 'react'
import { parseJsonSafe, validateCredential, isValidUrl } from '../lib/validate'
import { useI18n } from '../lib/i18n'
import { buildBreadcrumbs } from '../lib/breadcrumbs'
import { useRouter } from 'next/router'

export default function Credentials() {
  const { t } = useI18n()
  const router = useRouter()
  const breadcrumbs = useMemo(() => buildBreadcrumbs(router.pathname, t), [router.pathname, t])
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
        setBanner({ kind: res.ok ? 'success' : 'error', message: t('credentials_test_result', { service: 'Instapaper', result: JSON.stringify(res) }) })
      } else if (c.kind === 'miniflux') {
        const res = await v1.testMinifluxV1IntegrationsMinifluxTestPost({ requestBody: { credential_id: c.id } })
        setBanner({ kind: res.ok ? 'success' : 'error', message: t('credentials_test_result', { service: 'Miniflux', result: JSON.stringify(res) }) })
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
      setBanner({ kind: 'success', message: t('credentials_create_success') })
      mutate()
    } catch (e: any) {
      setBanner({ kind: 'error', message: e.message || String(e) })
    }
  }

  async function deleteCred(id: string) {
    if (!confirm(t('credentials_confirm_delete'))) return
    try {
      await creds.deleteCredentialCredentialsCredIdDelete({ credId: id })
      setBanner({ kind: 'success', message: t('credentials_delete_success') })
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
      setBanner({ kind: 'error', message: t('credentials_load_failed', { reason: e?.message || String(e) }) })
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
      setBanner({ kind: 'success', message: t('credentials_update_success') })
      mutate()
    } catch (e: any) {
      setBanner({ kind: 'error', message: e?.message || String(e) })
    }
  }

  return (
    <div>
      <Nav />
      <Breadcrumbs items={breadcrumbs} />
      <main className="container py-6">
        <h2 id="credentials-heading" className="text-xl font-semibold mb-3">{t('credentials_title')}</h2>
        {isLoading && <p className="text-gray-600">{t('loading_text')}</p>}
        {error && <p className="text-red-600">{String(error)}</p>}
        {banner && <div className="mb-3"><Alert kind={banner.kind} message={banner.message} onClose={() => setBanner(null)} /></div>}
        {data && (
          <>
          <form
            id="create-credential"
            className="card p-4 mb-4 flex flex-col gap-2"
            role="form"
            aria-labelledby="create-credential-heading"
            onSubmit={(e) => { e.preventDefault(); createCred() }}
          >
            <h3 id="create-credential-heading" className="font-semibold">{t('credentials_create_heading')}</h3>
            <div className="flex items-center gap-2 flex-wrap">
              <label htmlFor="credential-kind-select">{t('credentials_kind_label')} <span className="ml-1 text-gray-500 cursor-help" title={t('credentials_kind_help')}>?</span>:</label>
              <select id="credential-kind-select" className="input" value={kind} onChange={(e) => setKind(e.target.value)}>
                <option value="site_login">{t('credentials_kind_site_login')}</option>
                <option value="miniflux">{t('credentials_kind_miniflux')}</option>
                <option value="instapaper">{t('credentials_kind_instapaper')}</option>
                <option value="instapaper_app">{t('credentials_kind_instapaper_app')}</option>
              </select>
              <label className="inline-flex items-center gap-2"><input type="checkbox" checked={scopeGlobal} onChange={e => setScopeGlobal(e.target.checked)} /> {t('credentials_scope_global_label')}</label>
            </div>
            {kind === 'site_login' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <div>
                  <input
                    id="create-credential-username"
                    className="input"
                    placeholder={t('credentials_field_username_placeholder')}
                    aria-label={t('credentials_field_username_placeholder')}
                    aria-invalid={Boolean(createErrors.username)}
                    aria-describedby={createErrors.username ? 'create-credential-username-error' : undefined}
                    value={createObj.username || ''}
                    onChange={e => { const v=e.target.value; setJsonData(JSON.stringify({ username: v, password: createObj.password || '' })); setCreateErrors(prev=>({ ...prev, username: v.trim()? '' : t('credentials_error_username_required') })) }}
                  />
                  {createErrors.username && <div id="create-credential-username-error" className="text-sm text-red-600">{createErrors.username}</div>}
                </div>
                <div>
                  <input
                    id="create-credential-password"
                    className="input"
                    placeholder={t('credentials_field_password_placeholder')}
                    type="password"
                    aria-label={t('credentials_field_password_placeholder')}
                    aria-invalid={Boolean(createErrors.password)}
                    aria-describedby={createErrors.password ? 'create-credential-password-error' : undefined}
                    value={createObj.password || ''}
                    onChange={e => { const v=e.target.value; setJsonData(JSON.stringify({ username: createObj.username || '', password: v })); setCreateErrors(prev=>({ ...prev, password: v.trim()? '' : t('credentials_error_password_required') })) }}
                  />
                  {createErrors.password && <div id="create-credential-password-error" className="text-sm text-red-600">{createErrors.password}</div>}
                </div>
              </div>
            )}
            {kind === 'miniflux' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <div>
                  <input
                    id="create-credential-miniflux-url"
                    className="input"
                    placeholder={t('credentials_field_miniflux_url_placeholder')}
                    aria-label={t('credentials_field_miniflux_url_placeholder')}
                    aria-invalid={Boolean(createErrors.miniflux_url)}
                    aria-describedby={createErrors.miniflux_url ? 'create-credential-miniflux-url-error' : undefined}
                    value={createObj.miniflux_url || ''}
                    onChange={e => { const v=e.target.value; setJsonData(JSON.stringify({ miniflux_url: v, api_key: createObj.api_key || '' })); setCreateErrors(prev=>({ ...prev, miniflux_url: isValidUrl(v)? '' : t('credentials_error_miniflux_url_invalid') })) }}
                  />
                  {createErrors.miniflux_url && <div id="create-credential-miniflux-url-error" className="text-sm text-red-600">{createErrors.miniflux_url}</div>}
                </div>
                <div>
                  <input
                    id="create-credential-api-key"
                    className="input"
                    placeholder={t('credentials_field_api_key_placeholder')}
                    aria-label={t('credentials_field_api_key_placeholder')}
                    aria-invalid={Boolean(createErrors.api_key)}
                    aria-describedby={createErrors.api_key ? 'create-credential-api-key-error' : undefined}
                    value={createObj.api_key || ''}
                    onChange={e => { const v=e.target.value; setJsonData(JSON.stringify({ miniflux_url: createObj.miniflux_url || '', api_key: v })); setCreateErrors(prev=>({ ...prev, api_key: v.trim()? '' : t('credentials_error_api_key_required') })) }}
                  />
                  {createErrors.api_key && <div id="create-credential-api-key-error" className="text-sm text-red-600">{createErrors.api_key}</div>}
                </div>
              </div>
            )}
            {kind === 'instapaper' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <div>
                  <input
                    id="create-credential-oauth-token"
                    className="input"
                    placeholder={t('credentials_field_oauth_token_placeholder')}
                    aria-label={t('credentials_field_oauth_token_placeholder')}
                    aria-invalid={Boolean(createErrors.oauth_token)}
                    aria-describedby={createErrors.oauth_token ? 'create-credential-oauth-token-error' : undefined}
                    value={createObj.oauth_token || ''}
                    onChange={e => { const v=e.target.value; setJsonData(JSON.stringify({ oauth_token: v, oauth_token_secret: createObj.oauth_token_secret || '' })); setCreateErrors(prev=>({ ...prev, oauth_token: v.trim()? '' : t('credentials_error_required') })) }}
                  />
                  {createErrors.oauth_token && <div id="create-credential-oauth-token-error" className="text-sm text-red-600">{createErrors.oauth_token}</div>}
                </div>
                <div>
                  <input
                    id="create-credential-oauth-secret"
                    className="input"
                    placeholder={t('credentials_field_oauth_secret_placeholder')}
                    aria-label={t('credentials_field_oauth_secret_placeholder')}
                    aria-invalid={Boolean(createErrors.oauth_token_secret)}
                    aria-describedby={createErrors.oauth_token_secret ? 'create-credential-oauth-secret-error' : undefined}
                    value={createObj.oauth_token_secret || ''}
                    onChange={e => { const v=e.target.value; setJsonData(JSON.stringify({ oauth_token: createObj.oauth_token || '', oauth_token_secret: v })); setCreateErrors(prev=>({ ...prev, oauth_token_secret: v.trim()? '' : t('credentials_error_required') })) }}
                  />
                  {createErrors.oauth_token_secret && <div id="create-credential-oauth-secret-error" className="text-sm text-red-600">{createErrors.oauth_token_secret}</div>}
                </div>
              </div>
            )}
            {kind === 'instapaper_app' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <div>
                  <input
                    id="create-credential-consumer-key"
                    className="input"
                    placeholder={t('credentials_field_consumer_key_placeholder')}
                    aria-label={t('credentials_field_consumer_key_placeholder')}
                    aria-invalid={Boolean(createErrors.consumer_key)}
                    aria-describedby={createErrors.consumer_key ? 'create-credential-consumer-key-error' : undefined}
                    value={createObj.consumer_key || ''}
                    onChange={e => { const v=e.target.value; setJsonData(JSON.stringify({ consumer_key: v, consumer_secret: createObj.consumer_secret || '' })); setCreateErrors(prev=>({ ...prev, consumer_key: v.trim()? '' : t('credentials_error_required') })) }}
                  />
                  {createErrors.consumer_key && <div id="create-credential-consumer-key-error" className="text-sm text-red-600">{createErrors.consumer_key}</div>}
                </div>
                <div>
                  <input
                    id="create-credential-consumer-secret"
                    className="input"
                    placeholder={t('credentials_field_consumer_secret_placeholder')}
                    aria-label={t('credentials_field_consumer_secret_placeholder')}
                    aria-invalid={Boolean(createErrors.consumer_secret)}
                    aria-describedby={createErrors.consumer_secret ? 'create-credential-consumer-secret-error' : undefined}
                    value={createObj.consumer_secret || ''}
                    onChange={e => { const v=e.target.value; setJsonData(JSON.stringify({ consumer_key: createObj.consumer_key || '', consumer_secret: v })); setCreateErrors(prev=>({ ...prev, consumer_secret: v.trim()? '' : t('credentials_error_required') })) }}
                  />
                  {createErrors.consumer_secret && <div id="create-credential-consumer-secret-error" className="text-sm text-red-600">{createErrors.consumer_secret}</div>}
                </div>
              </div>
            )}
            <div>
              <button
                type="submit"
                className="btn"
                disabled={
                  !(
                    (kind === 'site_login' && !!(createObj.username?.trim() && createObj.password?.trim())) ||
                    (kind === 'miniflux' && !!(createObj.miniflux_url && isValidUrl(createObj.miniflux_url) && createObj.api_key?.trim())) ||
                    (kind === 'instapaper' && !!(createObj.oauth_token?.trim() && createObj.oauth_token_secret?.trim())) ||
                    (kind === 'instapaper_app' && !!(createObj.consumer_key?.trim() && createObj.consumer_secret?.trim()))
                  )
                }
                title={t('form_fill_required')}
              >
                {t('btn_create')}
              </button>
            </div>
          </form>
          <div className="card p-0 overflow-hidden">
            {(!data.items && !Array.isArray(data)) || (Array.isArray(data) ? data.length === 0 : (data.items?.length ?? 0) === 0) ? (
              <div className="p-4">
                <EmptyState
                  icon={<span>🔐</span>}
                  message={(
                    <div className="space-y-1">
                      <p className="text-lg font-semibold text-gray-700">{t('empty_credentials_title')}</p>
                      <p>{t('empty_credentials_desc')}</p>
                    </div>
                  )}
                />
              </div>
            ) : (
            <table className="table" role="table" aria-label={t('credentials_table_label')}>
              <thead className="bg-gray-100">
                <tr>
                  <th className="th" scope="col">{t('id_label')}</th>
                  <th className="th" scope="col">{t('kind_label')}</th>
                  <th className="th" scope="col">{t('scope_label')}</th>
                  <th className="th" scope="col">{t('actions_label')}</th>
                </tr>
              </thead>
              <tbody>
                {(data.items ?? data).map((c: any) => (
                  <tr key={c.id} className="odd:bg-white even:bg-gray-50">
                    <td className="td">{c.id}</td>
                    <td className="td">{c.kind}</td>
                  <td className="td">{c.ownerUserId ? t('scope_user') : t('scope_global')}</td>
                    <td className="td flex gap-2">
                      {(c.kind === 'instapaper' || c.kind === 'miniflux') && (
                        <button type="button" className="btn" onClick={() => testCred(c)}>{t('btn_test')}</button>
                      )}
                      <button type="button" className="btn" onClick={() => startEdit(c.id, c.kind)}>{t('btn_edit')}</button>
                      <button type="button" className="btn" onClick={() => deleteCred(c.id)}>{t('btn_delete')}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            )}
          </div>
          {editing && (
            <div className="card p-4 mt-3" role="form" aria-labelledby="edit-credential-heading">
              <h3 id="edit-credential-heading" className="font-semibold mb-2">{t('credentials_edit_heading', { id: editing.id })}</h3>
              <div className="mb-2 text-sm text-gray-700">{t('credentials_kind_display', { kind: editing.kind })}</div>
              {editing.kind === 'site_login' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <div>
                    <input
                      id="edit-credential-username"
                      className="input"
                      placeholder={editingObj?.username || t('credentials_field_username_placeholder')}
                      aria-label={t('credentials_field_username_placeholder')}
                      aria-invalid={Boolean(editErrors.username)}
                      aria-describedby={editErrors.username ? 'edit-credential-username-error' : undefined}
                      value={editingObj?.username ? (editingObj.username.includes('*') ? '' : editingObj.username) : ''}
                      onChange={e => { const v=e.target.value; setEditing({ ...editing, json: JSON.stringify({ ...(editingObj||{}), username: v }) }); setEditErrors(prev=>({ ...prev, username: v.trim()? '' : t('credentials_error_username_required') })) }}
                    />
                    {editErrors.username && <div id="edit-credential-username-error" className="text-sm text-red-600">{editErrors.username}</div>}
                  </div>
                  <div>
                    <input
                      id="edit-credential-password"
                      className="input"
                      placeholder={(editingObj?.password && editingObj.password.includes('*')) ? '••••' : t('credentials_field_password_keep_placeholder')}
                      type="password"
                      aria-label={t('credentials_field_password_keep_placeholder')}
                      value={(editingObj?.password && editingObj.password.includes('*')) ? '' : (editingObj?.password || '')}
                      onChange={e => { const v=e.target.value; setEditing({ ...editing, json: JSON.stringify({ ...(editingObj||{}), password: v }) }) }}
                    />
                  </div>
                  </div>
              )}
              {editing.kind === 'miniflux' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <div>
                    <input
                      id="edit-credential-miniflux-url"
                      className="input"
                      placeholder={editingObj?.miniflux_url || t('credentials_field_miniflux_url_placeholder')}
                      aria-label={t('credentials_field_miniflux_url_placeholder')}
                      aria-invalid={Boolean(editErrors.miniflux_url)}
                      aria-describedby={editErrors.miniflux_url ? 'edit-credential-miniflux-url-error' : undefined}
                      value={editingObj?.miniflux_url || ''}
                      onChange={e => { const v=e.target.value; setEditing({ ...editing, json: JSON.stringify({ ...(editingObj||{}), miniflux_url: v }) }); setEditErrors(prev=>({ ...prev, miniflux_url: isValidUrl(v)? '' : t('credentials_error_miniflux_url_invalid') })) }}
                    />
                    {editErrors.miniflux_url && <div id="edit-credential-miniflux-url-error" className="text-sm text-red-600">{editErrors.miniflux_url}</div>}
                  </div>
                  <div>
                    <input
                      id="edit-credential-api-key"
                      className="input"
                      placeholder={(editingObj?.api_key && editingObj.api_key.includes('*')) ? '••••' : t('credentials_field_api_key_keep_placeholder')}
                      aria-label={t('credentials_field_api_key_keep_placeholder')}
                      value={(editingObj?.api_key && editingObj.api_key.includes('*')) ? '' : (editingObj?.api_key || '')}
                      onChange={e => { const v=e.target.value; setEditing({ ...editing, json: JSON.stringify({ ...(editingObj||{}), api_key: v }) }) }}
                    />
                  </div>
                </div>
              )}
              {editing.kind === 'instapaper' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <div>
                    <input
                      id="edit-credential-oauth-token"
                      className="input"
                      placeholder={(editingObj?.oauth_token && editingObj.oauth_token.includes('*')) ? '••••' : t('credentials_field_oauth_token_keep_placeholder')}
                      aria-label={t('credentials_field_oauth_token_keep_placeholder')}
                      value={(editingObj?.oauth_token && editingObj.oauth_token.includes('*')) ? '' : (editingObj?.oauth_token || '')}
                      onChange={e => { const v=e.target.value; setEditing({ ...editing, json: JSON.stringify({ ...(editingObj||{}), oauth_token: v }) }) }}
                    />
                  </div>
                  <div>
                    <input
                      id="edit-credential-oauth-secret"
                      className="input"
                      placeholder={(editingObj?.oauth_token_secret && editingObj.oauth_token_secret.includes('*')) ? '••••' : t('credentials_field_oauth_secret_keep_placeholder')}
                      aria-label={t('credentials_field_oauth_secret_keep_placeholder')}
                      value={(editingObj?.oauth_token_secret && editingObj.oauth_token_secret.includes('*')) ? '' : (editingObj?.oauth_token_secret || '')}
                      onChange={e => { const v=e.target.value; setEditing({ ...editing, json: JSON.stringify({ ...(editingObj||{}), oauth_token_secret: v }) }) }}
                    />
                  </div>
                </div>
              )}
              {editing.kind === 'instapaper_app' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <div>
                    <input
                      id="edit-credential-consumer-key"
                      className="input"
                      placeholder={editingObj?.consumer_key || t('credentials_field_consumer_key_placeholder')}
                      aria-label={t('credentials_field_consumer_key_placeholder')}
                      aria-invalid={Boolean(editErrors.consumer_key)}
                      aria-describedby={editErrors.consumer_key ? 'edit-credential-consumer-key-error' : undefined}
                      value={editingObj?.consumer_key || ''}
                      onChange={e => { const v=e.target.value; setEditing({ ...editing, json: JSON.stringify({ ...(editingObj||{}), consumer_key: v }) }); setEditErrors(prev=>({ ...prev, consumer_key: v.trim()? '' : t('credentials_error_required') })) }}
                    />
                    {editErrors.consumer_key && <div id="edit-credential-consumer-key-error" className="text-sm text-red-600">{editErrors.consumer_key}</div>}
                  </div>
                  <div>
                    <input
                      id="edit-credential-consumer-secret"
                      className="input"
                      placeholder={(editingObj?.consumer_secret && editingObj.consumer_secret.includes('*')) ? '••••' : t('credentials_field_consumer_secret_keep_placeholder')}
                      aria-label={t('credentials_field_consumer_secret_keep_placeholder')}
                      value={(editingObj?.consumer_secret && editingObj.consumer_secret.includes('*')) ? '' : (editingObj?.consumer_secret || '')}
                      onChange={e => { const v=e.target.value; setEditing({ ...editing, json: JSON.stringify({ ...(editingObj||{}), consumer_secret: v }) }) }}
                    />
                  </div>
                </div>
              )}
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
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
                  title={t('form_fill_required')}
                  onClick={saveEdit}
                >
                  {t('btn_save')}
                </button>
                <button type="button" className="btn" onClick={() => setEditing(null)}>{t('btn_cancel')}</button>
              </div>
            </div>
          )}
          </>
        )}
      </main>
    </div>
  )
}
