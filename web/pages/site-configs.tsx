import useSWR from 'swr'
import { Alert, Breadcrumbs, EmptyState, Nav } from '../components'
import { v1, siteConfigs as site } from '../lib/openapi'
import { useMemo, useState } from 'react'
import { validateSiteConfig } from '../lib/validate'
import { useI18n } from '../lib/i18n'
import { buildBreadcrumbs } from '../lib/breadcrumbs'
import { useRouter } from 'next/router'

export default function SiteConfigs() {
  const { t } = useI18n()
  const router = useRouter()
  const breadcrumbs = useMemo(() => buildBreadcrumbs(router.pathname, t), [router.pathname, t])
  const { data, error, isLoading, mutate } = useSWR(['/v1/site-configs'], () => v1.listSiteConfigsV1V1SiteConfigsGet({}))
  const [form, setForm] = useState({ name: '', site_url: '', username_selector: '', password_selector: '', login_button_selector: '', cookies_to_store: '' })
  const [createErrors, setCreateErrors] = useState<Record<string,string>>({})
  const [scopeGlobal, setScopeGlobal] = useState(false)
  const [banner, setBanner] = useState<{ kind: 'success' | 'error'; message: string } | null>(null)
  const [copyingId, setCopyingId] = useState<string | null>(null)
  const [editing, setEditing] = useState<any | null>(null)
  const [editErrors, setEditErrors] = useState<Record<string,string>>({})

  const toApiSiteConfig = (input: any) => {
    const payload: Record<string, any> = {
      name: input.name,
      siteUrl: input.site_url,
      usernameSelector: input.username_selector,
      passwordSelector: input.password_selector,
      loginButtonSelector: input.login_button_selector,
      cookiesToStore: Array.isArray(input.cookies_to_store) ? input.cookies_to_store : [],
    }
    if (input.post_login_selector) payload.postLoginSelector = input.post_login_selector
    if (input.owner_user_id !== undefined) payload.ownerUserId = input.owner_user_id
    return payload
  }

  async function create() {
    const body: any = {
      ...form,
      cookies_to_store: form.cookies_to_store.split(',').map(s => s.trim()).filter(Boolean)
    }
    try {
      const err = validateSiteConfig(body)
      if (err) { setBanner({ kind: 'error', message: err }); return }
      const apiPayload = { ...toApiSiteConfig(body), ownerUserId: scopeGlobal ? null : undefined }
      await site.createSiteConfigSiteConfigsPost({ siteConfig: apiPayload })
      setForm({ name: '', site_url: '', username_selector: '', password_selector: '', login_button_selector: '', cookies_to_store: '' })
      setScopeGlobal(false)
      setBanner({ kind: 'success', message: t('site_configs_create_success') })
      mutate()
    } catch (e: any) {
      setBanner({ kind: 'error', message: e.message || String(e) })
    }
  }

  async function del(id: string) {
    if (!confirm(t('site_configs_confirm_delete'))) return
    try {
      await site.deleteSiteConfigSiteConfigsConfigIdDelete({ configId: id })
      setBanner({ kind: 'success', message: t('site_configs_delete_success') })
      mutate()
    } catch (e: any) {
      setBanner({ kind: 'error', message: e.message || String(e) })
    }
  }

  async function copyToUser(configId: string) {
    setBanner(null)
    setCopyingId(configId)
    try {
      const copied = await site.copySiteConfigToUser({ configId })
      const appendConfig = (candidate: any) => {
        const list = Array.isArray(candidate) ? candidate : []
        const exists = list.some((item: any) => item?.id === copied.id)
        return exists ? { list, added: false } : { list: [...list, copied], added: true }
      }
      const applyToPage = (page: any) => {
        if (!page || typeof page !== 'object') return page
        const { list, added } = appendConfig(page.items)
        if (!added) return page
        const nextTotal = typeof page.total === 'number' ? page.total + 1 : page.total
        return { ...page, items: list, total: nextTotal }
      }
      await mutate((current: any) => {
        if (Array.isArray(current)) {
          const { list, added } = appendConfig(current)
          return added ? list : current
        }
        if (current && typeof current === 'object') {
          return applyToPage(current)
        }
        if (current == null) {
          if (Array.isArray(data)) {
            const { list, added } = appendConfig(data)
            return added ? list : data
          }
          if (data && typeof data === 'object') {
            return applyToPage(data)
          }
        }
        return current
      }, { revalidate: false })
      setBanner({ kind: 'success', message: t('copy_to_workspace_success') })
    } catch (e: any) {
      const reason = e?.message || String(e)
      setBanner({ kind: 'error', message: t('copy_to_workspace_error', { reason }) })
    } finally {
      setCopyingId(null)
    }
  }
  return (
    <div>
      <Nav />
      <Breadcrumbs items={breadcrumbs} />
      <main className="container py-6">
        <h2 id="site-configs-heading" className="text-xl font-semibold mb-3">{t('site_configs_title')}</h2>
        {banner && <div className="mb-3"><Alert kind={banner.kind} message={banner.message} onClose={() => setBanner(null)} /></div>}
        {isLoading && <p className="text-gray-600">{t('loading_text')}</p>}
        {error && <Alert kind="error" message={String(error)} />}
        <form
          id="create-site-config"
          className="card p-4 mb-4 grid grid-cols-1 md:grid-cols-2 gap-2"
          role="form"
          aria-labelledby="create-site-config-heading"
          onSubmit={(e) => { e.preventDefault(); create() }}
        >
          <h3 id="create-site-config-heading" className="font-semibold md:col-span-2">
            {t('site_configs_create_heading')}
            <span className="ml-2 text-gray-500 cursor-help" title={t('site_configs_create_help')}>?</span>
          </h3>
          <div>
            <input
              id="create-site-config-name"
              className="input"
              placeholder={t('site_configs_field_name_placeholder')}
              aria-label={t('site_configs_field_name_placeholder')}
              aria-invalid={Boolean(createErrors.name)}
              aria-describedby={createErrors.name ? 'create-site-config-name-error' : undefined}
              value={form.name}
              onChange={e => { const v=e.target.value; setForm({ ...form, name: v }); setCreateErrors(prev=>({ ...prev, name: v.trim()? '' : t('site_configs_error_name_required') })) }}
            />
            {createErrors.name && <div id="create-site-config-name-error" className="text-sm text-red-600">{createErrors.name}</div>}
          </div>
          <div>
            <input
              id="create-site-config-url"
              className="input"
              placeholder={t('site_configs_field_url_placeholder')}
              aria-label={t('site_configs_field_url_placeholder')}
              aria-invalid={Boolean(createErrors.site_url)}
              aria-describedby={createErrors.site_url ? 'create-site-config-url-error' : undefined}
              value={form.site_url}
              onChange={e => { const v=e.target.value; setForm({ ...form, site_url: v }); setCreateErrors(prev=>({ ...prev, site_url: v.startsWith('http')? '' : t('site_configs_error_url_invalid') })) }}
            />
            {createErrors.site_url && <div id="create-site-config-url-error" className="text-sm text-red-600">{createErrors.site_url}</div>}
          </div>
          <div>
            <input
              id="create-site-config-username-selector"
              className="input"
              placeholder={t('site_configs_field_username_selector_placeholder')}
              aria-label={t('site_configs_field_username_selector_placeholder')}
              aria-invalid={Boolean(createErrors.username_selector)}
              aria-describedby={createErrors.username_selector ? 'create-site-config-username-selector-error' : undefined}
              value={form.username_selector}
              onChange={e => { const v=e.target.value; setForm({ ...form, username_selector: v }); setCreateErrors(prev=>({ ...prev, username_selector: v.trim()? '' : t('site_configs_error_required') })) }}
            />
            {createErrors.username_selector && <div id="create-site-config-username-selector-error" className="text-sm text-red-600">{createErrors.username_selector}</div>}
          </div>
          <div>
            <input
              id="create-site-config-password-selector"
              className="input"
              placeholder={t('site_configs_field_password_selector_placeholder')}
              aria-label={t('site_configs_field_password_selector_placeholder')}
              aria-invalid={Boolean(createErrors.password_selector)}
              aria-describedby={createErrors.password_selector ? 'create-site-config-password-selector-error' : undefined}
              value={form.password_selector}
              onChange={e => { const v=e.target.value; setForm({ ...form, password_selector: v }); setCreateErrors(prev=>({ ...prev, password_selector: v.trim()? '' : t('site_configs_error_required') })) }}
            />
            {createErrors.password_selector && <div id="create-site-config-password-selector-error" className="text-sm text-red-600">{createErrors.password_selector}</div>}
          </div>
          <div>
            <input
              id="create-site-config-login-selector"
              className="input"
              placeholder={t('site_configs_field_login_selector_placeholder')}
              aria-label={t('site_configs_field_login_selector_placeholder')}
              aria-invalid={Boolean(createErrors.login_button_selector)}
              aria-describedby={createErrors.login_button_selector ? 'create-site-config-login-selector-error' : undefined}
              value={form.login_button_selector}
              onChange={e => { const v=e.target.value; setForm({ ...form, login_button_selector: v }); setCreateErrors(prev=>({ ...prev, login_button_selector: v.trim()? '' : t('site_configs_error_required') })) }}
            />
            {createErrors.login_button_selector && <div id="create-site-config-login-selector-error" className="text-sm text-red-600">{createErrors.login_button_selector}</div>}
          </div>
          <input
            id="create-site-config-cookies"
            className="input md:col-span-2"
            placeholder={t('site_configs_field_cookies_placeholder')}
            aria-label={t('site_configs_field_cookies_placeholder')}
            value={form.cookies_to_store}
            onChange={e => setForm({ ...form, cookies_to_store: e.target.value })}
          />
          <label className="inline-flex items-center gap-2"><input type="checkbox" checked={scopeGlobal} onChange={e => setScopeGlobal(e.target.checked)} /> {t('site_configs_scope_global_label')}</label>
          <button
            type="submit"
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
            title={t('form_fill_required')}
          >
            {t('btn_create')}
          </button>
        </form>
        {data && (
          <div className="card p-0 overflow-hidden">
            {(!data.items && !Array.isArray(data)) || (Array.isArray(data) ? data.length === 0 : (data.items?.length ?? 0) === 0) ? (
              <div className="p-4">
                <EmptyState
                  icon={<span>🛠️</span>}
                  message={(
                    <div className="space-y-1">
                      <p className="text-lg font-semibold text-gray-700">{t('empty_site_configs_title')}</p>
                      <p>{t('empty_site_configs_desc')}</p>
                    </div>
                  )}
                />
              </div>
            ) : (
            <table className="table" role="table" aria-label={t('site_configs_table_label')}>
              <thead className="bg-gray-100">
                <tr>
                  <th className="th" scope="col">{t('name_label')}</th>
                  <th className="th" scope="col">{t('url_label')}</th>
                  <th className="th" scope="col">{t('scope_label')}</th>
                  <th className="th" scope="col">{t('actions_label')}</th>
                </tr>
              </thead>
              <tbody>
                {(data.items || data).map((sc: any) => (
                  <tr key={sc.id} className="odd:bg-white even:bg-gray-50">
                    <td className="td">{sc.name}</td>
                    <td className="td">{sc.site_url}</td>
                    <td className="td">{sc.owner_user_id ? t('scope_user') : t('scope_global')}</td>
                    <td className="td flex gap-2">
                      {!sc.owner_user_id && (
                        <button
                          type="button"
                          className="btn"
                          onClick={() => copyToUser(sc.id)}
                          disabled={copyingId === sc.id}
                          aria-busy={copyingId === sc.id}
                        >
                          {t('copy_to_workspace')}
                        </button>
                      )}
                      <button type="button" className="btn" onClick={async () => { try { const r = await v1.testSiteConfigV1SiteConfigsConfigIdTestPost({ configId: sc.id }); setBanner({ kind: r.ok ? 'success' : 'error', message: t('site_configs_test_result', { result: JSON.stringify(r) }) }) } catch (e: any) { setBanner({ kind: 'error', message: e.message || String(e) }) } }}>{t('site_configs_test_button')}</button>
                      <button type="button" className="btn" onClick={() => setEditing({ ...sc, cookies_to_store: (sc.cookies_to_store || []).join(',') })}>{t('btn_edit')}</button>
                      <button type="button" className="btn" onClick={() => del(sc.id)}>{t('btn_delete')}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            )}
          </div>
          )}
          {editing && (
            <div className="card p-4 mt-3 grid grid-cols-1 md:grid-cols-2 gap-2" role="form" aria-labelledby="edit-site-config-heading">
              <h3 id="edit-site-config-heading" className="font-semibold md:col-span-2">{t('site_configs_edit_heading')}</h3>
              <div>
                <input
                  id="edit-site-config-name"
                  className="input"
                  placeholder={t('site_configs_field_name_placeholder')}
                  aria-label={t('site_configs_field_name_placeholder')}
                  aria-invalid={Boolean(editErrors.name)}
                  aria-describedby={editErrors.name ? 'edit-site-config-name-error' : undefined}
                  value={editing.name}
                  onChange={e => { const v=e.target.value; setEditing({ ...editing, name: v }); setEditErrors(prev=>({ ...prev, name: v.trim()? '' : t('site_configs_error_name_required') })) }}
                />
                {editErrors.name && <div id="edit-site-config-name-error" className="text-sm text-red-600">{editErrors.name}</div>}
              </div>
              <div>
                <input
                  id="edit-site-config-url"
                  className="input"
                  placeholder={t('site_configs_field_url_placeholder')}
                  aria-label={t('site_configs_field_url_placeholder')}
                  aria-invalid={Boolean(editErrors.site_url)}
                  aria-describedby={editErrors.site_url ? 'edit-site-config-url-error' : undefined}
                  value={editing.site_url}
                  onChange={e => { const v=e.target.value; setEditing({ ...editing, site_url: v }); setEditErrors(prev=>({ ...prev, site_url: v.startsWith('http')? '' : t('site_configs_error_url_invalid') })) }}
                />
                {editErrors.site_url && <div id="edit-site-config-url-error" className="text-sm text-red-600">{editErrors.site_url}</div>}
              </div>
              <div>
                <input
                  id="edit-site-config-username-selector"
                  className="input"
                  placeholder={t('site_configs_field_username_selector_placeholder')}
                  aria-label={t('site_configs_field_username_selector_placeholder')}
                  aria-invalid={Boolean(editErrors.username_selector)}
                  aria-describedby={editErrors.username_selector ? 'edit-site-config-username-selector-error' : undefined}
                  value={editing.username_selector}
                  onChange={e => { const v=e.target.value; setEditing({ ...editing, username_selector: v }); setEditErrors(prev=>({ ...prev, username_selector: v.trim()? '' : t('site_configs_error_required') })) }}
                />
                {editErrors.username_selector && <div id="edit-site-config-username-selector-error" className="text-sm text-red-600">{editErrors.username_selector}</div>}
              </div>
              <div>
                <input
                  id="edit-site-config-password-selector"
                  className="input"
                  placeholder={t('site_configs_field_password_selector_placeholder')}
                  aria-label={t('site_configs_field_password_selector_placeholder')}
                  aria-invalid={Boolean(editErrors.password_selector)}
                  aria-describedby={editErrors.password_selector ? 'edit-site-config-password-selector-error' : undefined}
                  value={editing.password_selector}
                  onChange={e => { const v=e.target.value; setEditing({ ...editing, password_selector: v }); setEditErrors(prev=>({ ...prev, password_selector: v.trim()? '' : t('site_configs_error_required') })) }}
                />
                {editErrors.password_selector && <div id="edit-site-config-password-selector-error" className="text-sm text-red-600">{editErrors.password_selector}</div>}
              </div>
              <div>
                <input
                  id="edit-site-config-login-selector"
                  className="input"
                  placeholder={t('site_configs_field_login_selector_placeholder')}
                  aria-label={t('site_configs_field_login_selector_placeholder')}
                  aria-invalid={Boolean(editErrors.login_button_selector)}
                  aria-describedby={editErrors.login_button_selector ? 'edit-site-config-login-selector-error' : undefined}
                  value={editing.login_button_selector}
                  onChange={e => { const v=e.target.value; setEditing({ ...editing, login_button_selector: v }); setEditErrors(prev=>({ ...prev, login_button_selector: v.trim()? '' : t('site_configs_error_required') })) }}
                />
                {editErrors.login_button_selector && <div id="edit-site-config-login-selector-error" className="text-sm text-red-600">{editErrors.login_button_selector}</div>}
              </div>
              <input
                id="edit-site-config-cookies"
                className="input md:col-span-2"
                placeholder={t('site_configs_field_cookies_placeholder')}
                aria-label={t('site_configs_field_cookies_placeholder')}
                value={editing.cookies_to_store}
                onChange={e => setEditing({ ...editing, cookies_to_store: e.target.value })}
              />
              <div className="md:col-span-2 flex gap-2">
                <button
                  type="button"
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
                  title={t('form_fill_required')}
                  onClick={async () => {
                  const body: any = { ...editing, cookies_to_store: String(editing.cookies_to_store || '').split(',').map((s: string) => s.trim()).filter(Boolean) }
                  const err = validateSiteConfig(body)
                  if (err) { setBanner({ kind: 'error', message: err }); return }
                  try {
                    const apiPayload = toApiSiteConfig(body)
                    await site.updateSiteConfigSiteConfigsConfigIdPut({ configId: editing.id, siteConfig: apiPayload })
                    setBanner({ kind: 'success', message: t('site_configs_update_success') })
                    setEditing(null)
                    mutate()
                  } catch (e: any) {
                    setBanner({ kind: 'error', message: e?.message || String(e) })
                  }
                }}>{t('btn_save')}</button>
                <button type="button" className="btn" onClick={() => setEditing(null)}>{t('btn_cancel')}</button>
              </div>
            </div>
          )}
      </main>
    </div>
  )
}
