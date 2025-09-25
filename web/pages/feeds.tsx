import useSWR from 'swr'
import { Alert, Breadcrumbs, EmptyState, Nav } from '../components'
import { v1, feeds as feedsApi } from '../lib/openapi'
import { useMemo, useState } from 'react'
import { useI18n } from '../lib/i18n'
import { buildBreadcrumbs } from '../lib/breadcrumbs'
import { useRouter } from 'next/router'
import { useSession } from 'next-auth/react'
import { extractPermissionList, hasPermission, PERMISSION_MANAGE_BOOKMARKS, PERMISSION_READ_BOOKMARKS } from '../lib/rbac'

export default function Feeds() {
  const { t } = useI18n()
  const router = useRouter()
  const { data: session, status: sessionStatus } = useSession()
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
  const [url, setUrl] = useState('')
  const [poll, setPoll] = useState('1h')
  const [lookback, setLookback] = useState('')
  const [paywalled, setPaywalled] = useState(false)
  const [rssAuth, setRssAuth] = useState(false)
  const [siteConfigId, setSiteConfigId] = useState('')
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

  async function createFeed() {
    if (!url.trim()) { setBanner({ kind: 'error', message: t('feeds_error_url_required') }); return }
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
        <form
          id="create-feed"
          className="card p-4 mb-4 grid grid-cols-1 md:grid-cols-3 gap-2"
          role="form"
          aria-labelledby="create-feed-heading"
          onSubmit={(e) => { e.preventDefault(); createFeed() }}
        >
          <h3 id="create-feed-heading" className="font-semibold md:col-span-3">{t('feeds_create_heading')}</h3>
          <label className="sr-only" htmlFor="create-feed-url">{t('feeds_field_url_placeholder')}</label>
          <input
            id="create-feed-url"
            className="input md:col-span-2"
            placeholder={t('feeds_field_url_placeholder')}
            aria-label={t('feeds_field_url_placeholder')}
            value={url}
            onChange={e => setUrl(e.target.value)}
          />
          <label className="sr-only" htmlFor="create-feed-poll">{t('feeds_field_poll_placeholder')}</label>
          <input
            id="create-feed-poll"
            className="input"
            placeholder={t('feeds_field_poll_placeholder')}
            aria-label={t('feeds_field_poll_placeholder')}
            value={poll}
            onChange={e => setPoll(e.target.value)}
          />
          <label className="sr-only" htmlFor="create-feed-lookback">{t('feeds_field_lookback_placeholder')}</label>
          <input
            id="create-feed-lookback"
            className="input"
            placeholder={t('feeds_field_lookback_placeholder')}
            aria-label={t('feeds_field_lookback_placeholder')}
            value={lookback}
            onChange={e => setLookback(e.target.value)}
          />
          <label className="sr-only" htmlFor="create-feed-site-config">{t('feeds_field_site_config_select')}</label>
          <select
            id="create-feed-site-config"
            className="input"
            aria-label={t('feeds_field_site_config_select')}
            value={siteConfigId}
            onChange={e => setSiteConfigId(e.target.value)}
          >
            <option value="">{t('feeds_field_site_config_select')}</option>
            {siteConfigs.map((config: any) => (
              <option key={config.id} value={config.id}>
                {config.name}
              </option>
            ))}
          </select>
          <label className="inline-flex items-center gap-2"><input type="checkbox" checked={paywalled} onChange={e => setPaywalled(e.target.checked)} /> {t('feeds_field_paywalled_label')}</label>
          <label className="inline-flex items-center gap-2"><input type="checkbox" checked={rssAuth} onChange={e => setRssAuth(e.target.checked)} /> {t('feeds_field_rss_auth_label')}</label>
          <button type="submit" className="btn">{t('btn_create')}</button>
        </form>
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
                      <p className="text-lg font-semibold text-gray-700">{t('empty_feeds_title')}</p>
                      <p>{t('empty_feeds_desc')}</p>
                    </div>
                  )}
                />
              </div>
            ) : (
            <table className="table" role="table" aria-label={t('feeds_table_label')}>
              <thead className="bg-gray-100">
                <tr>
                  <th className="th">{t('url_label')}</th>
                  <th className="th">{t('poll_label')}</th>
                  <th className="th">{t('lookback_label')}</th>
                  <th className="th">{t('paywalled_label')}</th>
                  <th className="th">{t('rss_auth_label')}</th>
                  <th className="th">{t('site_config_label')}</th>
                  <th className="th">{t('actions_label')}</th>
                </tr>
              </thead>
              <tbody>
                {(data.items || data).map((f: any) => (
                  <tr key={f.id} className="odd:bg-white even:bg-gray-50">
                    {editingId === f.id ? (
                      <>
                        <td className="td"><input className="input w-full" value={editRow.url} onChange={e => setEditRow({ ...editRow, url: e.target.value })} placeholder={t('feeds_field_url_placeholder')} aria-label={t('feeds_field_url_placeholder')} /></td>
                        <td className="td"><input className="input w-full" value={editRow.pollFrequency} onChange={e => setEditRow({ ...editRow, pollFrequency: e.target.value })} placeholder={t('feeds_field_poll_placeholder')} aria-label={t('feeds_field_poll_placeholder')} /></td>
                        <td className="td"><input className="input w-full" value={editRow.initialLookbackPeriod} onChange={e => setEditRow({ ...editRow, initialLookbackPeriod: e.target.value })} placeholder={t('feeds_field_lookback_placeholder')} aria-label={t('feeds_field_lookback_placeholder')} /></td>
                        <td className="td"><input type="checkbox" aria-label={t('feeds_field_paywalled_label')} checked={editRow.isPaywalled} onChange={e => setEditRow({ ...editRow, isPaywalled: e.target.checked })} /></td>
                        <td className="td"><input type="checkbox" aria-label={t('feeds_field_rss_auth_label')} checked={editRow.rssRequiresAuth} onChange={e => setEditRow({ ...editRow, rssRequiresAuth: e.target.checked })} /></td>
                        <td className="td">
                          <select
                            className="input w-full"
                            value={editRow.siteConfigId}
                            onChange={e => setEditRow({ ...editRow, siteConfigId: e.target.value })}
                            aria-label={t('feeds_field_site_config_select')}
                          >
                            <option value="">{t('feeds_field_site_config_select')}</option>
                            {siteConfigs.map((config: any) => (
                              <option key={config.id} value={config.id}>
                                {config.name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="td flex gap-2">
                          <button type="button" className="btn" onClick={() => saveEdit(f.id)}>{t('btn_save')}</button>
                          <button type="button" className="btn" onClick={cancelEdit}>{t('btn_cancel')}</button>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="td">{f.url}</td>
                        <td className="td">{f.poll_frequency || f.pollFrequency}</td>
                        <td className="td">{f.initial_lookback_period || f.initialLookbackPeriod || ''}</td>
                        <td className="td">{t((f.is_paywalled ?? f.isPaywalled) ? 'boolean_yes' : 'boolean_no')}</td>
                        <td className="td">{t((f.rss_requires_auth ?? f.rssRequiresAuth) ? 'boolean_yes' : 'boolean_no')}</td>
                        <td className="td">{
                          (() => {
                            const id = f.site_config_id || f.siteConfigId
                            if (!id) return ''
                            return siteConfigMap.get(String(id)) || id
                          })()
                        }</td>
                        <td className="td flex gap-2">
                          <button type="button" className="btn" onClick={() => startEdit(f)}>{t('btn_edit')}</button>
                          <button type="button" className="btn" onClick={() => deleteFeed(f.id)}>{t('btn_delete')}</button>
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            )}
          </div>
        )}
      </main>
    </div>
  )
}
