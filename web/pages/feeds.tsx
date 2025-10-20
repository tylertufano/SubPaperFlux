import useSWR from 'swr'
import {
  Alert,
  AutocompleteMultiSelect,
  AutocompleteSingleSelect,
  Breadcrumbs,
  ConfigEditorPanel,
  EmptyState,
  Nav,
} from '../components'
import { v1, feeds as feedsApi } from '../lib/openapi'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useI18n } from '../lib/i18n'
import { buildBreadcrumbs } from '../lib/breadcrumbs'
import { useRouter } from 'next/router'
import { useSessionReauth } from '../lib/useSessionReauth'
import { extractPermissionList, hasPermission, PERMISSION_MANAGE_BOOKMARKS, PERMISSION_READ_BOOKMARKS } from '../lib/rbac'
import type { Credential } from '../sdk/src/models/Credential'
import type { TagOut } from '../sdk/src/models/TagOut'
import type { FolderOut } from '../sdk/src/models/FolderOut'
import { buildSiteConfigLabelMap, buildSiteLoginOptions, SiteLoginOption } from '../lib/siteLoginOptions'

export default function Feeds() {
  const { t } = useI18n()
  const router = useRouter()
  const { data: session, status: sessionStatus } = useSessionReauth()
  const breadcrumbs = useMemo(() => buildBreadcrumbs(router.pathname, t), [router.pathname, t])
  const permissions = extractPermissionList(session?.user)
  const isAuthenticated = sessionStatus === 'authenticated'
  const canViewFeeds = Boolean(
    isAuthenticated &&
      (hasPermission(permissions, PERMISSION_READ_BOOKMARKS) ||
        hasPermission(permissions, PERMISSION_MANAGE_BOOKMARKS)),
  )
  const { data, error, isLoading, mutate } = useSWR(
    canViewFeeds ? ['/v1/feeds'] : null,
    () => v1.listFeedsV1V1FeedsGet({}),
  )
  const { data: siteConfigsData } = useSWR(
    canViewFeeds ? ['/v1/site-configs', 'feeds'] : null,
    () => v1.listSiteConfigsV1V1SiteConfigsGet({ page: 1, size: 200 }),
  )
  const { data: credentialsData } = useSWR(
    canViewFeeds ? ['/v1/credentials', 'feeds'] : null,
    () => v1.listCredentialsV1V1CredentialsGet({ page: 1, size: 200 }),
  )
  const { data: tagsData, mutate: mutateTags } = useSWR(
    canViewFeeds ? ['/v1/bookmarks/tags', 'feeds'] : null,
    () => v1.listTagsBookmarksTagsGet(),
  )
  const { data: foldersData, mutate: mutateFolders } = useSWR(
    canViewFeeds ? ['/v1/bookmarks/folders', 'feeds'] : null,
    () => v1.listFoldersBookmarksFoldersGet(),
  )
  const [url, setUrl] = useState('')
  const [poll, setPoll] = useState('1h')
  const [lookback, setLookback] = useState('')
  const [paywalled, setPaywalled] = useState(false)
  const [rssAuth, setRssAuth] = useState(false)
  const [siteConfigId, setSiteConfigId] = useState('')
  const [siteLoginCredentialId, setSiteLoginCredentialId] = useState('')
  const [siteLoginSelection, setSiteLoginSelection] = useState('')
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([])
  const [selectedFolderId, setSelectedFolderId] = useState('')
  const [banner, setBanner] = useState<{ kind: 'success' | 'error'; message: string } | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editRow, setEditRow] = useState<any | null>(null)
  const siteConfigs = siteConfigsData?.items ?? []
  const siteConfigMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const config of siteConfigs) {
      if (config?.id) {
        map.set(String(config.id), config.name ?? config.id)
      }
    }
    return map
  }, [siteConfigs])

  const loginCredentials = useMemo(
    () => (credentialsData?.items ?? []).filter((cred: Credential) => cred?.kind === 'site_login'),
    [credentialsData],
  )

  const siteLoginOptions: SiteLoginOption[] = useMemo(
    () => buildSiteLoginOptions(loginCredentials, siteConfigs, t('feeds_field_site_config_only')),
    [loginCredentials, siteConfigs, t],
  )

  const tagItems = useMemo(() => {
    if (!tagsData) return [] as TagOut[]
    if (Array.isArray(tagsData)) return tagsData as TagOut[]
    if (Array.isArray((tagsData as any).items)) return (tagsData as any).items as TagOut[]
    return [] as TagOut[]
  }, [tagsData])

  const folderItems = useMemo(() => {
    if (!foldersData) return [] as FolderOut[]
    if (Array.isArray(foldersData)) return foldersData as FolderOut[]
    if (Array.isArray((foldersData as any).items)) return (foldersData as any).items as FolderOut[]
    return [] as FolderOut[]
  }, [foldersData])

  const tagOptions = useMemo(
    () =>
      tagItems
        .map(tag => {
          const id = tag?.id != null ? String(tag.id) : ''
          if (!id) return null
          const rawName = typeof tag?.name === 'string' ? tag.name.trim() : ''
          const label = rawName || id
          return { id, label }
        })
        .filter(Boolean) as { id: string; label: string }[],
    [tagItems],
  )

  const folderOptions = useMemo(
    () =>
      folderItems
        .map(folder => {
          const id = folder?.id != null ? String(folder.id) : ''
          if (!id) return null
          const rawName = typeof folder?.name === 'string' ? folder.name.trim() : ''
          const label = rawName || id
          return { id, label }
        })
        .filter(Boolean) as { id: string; label: string }[],
    [folderItems],
  )

  const getSelectionForFeed = useCallback(
    (configId?: string | null, credentialId?: string | null): string => {
      const normalizedConfig = configId ? String(configId) : ''
      const normalizedCredential = credentialId ? String(credentialId) : ''
      if (normalizedConfig && normalizedCredential) {
        const pairOption = siteLoginOptions.find(
          opt =>
            opt.type === 'pair' &&
            opt.siteConfigId === normalizedConfig &&
            opt.credentialId === normalizedCredential,
        )
        if (pairOption) return pairOption.value
      }
      if (normalizedConfig) {
        const configOption = siteLoginOptions.find(
          opt => opt.type === 'config' && opt.siteConfigId === normalizedConfig,
        )
        if (configOption) return configOption.value
        const fallbackPair = siteLoginOptions.find(opt => opt.siteConfigId === normalizedConfig)
        if (fallbackPair) return fallbackPair.value
      }
      return ''
    },
    [siteLoginOptions],
  )

  useEffect(() => {
    const nextSelection = getSelectionForFeed(siteConfigId, siteLoginCredentialId)
    if (nextSelection !== siteLoginSelection) {
      setSiteLoginSelection(nextSelection)
    }
  }, [getSelectionForFeed, siteConfigId, siteLoginCredentialId, siteLoginSelection])

  useEffect(() => {
    setEditRow((prev: any) => {
      if (!prev) return prev
      const nextSelection = getSelectionForFeed(prev.siteConfigId, prev.siteLoginCredentialId)
      if (nextSelection && nextSelection !== prev.siteLoginSelection) {
        return { ...prev, siteLoginSelection: nextSelection }
      }
      if (!nextSelection && prev.siteLoginSelection) {
        return { ...prev, siteLoginSelection: '' }
      }
      return prev
    })
  }, [getSelectionForFeed, siteLoginOptions])

  const siteConfigLabelMap = useMemo(
    () => buildSiteConfigLabelMap(siteLoginOptions, siteConfigs),
    [siteLoginOptions, siteConfigs],
  )

  const siteLoginPairLabelMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const option of siteLoginOptions) {
      if (option.type === 'pair' && option.credentialId) {
        map.set(`${option.credentialId}::${option.siteConfigId}`, option.label)
      }
    }
    return map
  }, [siteLoginOptions])

  const credentialLabelMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const cred of loginCredentials) {
      if (!cred?.id) continue
      map.set(String(cred.id), cred.description || String(cred.id))
    }
    return map
  }, [loginCredentials])

  const tagLabelMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const option of tagOptions) {
      map.set(option.id, option.label)
    }
    return map
  }, [tagOptions])

  function appendItemToCollection<T extends { id?: string | number }>(
    existing: any,
    item: T,
  ): any {
    if (!item) return existing
    const normalizedId =
      item && item.id != null && item.id !== '' ? String(item.id) : undefined
    const normalizedItem = normalizedId ? { ...item, id: normalizedId } : { ...item }
    if (!existing) {
      return { items: [normalizedItem] }
    }
    if (Array.isArray(existing)) {
      if (
        normalizedId &&
        existing.some((entry: any) => String(entry?.id) === normalizedId)
      ) {
        return existing
      }
      return [...existing, normalizedItem]
    }
    if (Array.isArray(existing.items)) {
      if (
        normalizedId &&
        existing.items.some((entry: any) => String(entry?.id) === normalizedId)
      ) {
        return existing
      }
      return { ...existing, items: [...existing.items, normalizedItem] }
    }
    return existing
  }

  const handleCreateTag = useCallback(
    async (label: string) => {
      const trimmed = label.trim()
      if (!trimmed) return null
      try {
        const created = await v1.createTagBookmarksTagsPost({
          tagCreate: { name: trimmed },
        })
        const createdId = created?.id != null ? String(created.id) : trimmed
        const createdLabel =
          typeof created?.name === 'string' && created.name.trim()
            ? created.name.trim()
            : trimmed
        const option = { id: createdId, label: createdLabel }
        if (mutateTags) {
          void mutateTags(
            (prev: any) =>
              appendItemToCollection(prev, {
                ...(created ?? {}),
                id: createdId,
                name: createdLabel,
              }),
            false,
          )
        }
        return option
      } catch (error: any) {
        setBanner({
          kind: 'error',
          message: error?.message || String(error),
        })
        throw error
      }
    },
    [mutateTags, setBanner],
  )

  const handleCreateFolder = useCallback(
    async (label: string) => {
      const trimmed = label.trim()
      if (!trimmed) return null
      try {
        const created = await v1.createFolderBookmarksFoldersPost({
          folderCreate: { name: trimmed },
        })
        const createdId = created?.id != null ? String(created.id) : trimmed
        const createdLabel =
          typeof created?.name === 'string' && created.name.trim()
            ? created.name.trim()
            : trimmed
        const option = { id: createdId, label: createdLabel }
        if (mutateFolders) {
          void mutateFolders(
            (prev: any) =>
              appendItemToCollection(prev, {
                ...(created ?? {}),
                id: createdId,
                name: createdLabel,
              }),
            false,
          )
        }
        return option
      } catch (error: any) {
        setBanner({
          kind: 'error',
          message: error?.message || String(error),
        })
        throw error
      }
    },
    [mutateFolders, setBanner],
  )

  const folderLabelMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const option of folderOptions) {
      map.set(option.id, option.label)
    }
    return map
  }, [folderOptions])

  async function createFeed() {
    if (!url.trim()) { setBanner({ kind: 'error', message: t('feeds_error_url_required') }); return }
    const requiresSiteLogin = paywalled || rssAuth
    if (requiresSiteLogin && (!siteConfigId || !siteLoginCredentialId)) {
      setBanner({ kind: 'error', message: t('feeds_error_site_login_required') })
      return
    }
    try {
      await feedsApi.createFeedFeedsPost({ feed: {
        url,
        pollFrequency: poll,
        initialLookbackPeriod: lookback || undefined,
        isPaywalled: paywalled,
        rssRequiresAuth: rssAuth,
        siteConfigId: siteConfigId || undefined,
        siteLoginCredentialId: siteLoginCredentialId || undefined,
        tagIds: selectedTagIds.length > 0 ? selectedTagIds : undefined,
        folderId: selectedFolderId || undefined,
      } as any })
      setUrl(''); setLookback(''); setSiteConfigId(''); setSiteLoginCredentialId(''); setSiteLoginSelection(''); setSelectedTagIds([]); setSelectedFolderId(''); setPaywalled(false); setRssAuth(false)
      setBanner({ kind: 'success', message: t('feeds_create_success') })
      mutate()
    } catch (e: any) {
      setBanner({ kind: 'error', message: e?.message || String(e) })
    }
  }

  async function deleteFeed(id: string) {
    if (!confirm(t('feeds_confirm_delete'))) return
    try {
      await feedsApi.deleteFeedFeedsFeedIdDelete({ feedId: id })
      setBanner({ kind: 'success', message: t('feeds_delete_success') })
      mutate()
    } catch (e: any) {
      setBanner({ kind: 'error', message: e?.message || String(e) })
    }
  }

  async function startEdit(f: any) {
    setEditingId(f.id)
    const rawSiteConfigId = f.site_config_id || f.siteConfigId || ''
    const rawCredentialId = f.site_login_credential_id || f.siteLoginCredentialId || ''
    const selection = getSelectionForFeed(rawSiteConfigId, rawCredentialId)
    setEditRow({
      url: f.url || '',
      pollFrequency: f.poll_frequency || f.pollFrequency || '1h',
      initialLookbackPeriod: f.initial_lookback_period || f.initialLookbackPeriod || '',
      isPaywalled: !!(f.is_paywalled ?? f.isPaywalled),
      rssRequiresAuth: !!(f.rss_requires_auth ?? f.rssRequiresAuth),
      siteConfigId: rawSiteConfigId,
      siteLoginCredentialId: rawCredentialId,
      siteLoginSelection: selection,
      tagIds: Array.isArray(f.tag_ids ?? f.tagIds)
        ? (f.tag_ids ?? f.tagIds).map((tag: any) => String(tag))
        : [],
      folderId: f.folder_id != null || f.folderId != null ? String(f.folder_id ?? f.folderId ?? '') : '',
      lastRssPollAt: f.last_rss_poll_at || f.lastRssPollAt || null,
    })
  }

  function cancelEdit() {
    setEditingId(null)
    setEditRow(null)
  }

  async function saveEdit(id: string) {
    try {
      const lookbackLocked = Boolean(editRow?.lastRssPollAt)
      const requiresSiteLogin = Boolean(editRow?.isPaywalled || editRow?.rssRequiresAuth)
      if (requiresSiteLogin && (!editRow?.siteConfigId || !editRow?.siteLoginCredentialId)) {
        setBanner({ kind: 'error', message: t('feeds_error_site_login_required') })
        return
      }
      const payload: any = {
        url: editRow.url,
        pollFrequency: editRow.pollFrequency,
        isPaywalled: !!editRow.isPaywalled,
        rssRequiresAuth: !!editRow.rssRequiresAuth,
        siteConfigId: editRow.siteConfigId || undefined,
        siteLoginCredentialId: editRow.siteLoginCredentialId || undefined,
        tagIds: Array.isArray(editRow.tagIds) && editRow.tagIds.length > 0 ? editRow.tagIds : undefined,
        folderId: editRow.folderId ? editRow.folderId : undefined,
      }
      if (!lookbackLocked) {
        payload.initialLookbackPeriod = editRow.initialLookbackPeriod ?? ''
      }
      await feedsApi.updateFeedFeedsFeedIdPut({
        feedId: id,
        feed: payload,
      })
      setBanner({ kind: 'success', message: t('feeds_update_success') })
      setEditingId(null)
      setEditRow(null)
      mutate()
    } catch (e: any) {
      setBanner({ kind: 'error', message: e?.message || String(e) })
    }
  }

  if (sessionStatus === 'loading') {
    return (
      <div>
        <Nav />
        <main className="container py-12">
          <p className="text-gray-700 dark:text-gray-300">{t('loading_text')}</p>
        </main>
      </div>
    )
  }

  const renderAccessMessage = (title: string, message: string) => (
    <div>
      <Nav />
      <main className="container py-12">
        <div className="max-w-xl space-y-2">
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">{title}</h1>
          <p className="text-gray-700 dark:text-gray-300">{message}</p>
        </div>
      </main>
    </div>
  )

  if (sessionStatus === 'unauthenticated') {
    return renderAccessMessage(t('access_sign_in_title'), t('access_sign_in_message'))
  }

  if (!canViewFeeds) {
    return renderAccessMessage(t('access_denied_title'), t('access_denied_message'))
  }

  return (
    <div>
      <Nav />
      <Breadcrumbs items={breadcrumbs} />
      <main className="container py-6">
        <h2 id="feeds-heading" className="text-xl font-semibold mb-3">{t('feeds_title')}</h2>
        {banner && <div className="mb-3"><Alert kind={banner.kind} message={banner.message} onClose={() => setBanner(null)} /></div>}
        <ConfigEditorPanel
          id="create-feed"
          aria-labelledby="create-feed-heading"
          title={<span id="create-feed-heading">{t('feeds_create_heading')}</span>}
          role="form"
          onSubmit={(e) => {
            e.preventDefault()
            createFeed()
          }}
          submitLabel={t('btn_create')}
          contentClassName="md:grid-cols-4"
        >
          <label className="sr-only" htmlFor="create-feed-url">
            {t('feeds_field_url_placeholder')}
          </label>
          <input
            id="create-feed-url"
            className="input md:col-span-2"
            placeholder={t('feeds_field_url_placeholder')}
            aria-label={t('feeds_field_url_placeholder')}
            value={url}
            onChange={e => setUrl(e.target.value)}
            data-config-editor-initial-focus
          />
          <label className="sr-only" htmlFor="create-feed-poll">
            {t('feeds_field_poll_placeholder')}
          </label>
          <input
            id="create-feed-poll"
            className="input"
            placeholder={t('feeds_field_poll_placeholder')}
            aria-label={t('feeds_field_poll_placeholder')}
            value={poll}
            onChange={e => setPoll(e.target.value)}
          />
          <label className="sr-only" htmlFor="create-feed-lookback">
            {t('feeds_field_lookback_placeholder')}
          </label>
          <input
            id="create-feed-lookback"
            className="input"
            placeholder={t('feeds_field_lookback_placeholder')}
            aria-label={t('feeds_field_lookback_placeholder')}
            value={lookback}
            onChange={e => setLookback(e.target.value)}
          />
          <label className="sr-only" htmlFor="create-feed-site-config">
            {t('feeds_field_site_login_select')}
          </label>
          <select
            id="create-feed-site-config"
            className="input md:col-span-2"
            aria-label={t('feeds_field_site_login_select')}
            aria-required={paywalled || rssAuth}
            value={siteLoginSelection}
            onChange={e => {
              const value = e.target.value
              setSiteLoginSelection(value)
              if (!value) {
                setSiteConfigId('')
                setSiteLoginCredentialId('')
                return
              }
              const option = siteLoginOptions.find(opt => opt.value === value)
              setSiteConfigId(option?.siteConfigId ?? '')
              setSiteLoginCredentialId(option?.credentialId ?? '')
            }}
          >
            <option value="">{t('feeds_field_site_login_select')}</option>
            {siteLoginOptions.map(option => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <div className="md:col-span-4">
            <AutocompleteMultiSelect
              id="create-feed-tags"
              label={t('feeds_field_tags_label')}
              placeholder={t('feeds_field_tags_placeholder')}
              options={tagOptions}
              value={selectedTagIds}
              onChange={setSelectedTagIds}
              noOptionsLabel={t('combobox_no_options')}
              helpText={t('feeds_field_tags_help')}
              getRemoveLabel={(option) => t('combobox_remove_option', { option: option.label })}
              onCreate={handleCreateTag}
              createOptionLabel={(option) => t('combobox_create_option', { option })}
            />
          </div>
          <div className="md:col-span-4">
            <AutocompleteSingleSelect
              id="create-feed-folder"
              label={t('feeds_field_folder_label')}
              placeholder={t('feeds_field_folder_placeholder')}
              options={folderOptions}
              value={selectedFolderId ? selectedFolderId : null}
              onChange={(next) => setSelectedFolderId(next ?? '')}
              noOptionsLabel={t('combobox_no_options')}
              helpText={t('feeds_field_folder_help')}
              clearLabel={t('combobox_clear_selection')}
              onCreate={handleCreateFolder}
              createOptionLabel={(option) => t('combobox_create_option', { option })}
            />
          </div>
          <label className="inline-flex items-center gap-2 md:col-span-2">
            <input
              type="checkbox"
              checked={paywalled}
              onChange={e => setPaywalled(e.target.checked)}
            />{' '}
            {t('feeds_field_paywalled_label')}
          </label>
          <label className="inline-flex items-center gap-2 md:col-span-2">
            <input
              type="checkbox"
              checked={rssAuth}
              onChange={e => setRssAuth(e.target.checked)}
            />{' '}
            {t('feeds_field_rss_auth_label')}
          </label>
        </ConfigEditorPanel>
        {isLoading && <p className="text-gray-600">{t('loading_text')}</p>}
        {error && <Alert kind="error" message={String(error)} />}
        {data && (
          <div className="card p-0 overflow-hidden">
            {(!data.items && !Array.isArray(data)) || (Array.isArray(data) ? data.length === 0 : (data.items?.length ?? 0) === 0) ? (
              <div className="p-4">
                <EmptyState
                  icon={<span>📰</span>}
                  message={(
                    <div className="space-y-1">
                      <p className="text-lg font-semibold text-gray-700 dark:text-gray-200">{t('empty_feeds_title')}</p>
                      <p>{t('empty_feeds_desc')}</p>
                    </div>
                  )}
                />
              </div>
            ) : (
            <table className="table" role="table" aria-label={t('feeds_table_label')}>
              <thead className="bg-gray-100 dark:bg-gray-800">
                <tr>
                  <th className="th">{t('url_label')}</th>
                  <th className="th">{t('poll_label')}</th>
                  <th className="th">{t('paywalled_label')}</th>
                  <th className="th">{t('rss_auth_label')}</th>
                  <th className="th">{t('feeds_table_tags_label')}</th>
                  <th className="th">{t('feeds_table_folder_label')}</th>
                  <th className="th">{t('site_config_label')}</th>
                  <th className="th">{t('actions_label')}</th>
                </tr>
              </thead>
              <tbody>
                {(data.items || data).map((f: any) => (
                  <tr key={f.id} className="odd:bg-white even:bg-gray-50 dark:odd:bg-gray-800 dark:even:bg-gray-900">
                    <>
                      <td className="td">{f.url}</td>
                      <td className="td">{f.poll_frequency || f.pollFrequency}</td>
                      <td className="td">{t((f.is_paywalled ?? f.isPaywalled) ? 'boolean_yes' : 'boolean_no')}</td>
                      <td className="td">{t((f.rss_requires_auth ?? f.rssRequiresAuth) ? 'boolean_yes' : 'boolean_no')}</td>
                      <td className="td">
                        {(() => {
                          const rawTags = Array.isArray(f.tag_ids ?? f.tagIds) ? (f.tag_ids ?? f.tagIds) : []
                          if (!rawTags.length) return ''
                          return rawTags
                            .map((tagId: any) => {
                              const normalized = tagId != null ? String(tagId) : ''
                              return normalized ? tagLabelMap.get(normalized) || normalized : ''
                            })
                            .filter(Boolean)
                            .join(', ')
                        })()}
                      </td>
                      <td className="td">
                        {(() => {
                          const folderValue = f.folder_id ?? f.folderId
                          if (!folderValue) return ''
                          const normalized = String(folderValue)
                          return folderLabelMap.get(normalized) || normalized
                        })()}
                      </td>
                      <td className="td">{
                        (() => {
                          const id = f.site_config_id || f.siteConfigId
                          const credentialId = f.site_login_credential_id || f.siteLoginCredentialId
                          if (!id) return ''
                          const key = String(id)
                          if (credentialId) {
                            const pairKey = `${credentialId}::${key}`
                            const pairLabel = siteLoginPairLabelMap.get(pairKey)
                            if (pairLabel) return pairLabel
                            const credLabel = credentialLabelMap.get(String(credentialId)) || String(credentialId)
                            const configLabel = siteConfigLabelMap.get(key) || siteConfigMap.get(key) || key
                            return `${credLabel} • ${configLabel}`
                          }
                          return siteConfigLabelMap.get(key) || siteConfigMap.get(key) || key
                        })()}
                      </td>
                      <td className="td">
                        <div
                          className="flex flex-wrap gap-2 sm:flex-nowrap"
                          role="group"
                          aria-label={t('actions_label')}
                        >
                          <button type="button" className="btn" onClick={() => startEdit(f)}>{t('btn_edit')}</button>
                          <button type="button" className="btn" onClick={() => deleteFeed(f.id)}>{t('btn_delete')}</button>
                        </div>
                      </td>
                    </>
                  </tr>
                ))}
              </tbody>
            </table>
            )}
          </div>
        )}
        {editingId && editRow ? (
          <ConfigEditorPanel
            id="edit-feed"
            aria-labelledby="edit-feed-heading"
            title={<span id="edit-feed-heading">{t('feeds_edit_heading')}</span>}
            role="form"
            onSubmit={(e) => {
              e.preventDefault()
              if (editingId) {
                void saveEdit(editingId)
              }
            }}
            submitLabel={t('btn_save')}
            cancelLabel={t('btn_cancel')}
            onCancel={cancelEdit}
            autoFocus
            contentClassName="md:grid-cols-4"
          >
            <label className="sr-only" htmlFor="edit-feed-url">
              {t('feeds_field_url_placeholder')}
            </label>
            <input
              id="edit-feed-url"
              className="input md:col-span-2"
              value={editRow.url || ''}
              onChange={e => setEditRow({ ...editRow, url: e.target.value })}
              aria-label={t('feeds_field_url_placeholder')}
              data-config-editor-initial-focus
            />
            <label className="sr-only" htmlFor="edit-feed-poll">
              {t('feeds_field_poll_placeholder')}
            </label>
            <input
              id="edit-feed-poll"
              className="input"
              value={editRow.pollFrequency || ''}
              onChange={e => setEditRow({ ...editRow, pollFrequency: e.target.value })}
              aria-label={t('feeds_field_poll_placeholder')}
            />
            <div className="md:col-span-1">
              <label className="sr-only" htmlFor="edit-feed-lookback">
                {t('feeds_field_lookback_placeholder')}
              </label>
              <input
                id="edit-feed-lookback"
                className="input"
                value={editRow.initialLookbackPeriod || ''}
                onChange={e => setEditRow({ ...editRow, initialLookbackPeriod: e.target.value })}
                aria-label={t('feeds_field_lookback_placeholder')}
                disabled={Boolean(editRow.lastRssPollAt)}
                aria-disabled={Boolean(editRow.lastRssPollAt)}
              />
              {Boolean(editRow.lastRssPollAt) && (
                <p className="text-xs text-gray-600 mt-1">{t('feeds_field_lookback_locked_hint')}</p>
              )}
            </div>
            <label className="inline-flex items-center gap-2 md:col-span-2">
              <input
                type="checkbox"
                checked={Boolean(editRow.isPaywalled)}
                onChange={e => setEditRow({ ...editRow, isPaywalled: e.target.checked })}
              />{' '}
              {t('feeds_field_paywalled_label')}
            </label>
            <label className="inline-flex items-center gap-2 md:col-span-2">
              <input
                type="checkbox"
                checked={Boolean(editRow.rssRequiresAuth)}
                onChange={e => setEditRow({ ...editRow, rssRequiresAuth: e.target.checked })}
              />{' '}
              {t('feeds_field_rss_auth_label')}
            </label>
            <div className="md:col-span-4">
              <AutocompleteMultiSelect
                id="edit-feed-tags"
                label={t('feeds_field_tags_label')}
                placeholder={t('feeds_field_tags_placeholder')}
                options={tagOptions}
                value={Array.isArray(editRow.tagIds) ? editRow.tagIds : []}
                onChange={(next) => setEditRow({ ...editRow, tagIds: next })}
                noOptionsLabel={t('combobox_no_options')}
                helpText={t('feeds_field_tags_help')}
                getRemoveLabel={(option) => t('combobox_remove_option', { option: option.label })}
                onCreate={handleCreateTag}
                createOptionLabel={(option) => t('combobox_create_option', { option })}
              />
            </div>
            <div className="md:col-span-4">
              <AutocompleteSingleSelect
                id="edit-feed-folder"
                label={t('feeds_field_folder_label')}
                placeholder={t('feeds_field_folder_placeholder')}
                options={folderOptions}
                value={editRow.folderId ? editRow.folderId : null}
                onChange={(next) => setEditRow({ ...editRow, folderId: next ?? '' })}
                noOptionsLabel={t('combobox_no_options')}
                helpText={t('feeds_field_folder_help')}
                clearLabel={t('combobox_clear_selection')}
                onCreate={handleCreateFolder}
                createOptionLabel={(option) => t('combobox_create_option', { option })}
              />
            </div>
            <label className="sr-only" htmlFor="edit-feed-site-config">
              {t('feeds_field_site_login_select')}
            </label>
            <select
              id="edit-feed-site-config"
              className="input md:col-span-2"
              value={editRow.siteLoginSelection || ''}
              aria-required={Boolean(editRow.isPaywalled || editRow.rssRequiresAuth)}
              onChange={e => {
                const value = e.target.value
                const option = siteLoginOptions.find(opt => opt.value === value)
                setEditRow({
                  ...editRow,
                  siteLoginSelection: value,
                  siteConfigId: option?.siteConfigId ?? '',
                  siteLoginCredentialId: option?.credentialId ?? '',
                })
              }}
              aria-label={t('feeds_field_site_login_select')}
            >
              <option value="">{t('feeds_field_site_login_select')}</option>
              {siteLoginOptions.map(option => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </ConfigEditorPanel>
        ) : null}
      </main>
    </div>
  )
}
