import useSWR from 'swr'
import { Alert, Breadcrumbs, EmptyState, InlineTip, Nav } from '../components'
import { v1, creds, createInstapaperCredentialFromLogin } from '../lib/openapi'
import { useEffect, useMemo, useState } from 'react'
import { parseJsonSafe, validateCredential, isValidUrl } from '../lib/validate'
import { useI18n } from '../lib/i18n'
import { buildBreadcrumbs } from '../lib/breadcrumbs'
import { useRouter } from 'next/router'
import { useSessionReauth } from '../lib/useSessionReauth'
import {
  extractPermissionList,
  hasPermission,
  PERMISSION_MANAGE_GLOBAL_CREDENTIALS,
  PERMISSION_READ_GLOBAL_CREDENTIALS,
} from '../lib/rbac'

export default function Credentials() {
  const { t } = useI18n()
  const router = useRouter()
  const { data: session, status } = useSessionReauth()
  const breadcrumbs = useMemo(() => buildBreadcrumbs(router.pathname, t), [router.pathname, t])
  const permissions = extractPermissionList(session?.user)
  const currentUserId =
    typeof session?.user?.id === 'string' && session.user.id.trim().length > 0
      ? session.user.id.trim()
      : undefined
  const isAuthenticated = status === 'authenticated'
  const canViewCredentials = Boolean(
    isAuthenticated &&
      (hasPermission(permissions, PERMISSION_READ_GLOBAL_CREDENTIALS) ||
        hasPermission(permissions, PERMISSION_MANAGE_GLOBAL_CREDENTIALS)),
  )
  const { data, error, isLoading, mutate } = useSWR(
    canViewCredentials ? ['/v1/credentials'] : null,
    () => v1.listCredentialsV1V1CredentialsGet({}),
  )
  const {
    data: siteConfigsData,
    error: siteConfigsError,
    isLoading: isLoadingSiteConfigs,
  } = useSWR(
    isAuthenticated ? ['/v1/site-configs'] : null,
    () => v1.listSiteConfigsV1V1SiteConfigsGet({ size: 200 }),
  )
  const [kind, setKind] = useState('site_login')
  const [description, setDescription] = useState('')
  const [jsonData, setJsonData] = useState('{\n  "username": "",\n  "password": ""\n}')
  const [siteConfigId, setSiteConfigId] = useState('')
  const [banner, setBanner] = useState<{ kind: 'success' | 'error'; message: string } | null>(null)
  const [editing, setEditing] = useState<{ id: string; kind: string; json: string } | null>(null)
  const [editDescription, setEditDescription] = useState('')
  const [editSiteConfigId, setEditSiteConfigId] = useState('')
  const [createErrors, setCreateErrors] = useState<Record<string, string>>({})
  const [editErrors, setEditErrors] = useState<Record<string, string>>({})
  const createObj = (() => { try { return JSON.parse(jsonData || '{}') } catch { return {} } })() as any
  const editingObj = editing ? (() => { try { return JSON.parse(editing.json || '{}') } catch { return {} } })() as any : null
  const hasDescription = description.trim().length > 0
  const hasEditDescription = editDescription.trim().length > 0
  const siteConfigItems = useMemo(() => {
    if (!siteConfigsData) return [] as any[]
    if (Array.isArray(siteConfigsData)) return siteConfigsData as any[]
    if (Array.isArray((siteConfigsData as any).items)) return (siteConfigsData as any).items as any[]
    return [] as any[]
  }, [siteConfigsData])
  const siteConfigOptions = useMemo(
    () =>
      siteConfigItems.map((item: any) => ({
        id: item.id,
        label: item.name || item.id,
      })),
    [siteConfigItems],
  )
  const siteConfigMap = useMemo(() => {
    const map = new Map<string, any>()
    for (const item of siteConfigItems) {
      if (item?.id) map.set(String(item.id), item)
    }
    return map
  }, [siteConfigItems])

  useEffect(() => {
    if (kind !== 'site_login') {
      setSiteConfigId('')
      setCreateErrors((prev) => {
        if (!prev.site_config_id) return prev
        const next = { ...prev }
        delete next.site_config_id
        return next
      })
    }
  }, [kind])

  useEffect(() => {
    if (!editing || editing.kind !== 'site_login') {
      setEditSiteConfigId('')
      setEditErrors((prev) => {
        if (!prev.site_config_id) return prev
        const next = { ...prev }
        delete next.site_config_id
        return next
      })
    }
  }, [editing])

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
    const trimmedDescription = description.trim()
    if (!trimmedDescription) {
      const message = t('credentials_error_description_required')
      setCreateErrors((prev) => ({ ...prev, description: message }))
      setBanner({ kind: 'error', message })
      return
    }

    const parsed = parseJsonSafe(jsonData)
    if (!parsed.ok) {
      setBanner({ kind: 'error', message: parsed.error })
      return
    }

    const trimmedSiteConfigId = kind === 'site_login' ? siteConfigId.trim() : ''
    if (kind === 'site_login' && !trimmedSiteConfigId) {
      const message = t('credentials_error_site_config_required')
      setCreateErrors((prev) => ({ ...prev, site_config_id: message }))
      setBanner({ kind: 'error', message })
      return
    }

    const err = validateCredential(kind, parsed.data, trimmedDescription, trimmedSiteConfigId)
    if (err) {
      setBanner({ kind: 'error', message: err })
      return
    }

    try {
      if (kind === 'instapaper') {
        await createInstapaperCredentialFromLogin({
          description: trimmedDescription,
          username: parsed.data.username,
          password: parsed.data.password,
        })
      } else {
        const credentialPayload: any = {
          kind,
          description: trimmedDescription,
          data: parsed.data,
        }

        if (currentUserId) {
          credentialPayload.ownerUserId = currentUserId
        }

        if (kind === 'site_login') {
          credentialPayload.siteConfigId = trimmedSiteConfigId
        }

        await creds.createCredentialCredentialsPost({
          credential: credentialPayload,
        })
      }

      setJsonData('')
      setDescription('')
      setSiteConfigId('')
      setCreateErrors({})
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
      if (e?.response?.status === 404) {
        setBanner({ kind: 'error', message: t('credentials_delete_forbidden') })
      } else {
        setBanner({ kind: 'error', message: e.message || String(e) })
      }
    }
  }

  async function startEdit(id: string, kind: string) {
    try {
      const full = await creds.getCredentialCredentialsCredIdGet({ credId: id })
      const body = full?.data ?? {}
      setEditing({ id, kind, json: JSON.stringify(body, null, 2) })
      setEditDescription((full?.description ?? '').toString())
      const siteConfigRaw = (full as any)?.site_config_id ?? full?.siteConfigId ?? ''
      setEditSiteConfigId(siteConfigRaw != null ? String(siteConfigRaw) : '')
      setEditErrors({})
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
    const trimmedDescription = editDescription.trim()
    if (!trimmedDescription) {
      const message = t('credentials_error_description_required')
      setEditErrors((prev) => ({ ...prev, description: message }))
      setBanner({ kind: 'error', message })
      return
    }
    const trimmedSiteConfigId = editing.kind === 'site_login' ? editSiteConfigId.trim() : ''
    if (editing.kind === 'site_login' && !trimmedSiteConfigId) {
      const message = t('credentials_error_site_config_required')
      setEditErrors((prev) => ({ ...prev, site_config_id: message }))
      setBanner({ kind: 'error', message })
      return
    }
    try {
      await creds.updateCredentialCredentialsCredIdPut({
        credId: editing.id,
        credential: {
          kind: editing.kind,
          description: trimmedDescription,
          data,
          ...(editing.kind === 'site_login' ? { siteConfigId: trimmedSiteConfigId } : {}),
        } as any,
      })
      setEditing(null)
      setEditDescription('')
      setEditSiteConfigId('')
      setBanner({ kind: 'success', message: t('credentials_update_success') })
      mutate()
    } catch (e: any) {
      setBanner({ kind: 'error', message: e?.message || String(e) })
    }
  }

  if (status === 'loading') {
    return (
      <div>
        <Nav />
        <main className="container py-12">
          <p className="text-gray-700">{t('loading_text')}</p>
        </main>
      </div>
    )
  }

  const renderAccessMessage = (title: string, message: string) => (
    <div>
      <Nav />
      <main className="container py-12">
        <div className="max-w-xl space-y-2">
          <h1 className="text-2xl font-semibold text-gray-900">{title}</h1>
          <p className="text-gray-700">{message}</p>
        </div>
      </main>
    </div>
  )

  if (status === 'unauthenticated') {
    return renderAccessMessage(t('access_sign_in_title'), t('access_sign_in_message'))
  }

  if (!canViewCredentials) {
    return renderAccessMessage(t('access_denied_title'), t('access_denied_message'))
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
            <div>
              <input
                id="create-credential-description"
                className="input"
                placeholder={t('credentials_field_description_placeholder')}
                aria-label={t('credentials_field_description_placeholder')}
                aria-invalid={Boolean(createErrors.description)}
                aria-describedby={createErrors.description ? 'create-credential-description-error' : undefined}
                value={description}
                onChange={(e) => {
                  const v = e.target.value
                  setDescription(v)
                  setCreateErrors((prev) => ({
                    ...prev,
                    description: v.trim() ? '' : t('credentials_error_description_required'),
                  }))
                }}
              />
              {createErrors.description && (
                <div id="create-credential-description-error" className="text-sm text-red-600">
                  {createErrors.description}
                </div>
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <label htmlFor="credential-kind-select">{t('credentials_kind_label')}:</label>
                <InlineTip className="ml-1" message={t('credentials_kind_tip')} />
              </div>
              <select
                id="credential-kind-select"
                className="input"
                value={kind}
                onChange={(e) => {
                  const nextKind = e.target.value
                  setKind(nextKind)
                }}
              >
                <option value="site_login">{t('credentials_kind_site_login')}</option>
                <option value="miniflux">{t('credentials_kind_miniflux')}</option>
                <option value="instapaper">{t('credentials_kind_instapaper')}</option>
                <option value="instapaper_app">{t('credentials_kind_instapaper_app')}</option>
              </select>
            </div>
            {kind === 'site_login' && (
              <div className="space-y-2">
                <div>
                  <label htmlFor="create-credential-site-config" className="block text-sm font-medium text-gray-700">
                    {t('site_config_label')}
                  </label>
                  <select
                    id="create-credential-site-config"
                    className="input"
                    value={siteConfigId}
                    onChange={(event) => {
                      const value = event.target.value
                      setSiteConfigId(value)
                      setCreateErrors((prev) => ({
                        ...prev,
                        site_config_id: value ? '' : t('credentials_error_site_config_required'),
                      }))
                    }}
                    aria-invalid={Boolean(createErrors.site_config_id)}
                    aria-describedby={createErrors.site_config_id ? 'create-credential-site-config-error' : undefined}
                    disabled={isLoadingSiteConfigs || siteConfigOptions.length === 0}
                    aria-disabled={isLoadingSiteConfigs || siteConfigOptions.length === 0}
                  >
                    <option value="">
                      {t('credentials_field_site_config_placeholder')}
                    </option>
                    {siteConfigOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  {isLoadingSiteConfigs && (
                    <div className="text-sm text-gray-500">{t('loading_text')}</div>
                  )}
                  {siteConfigsError && (
                    <div className="text-sm text-red-600">
                      {siteConfigsError instanceof Error ? siteConfigsError.message : String(siteConfigsError)}
                    </div>
                  )}
                  {!isLoadingSiteConfigs && !siteConfigsError && siteConfigOptions.length === 0 && (
                    <div className="text-sm text-gray-500">{t('credentials_site_config_empty')}</div>
                  )}
                  {createErrors.site_config_id && (
                    <div id="create-credential-site-config-error" className="text-sm text-red-600">
                      {createErrors.site_config_id}
                    </div>
                  )}
                </div>
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
                    id="create-credential-instapaper-username"
                    className="input"
                    placeholder={t('credentials_field_instapaper_username_placeholder')}
                    aria-label={t('credentials_field_instapaper_username_placeholder')}
                    aria-invalid={Boolean(createErrors.username)}
                    aria-describedby={createErrors.username ? 'create-credential-instapaper-username-error' : undefined}
                    autoComplete="username"
                    value={createObj.username || ''}
                    onChange={(e) => {
                      const v = e.target.value
                      setJsonData(JSON.stringify({ username: v, password: createObj.password || '' }))
                      setCreateErrors((prev) => ({
                        ...prev,
                        username: v.trim() ? '' : t('credentials_error_username_required'),
                      }))
                    }}
                  />
                  {createErrors.username && (
                    <div id="create-credential-instapaper-username-error" className="text-sm text-red-600">
                      {createErrors.username}
                    </div>
                  )}
                </div>
                <div>
                  <input
                    id="create-credential-instapaper-password"
                    className="input"
                    placeholder={t('credentials_field_instapaper_password_placeholder')}
                    aria-label={t('credentials_field_instapaper_password_placeholder')}
                    type="password"
                    aria-invalid={Boolean(createErrors.password)}
                    aria-describedby={createErrors.password ? 'create-credential-instapaper-password-error' : undefined}
                    autoComplete="current-password"
                    value={createObj.password || ''}
                    onChange={(e) => {
                      const v = e.target.value
                      setJsonData(JSON.stringify({ username: createObj.username || '', password: v }))
                      setCreateErrors((prev) => ({
                        ...prev,
                        password: v.trim() ? '' : t('credentials_error_password_required'),
                      }))
                    }}
                  />
                  {createErrors.password && (
                    <div id="create-credential-instapaper-password-error" className="text-sm text-red-600">
                      {createErrors.password}
                    </div>
                  )}
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
                    hasDescription &&
                    (
                      (kind === 'site_login' && !!(siteConfigId.trim() && createObj.username?.trim() && createObj.password?.trim())) ||
                      (kind === 'miniflux' && !!(createObj.miniflux_url && isValidUrl(createObj.miniflux_url) && createObj.api_key?.trim())) ||
                      (kind === 'instapaper' && !!(createObj.username?.trim() && createObj.password?.trim())) ||
                      (kind === 'instapaper_app' && !!(createObj.consumer_key?.trim() && createObj.consumer_secret?.trim()))
                    )
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
                    <th className="th" scope="col">{t('credentials_table_column_credential')}</th>
                    <th className="th" scope="col">{t('kind_label')}</th>
                    <th className="th" scope="col">{t('site_config_label')}</th>
                    <th className="th" scope="col">{t('actions_label')}</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.items ?? data).map((c: any) => (
                    <tr key={c.id} className="odd:bg-white even:bg-gray-50">
                      <td className="td">
                        <div className="font-medium text-gray-900">{c.description}</div>
                        <div className="text-sm text-gray-500">{t('credentials_table_id_caption', { id: c.id })}</div>
                      </td>
                      <td className="td">{c.kind}</td>
                      <td className="td">
                        {(() => {
                          const scId = c.site_config_id ?? c.siteConfigId ?? ''
                          if (!scId) return <span aria-hidden="true">—</span>
                          const entry = siteConfigMap.get(String(scId))
                          const displayName = entry?.name || scId
                          return (
                            <div className="space-y-0.5">
                              <div className="text-gray-900">{displayName}</div>
                              <div className="text-xs text-gray-500">{t('credentials_table_id_caption', { id: scId })}</div>
                            </div>
                          )
                        })()}
                      </td>
                      <td className="td flex flex-wrap gap-2">
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
            <div
              className="card p-4 mt-3 md:ml-auto md:max-w-xl"
              role="dialog"
              aria-modal="true"
              aria-labelledby="edit-credential-heading"
            >
              <form
                role="form"
                aria-labelledby="edit-credential-heading"
                onSubmit={(event) => {
                  event.preventDefault()
                  saveEdit()
                }}
                className="space-y-3"
              >
                <h3 id="edit-credential-heading" className="font-semibold">
                  {t('credentials_edit_heading', { id: editing.id })}
                </h3>
                <div className="text-sm text-gray-700">{t('credentials_kind_display', { kind: editing.kind })}</div>
                <div>
                  <input
                    id="edit-credential-description"
                    className="input"
                    placeholder={t('credentials_field_description_placeholder')}
                    aria-label={t('credentials_field_description_placeholder')}
                    aria-invalid={Boolean(editErrors.description)}
                    aria-describedby={editErrors.description ? 'edit-credential-description-error' : undefined}
                    value={editDescription}
                    onChange={(e) => {
                      const v = e.target.value
                      setEditDescription(v)
                      setEditErrors((prev) => ({
                        ...prev,
                        description: v.trim() ? '' : t('credentials_error_description_required'),
                      }))
                    }}
                  />
                  {editErrors.description && (
                    <div id="edit-credential-description-error" className="text-sm text-red-600">
                      {editErrors.description}
                    </div>
                  )}
                </div>
                {editing.kind === 'site_login' && (
                  <div className="space-y-2">
                    <div>
                      <label htmlFor="edit-credential-site-config" className="block text-sm font-medium text-gray-700">
                        {t('site_config_label')}
                      </label>
                      <select
                        id="edit-credential-site-config"
                        className="input"
                        value={editSiteConfigId}
                        onChange={(event) => {
                          const value = event.target.value
                          setEditSiteConfigId(value)
                          setEditErrors((prev) => ({
                            ...prev,
                            site_config_id: value ? '' : t('credentials_error_site_config_required'),
                          }))
                        }}
                        aria-invalid={Boolean(editErrors.site_config_id)}
                        aria-describedby={editErrors.site_config_id ? 'edit-credential-site-config-error' : undefined}
                        disabled={siteConfigOptions.length === 0}
                        aria-disabled={siteConfigOptions.length === 0}
                      >
                        <option value="">
                          {t('credentials_field_site_config_placeholder')}
                        </option>
                        {siteConfigOptions.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      {siteConfigOptions.length === 0 && (
                        <div className="text-sm text-gray-500">{t('credentials_site_config_empty')}</div>
                      )}
                      {editErrors.site_config_id && (
                        <div id="edit-credential-site-config-error" className="text-sm text-red-600">
                          {editErrors.site_config_id}
                        </div>
                      )}
                    </div>
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
                <div className="flex gap-2">
                  <button
                    type="submit"
                    className="btn"
                    disabled={
                      !editing ||
                      !(
                        hasEditDescription &&
                        (
                          (editing.kind === 'site_login' && !!(editSiteConfigId.trim() && editingObj?.username?.trim())) ||
                          (editing.kind === 'miniflux' && !!(editingObj?.miniflux_url && isValidUrl(editingObj.miniflux_url))) ||
                          (editing.kind === 'instapaper') ||
                          (editing.kind === 'instapaper_app' && !!(editingObj?.consumer_key?.trim()))
                        )
                      )
                    }
                    title={t('form_fill_required')}
                  >
                    {t('btn_save')}
                  </button>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      setEditing(null)
                      setEditDescription('')
                      setEditErrors({})
                      setEditSiteConfigId('')
                    }}
                  >
                    {t('btn_cancel')}
                  </button>
                </div>
              </form>
            </div>
          )}
          </>
        )}
      </main>
    </div>
  )
}
