import useSWR from 'swr'
import Nav from '../components/Nav'
import { v1 } from '../lib/openapi'
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import Alert from '../components/Alert'
import { useI18n } from '../lib/i18n'
import EmptyState from '../components/EmptyState'
import Modal from '../components/Modal'
import Link from 'next/link'

type RegexTarget = 'both' | 'title' | 'url'
type SortOption = 'title' | 'url' | 'published_at' | 'relevance'
type SavedView = {
  name: string
  search?: string
  feed_id?: string
  since?: string
  until?: string
  fuzzy?: boolean
  title_query?: string
  url_query?: string
  regex?: string
  regex_target?: RegexTarget
  regex_case_insensitive?: boolean
  sort_by?: SortOption
  sort_dir?: 'asc' | 'desc'
}

export default function Bookmarks() {
  const { t } = useI18n()
  const [page, setPage] = useState(1)
  const [keyword, setKeyword] = useState('')
  const [titleQuery, setTitleQuery] = useState('')
  const [urlQuery, setUrlQuery] = useState('')
  const [regexPattern, setRegexPattern] = useState('')
  const [regexTarget, setRegexTarget] = useState<RegexTarget>('both')
  const [regexCaseInsensitive, setRegexCaseInsensitive] = useState(true)
  const [views, setViews] = useState<SavedView[]>([])
  const [newViewName, setNewViewName] = useState('')
  const [feedId, setFeedId] = useState('')
  const [since, setSince] = useState('')
  const [until, setUntil] = useState('')
  const [sortBy, setSortBy] = useState<SortOption>('published_at')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [banner, setBanner] = useState<{ kind: 'success' | 'error'; message: string } | null>(null)
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [showPublishModal, setShowPublishModal] = useState(false)
  const [showProgressModal, setShowProgressModal] = useState(false)
  const [configDir, setConfigDir] = useState('./config')
  const [instapaperId, setInstapaperId] = useState('')
  const [folder, setFolder] = useState('')
  const [tagsInput, setTagsInput] = useState('')
  const [publishError, setPublishError] = useState<string | null>(null)
  const [publishJobs, setPublishJobs] = useState<string[]>([])
  const [publishMeta, setPublishMeta] = useState<{ missing: string[]; skipped: { id: string; reason: string }[] } | null>(null)
  const selectedIds = useMemo(() => Object.entries(selected).filter(([, checked]) => checked).map(([id]) => id), [selected])
  const hasSelection = selectedIds.length > 0
  const selectedCount = selectedIds.length
  const publishConfigRef = useRef<HTMLInputElement | null>(null)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  function addZ(v?: string) { if (!v) return undefined; return v.endsWith('Z') ? v : v + ':00Z' }
  const { data, error, isLoading, mutate } = useSWR([
    `/v1/bookmarks`,
    page,
    keyword,
    titleQuery,
    urlQuery,
    regexPattern,
    regexTarget,
    regexCaseInsensitive,
    feedId,
    since,
    until,
    sortBy,
    sortDir,
  ],
    ([, p, kw, tQuery, uQuery, regexValue, target, regexCI, f, s, u, sb, sd]) => v1.listBookmarksV1BookmarksGet({
      page: p,
      search: kw || undefined,
      titleQuery: tQuery || undefined,
      urlQuery: uQuery || undefined,
      regex: regexValue || undefined,
      regexTarget: target,
      regexFlags: regexValue ? (regexCI ? 'i' : '') : undefined,
      feedId: f || undefined,
      since: addZ(s),
      until: addZ(u),
      fuzzy: sb === 'relevance',
      sortBy: sb,
      sortDir: sb === 'relevance' ? undefined : sd,
    }))
  const { data: feeds } = useSWR([`/v1/feeds`], () => v1.listFeedsV1V1FeedsGet({}))
  const feedItems = Array.isArray(feeds) ? feeds : feeds?.items ?? []
  const { data: instapaperCreds } = useSWR(showPublishModal ? ['/v1/credentials', 'instapaper'] : null, () => v1.listCredentialsV1V1CredentialsGet({ kind: 'instapaper', includeGlobal: true, size: 100 }))
  const instapaperItems = instapaperCreds?.items ?? []
  const { data: publishStatus } = useSWR(
    showProgressModal && publishJobs.length ? ['/v1/jobs/bulk-progress', publishJobs.join(',')] : null,
    () => Promise.all(publishJobs.map(jobId => v1.getJobV1JobsJobIdGet({ jobId }))),
    {
      refreshInterval: (latest: any[] | undefined) => {
        if (!publishJobs.length) return 0
        if (!latest) return 2000
        const allDone = latest.every((job) => ['done', 'failed', 'dead'].includes(job.status))
        return allDone ? 0 : 2000
      },
    }
  )
  const progressJobs = publishStatus ?? []
  const totalJobs = publishJobs.length
  const doneCount = progressJobs.filter((job: any) => job.status === 'done').length
  const failedCount = progressJobs.filter((job: any) => job.status === 'failed' || job.status === 'dead').length
  const waitingForData = totalJobs > 0 && !publishStatus
  const jobList = progressJobs.length ? progressJobs : publishJobs.map(id => ({ id, status: waitingForData ? 'queued' : 'queued' }))
  function clearFilters() {
    setKeyword('')
    setTitleQuery('')
    setUrlQuery('')
    setRegexPattern('')
    setRegexTarget('both')
    setRegexCaseInsensitive(true)
    setFeedId('')
    setSince('')
    setUntil('')
    setSortBy('published_at')
    setSortDir('desc')
    setPage(1)
    mutate()
  }

  useEffect(() => {
    const raw = localStorage.getItem('bookmarkViews')
    if (raw) setViews(JSON.parse(raw))
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const raw = localStorage.getItem('bookmarkPublishDefaults')
      if (!raw) return
      const parsed = JSON.parse(raw)
      if (parsed.configDir) setConfigDir(parsed.configDir)
      if (parsed.instapaperId) setInstapaperId(parsed.instapaperId)
      if (typeof parsed.folder === 'string') setFolder(parsed.folder)
      if (typeof parsed.tags === 'string') setTagsInput(parsed.tags)
    } catch {}
  }, [])

  useEffect(() => {
    if (!showPublishModal) return
    if (instapaperId) return
    if (instapaperItems.length) {
      const firstId = instapaperItems[0]?.id
      if (firstId) setInstapaperId(firstId)
    }
  }, [showPublishModal, instapaperItems, instapaperId])

  useEffect(() => {
    if (titleQuery || urlQuery || regexPattern) {
      setAdvancedOpen(true)
    } else {
      setAdvancedOpen(false)
    }
  }, [titleQuery, urlQuery, regexPattern])

  function saveView() {
    const trimmed = newViewName.trim()
    if (!trimmed) return
    const payload: SavedView = {
      name: trimmed,
      search: keyword || undefined,
      feed_id: feedId || undefined,
      since: since || undefined,
      until: until || undefined,
      fuzzy: sortBy === 'relevance',
      title_query: titleQuery || undefined,
      url_query: urlQuery || undefined,
      regex: regexPattern || undefined,
      regex_target: regexPattern ? regexTarget : undefined,
      regex_case_insensitive: regexPattern ? regexCaseInsensitive : undefined,
      sort_by: sortBy,
      sort_dir: sortDir,
    }
    const updated = [...views.filter(v => v.name !== trimmed), payload]
    setViews(updated)
    localStorage.setItem('bookmarkViews', JSON.stringify(updated))
    setNewViewName('')
  }

  function applyView(v: SavedView) {
    setKeyword(v.search || '')
    setTitleQuery(v.title_query || '')
    setUrlQuery(v.url_query || '')
    setRegexPattern(v.regex || '')
    setRegexTarget(v.regex_target || 'both')
    setRegexCaseInsensitive(v.regex_case_insensitive !== false)
    setFeedId(v.feed_id || '')
    setSince(v.since || '')
    setUntil(v.until || '')
    if (v.sort_by) {
      setSortBy(v.sort_by)
    } else if (v.fuzzy) {
      setSortBy('relevance')
    } else {
      setSortBy('published_at')
    }
    setSortDir(v.sort_dir || 'desc')
    setPage(1)
    mutate()
  }

  function toggleOne(id: string, checked: boolean) {
    setSelected(prev => ({ ...prev, [id]: checked }))
  }
  function toggleAll(checked: boolean) {
    const next: Record<string, boolean> = {}
    for (const b of data?.items ?? []) next[b.id] = checked
    setSelected(next)
  }
  async function bulkDelete() {
    const ids = selectedIds
    if (!ids.length) return
    if (!confirm(t('bookmarks_confirm_delete', { count: ids.length }))) return
    try {
      await v1.bulkDeleteBookmarksV1BookmarksBulkDeletePost({ requestBody: { ids, delete_remote: true } })
      setBanner({ kind: 'success', message: t('bookmarks_deleted_success', { count: ids.length }) })
      setSelected({})
      mutate()
    } catch (e: any) {
      setBanner({ kind: 'error', message: t('bookmarks_delete_failed', { reason: e?.message || String(e) }) })
    }
  }
  function exportSelected(fmt: 'json' | 'csv') {
    const items = (data?.items ?? []).filter((b: any) => selectedIds.includes(b.id))
    if (!items.length) return
    if (fmt === 'json') {
      const blob = new Blob([JSON.stringify(items, null, 2)], { type: 'application/json' })
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'bookmarks.json'; a.click()
    } else {
      const headers = ['id','instapaper_bookmark_id','title','url','content_location','feed_id','published_at']
      const rows = [headers.join(',')].concat(items.map((b: any) => headers.map(h => JSON.stringify(b[h] ?? '')).join(',')))
      const blob = new Blob([rows.join('\n')], { type: 'text/csv' })
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'bookmarks.csv'; a.click()
    }
  }

  async function startPublish(e: FormEvent) {
    e.preventDefault()
    if (!selectedIds.length) {
      setPublishError(t('bookmarks_publish_no_selection'))
      return
    }
    if (!instapaperId) {
      setPublishError(t('bookmarks_publish_missing_instapaper'))
      return
    }
    try {
      const tags = tagsInput.split(',').map(tag => tag.trim()).filter(Boolean)
      const payload: Record<string, any> = {
        ids: selectedIds,
        config_dir: configDir,
        instapaper_id: instapaperId,
      }
      const folderTrimmed = folder.trim()
      if (folderTrimmed) payload.folder = folderTrimmed
      if (tags.length) payload.tags = tags
      const response = await v1.bulkPublishBookmarksV1BookmarksBulkPublishPost({ requestBody: payload })
      const jobIds: string[] = response?.job_ids ?? response?.jobIds ?? []
      const missing: string[] = response?.missing ?? []
      const skipped: { id: string; reason: string }[] = response?.skipped ?? []
      setShowPublishModal(false)
      setPublishJobs(jobIds)
      setPublishMeta({ missing, skipped })
      setShowProgressModal(true)
      setPublishError(null)
      setSelected({})
      if (typeof window !== 'undefined') {
        localStorage.setItem('bookmarkPublishDefaults', JSON.stringify({ configDir, instapaperId, folder, tags: tagsInput }))
      }
      setBanner({ kind: 'success', message: t('bookmarks_publish_enqueued', { count: response?.enqueued ?? jobIds.length }) })
    } catch (err: any) {
      const detail = err?.body?.detail || err?.message || String(err)
      setPublishError(detail)
    }
  }
  return (
    <div>
      <Nav />
      <main className="container py-6">
        <div className="flex items-center gap-2 mb-3">
          <h2 className="text-xl font-semibold">{t('bookmarks_title')}</h2>
        </div>
        <form
          className="card p-4 mb-4 space-y-4"
          onSubmit={(e: FormEvent) => { e.preventDefault(); setPage(1); mutate() }}
        >
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <label className="flex flex-col gap-1" htmlFor="bookmark-keyword">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-200">{t('bookmarks_keyword_label')}</span>
              <input
                id="bookmark-keyword"
                className="input"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder={t('bookmarks_keyword_placeholder')}
              />
            </label>
            <label className="flex flex-col gap-1" htmlFor="bookmark-feed">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-200">{t('bookmarks_feed_label')}</span>
              <select id="bookmark-feed" className="input" value={feedId} onChange={(e) => setFeedId(e.target.value)}>
                <option value="">{t('bookmarks_feed_all')}</option>
                {feedItems.map((f: any) => (
                  <option key={f.id} value={f.id}>{f.url}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1" htmlFor="bookmark-since">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-200">{t('bookmarks_since_label')}</span>
              <input id="bookmark-since" className="input" type="datetime-local" value={since} onChange={(e) => setSince(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1" htmlFor="bookmark-until">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-200">{t('bookmarks_until_label')}</span>
              <input id="bookmark-until" className="input" type="datetime-local" value={until} onChange={(e) => setUntil(e.target.value)} />
            </label>
          </div>
          <details
            className="rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 p-3"
            open={advancedOpen}
            onToggle={(event) => setAdvancedOpen((event.target as HTMLDetailsElement).open)}
          >
            <summary className="cursor-pointer text-sm font-semibold text-gray-700 dark:text-gray-200">{t('bookmarks_advanced')}</summary>
            <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
              <label className="flex flex-col gap-1" htmlFor="bookmark-title-query">
                <span className="text-sm font-medium text-gray-700 dark:text-gray-200">{t('bookmarks_title_contains')}</span>
                <input id="bookmark-title-query" className="input" value={titleQuery} onChange={(e) => setTitleQuery(e.target.value)} placeholder={t('bookmarks_title_placeholder')} />
              </label>
              <label className="flex flex-col gap-1" htmlFor="bookmark-url-query">
                <span className="text-sm font-medium text-gray-700 dark:text-gray-200">{t('bookmarks_url_contains')}</span>
                <input id="bookmark-url-query" className="input" value={urlQuery} onChange={(e) => setUrlQuery(e.target.value)} placeholder={t('bookmarks_url_placeholder')} />
              </label>
              <div className="flex flex-col gap-2">
                <label className="flex flex-col gap-1" htmlFor="bookmark-regex">
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-200">{t('bookmarks_regex_label')}</span>
                  <input id="bookmark-regex" className="input" value={regexPattern} onChange={(e) => setRegexPattern(e.target.value)} placeholder={t('bookmarks_regex_placeholder')} />
                </label>
                <div className="flex flex-wrap items-center gap-3">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-200" htmlFor="bookmark-regex-target">
                    {t('bookmarks_regex_target')}
                  </label>
                  <select id="bookmark-regex-target" className="input" value={regexTarget} onChange={(e) => setRegexTarget(e.target.value as RegexTarget)}>
                    <option value="both">{t('bookmarks_regex_target_both')}</option>
                    <option value="title">{t('bookmarks_regex_target_title')}</option>
                    <option value="url">{t('bookmarks_regex_target_url')}</option>
                  </select>
                  <label className="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
                    <input type="checkbox" checked={regexCaseInsensitive} onChange={(e) => setRegexCaseInsensitive(e.target.checked)} />
                    <span>{t('bookmarks_regex_case_insensitive')}</span>
                  </label>
                </div>
                <p className="text-xs text-gray-600 dark:text-gray-300">{t('bookmarks_regex_help')}</p>
              </div>
            </div>
          </details>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-200" htmlFor="bookmark-sort">
                {t('bookmarks_sort_label')}
              </label>
              <select id="bookmark-sort" className="input" value={sortBy} onChange={(e) => setSortBy(e.target.value as SortOption)}>
                <option value="published_at">{t('bookmarks_sort_published')}</option>
                <option value="title">{t('bookmarks_sort_title')}</option>
                <option value="url">{t('bookmarks_sort_url')}</option>
                <option value="relevance">{t('bookmarks_sort_relevance')}</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-200" htmlFor="bookmark-sort-dir">
                {t('bookmarks_sort_direction')}
              </label>
              <select id="bookmark-sort-dir" className="input" value={sortDir} onChange={(e) => setSortDir(e.target.value as 'asc' | 'desc')} disabled={sortBy === 'relevance'}>
                <option value="desc">{t('bookmarks_sort_desc')}</option>
                <option value="asc">{t('bookmarks_sort_asc')}</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <button type="submit" className="btn">{t('btn_search')}</button>
              <button type="button" className="btn" onClick={clearFilters}>{t('btn_clear')}</button>
            </div>
            <div className="grow" />
            <div className="flex flex-wrap items-center gap-2">
              <label className="sr-only" htmlFor="bookmark-saved-views">{t('bookmarks_saved_views')}</label>
              <select
                id="bookmark-saved-views"
                className="input md:min-w-[180px]"
                onChange={(e) => {
                  const selected = e.target.value
                  if (!selected) return
                  const view = views.find(x => x.name === selected)
                  if (view) applyView(view)
                  e.target.value = ''
                }}
                defaultValue=""
                disabled={!views.length}
              >
                <option value="" disabled>{views.length ? t('bookmarks_saved_views_placeholder') : t('bookmarks_saved_views_empty')}</option>
                {views.map(v => <option key={v.name} value={v.name}>{v.name}</option>)}
              </select>
              <div className="flex items-center gap-2">
                <label className="sr-only" htmlFor="bookmark-save-name">{t('bookmarks_save_as')}</label>
                <input id="bookmark-save-name" className="input" placeholder={t('bookmarks_save_as')} value={newViewName} onChange={e => setNewViewName(e.target.value)} />
                <button type="button" className="btn" onClick={saveView}>{t('bookmarks_save_view')}</button>
              </div>
            </div>
          </div>
        </form>
        {banner && <div className="mb-3"><Alert kind={banner.kind} message={banner.message} onClose={() => setBanner(null)} /></div>}
        {isLoading && <p className="text-gray-600">{t('loading_text')}</p>}
        {error && <Alert kind="error" message={String(error)} />}
        {data && (
          <>
            <div className="card p-0 overflow-hidden">
              <div className="p-3 flex items-center gap-2 flex-wrap">
                <button className="btn" disabled={!hasSelection} onClick={bulkDelete}>{t('btn_delete_selected')}</button>
                <button className="btn" disabled={!hasSelection} onClick={() => exportSelected('json')}>{t('btn_export_json')}</button>
                <button className="btn" disabled={!hasSelection} onClick={() => exportSelected('csv')}>{t('btn_export_csv')}</button>
                <button className="btn" disabled={!hasSelection} onClick={() => { setPublishError(null); setShowPublishModal(true); setPublishMeta(null); setPublishJobs([]); }}>{t('bookmarks_publish_selected')}</button>
              </div>
              {(!data.items || data.items.length === 0) ? (
                <div className="p-4">
                  <EmptyState
                    title={t('empty_bookmarks_title')}
                    description={t('empty_bookmarks_desc')}
                    actionLabel={t('btn_clear_filters')}
                    onAction={clearFilters}
                  />
                </div>
              ) : (
              <table className="table" aria-label={t('bookmarks_table_label')}>
                <thead className="bg-gray-100">
                  <tr>
                    <th className="th" scope="col"><input aria-label={t('bookmarks_select_all')} type="checkbox" onChange={(e) => toggleAll(e.target.checked)} /></th>
                    <th className="th" scope="col"><button onClick={() => { setSortBy('title'); setSortDir(sortBy === 'title' && sortDir === 'asc' ? 'desc' : 'asc'); setPage(1); mutate() }} className="hover:underline">{t('title_label')} {sortBy==='title' ? (sortDir==='asc'?'▲':'▼') : ''}</button></th>
                    <th className="th" scope="col"><button onClick={() => { setSortBy('url'); setSortDir(sortBy === 'url' && sortDir === 'asc' ? 'desc' : 'asc'); setPage(1); mutate() }} className="hover:underline">{t('url_label')} {sortBy==='url' ? (sortDir==='asc'?'▲':'▼') : ''}</button></th>
                    <th className="th" scope="col"><button onClick={() => { setSortBy('published_at'); setSortDir(sortBy === 'published_at' && sortDir === 'asc' ? 'desc' : 'asc'); setPage(1); mutate() }} className="hover:underline">{t('published_label')} {sortBy==='published_at' ? (sortDir==='asc'?'▲':'▼') : ''}</button></th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((b: any) => (
                    <tr key={b.id} className="odd:bg-white even:bg-gray-50">
                      <td className="td"><input aria-label={t('bookmarks_select_row', { value: b.title || b.url || t('bookmarks_select_row_unknown') })} type="checkbox" checked={selected[b.id] || false} onChange={(e) => toggleOne(b.id, e.target.checked)} /></td>
                      <td className="td">{b.title}</td>
                      <td className="td"><a className="text-blue-600 hover:underline" href={b.url} target="_blank" rel="noreferrer">{b.url}</a></td>
                      <td className="td">{b.published_at || ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              )}
            </div>
            <div className="mt-3 flex items-center gap-2">
              <button className="btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>{t('pagination_prev')}</button>
              <span className="text-gray-700">{t('pagination_status', { page, total: data?.totalPages ?? (data as any)?.total_pages ?? 1 })}</span>
              <button className="btn" disabled={!data.hasNext} onClick={() => setPage(page + 1)}>{t('pagination_next')}</button>
            </div>
          </>
        )}
      </main>
      <Modal
        isOpen={showPublishModal}
        onClose={() => { setShowPublishModal(false); setPublishError(null) }}
        title={t('bookmarks_publish_title')}
        description={(
          <div className="space-y-1 text-sm text-gray-600 dark:text-gray-300">
            <p>{t('bookmarks_publish_description')}</p>
            <p>{t('bookmarks_publish_selected_count', { count: selectedCount })}</p>
          </div>
        )}
        closeLabel={t('bookmarks_publish_close')}
        footer={(
          <>
            <button type="button" className="btn" onClick={() => { setShowPublishModal(false); setPublishError(null) }}>
              {t('bookmarks_publish_cancel')}
            </button>
            <button type="submit" form="bookmark-publish-form" className="btn" disabled={!selectedIds.length}>
              {t('bookmarks_publish_submit')}
            </button>
          </>
        )}
        initialFocusRef={publishConfigRef}
      >
        <form id="bookmark-publish-form" className="space-y-4" onSubmit={startPublish}>
          {publishError && <Alert kind="error" message={publishError} />}
          <p className="text-xs text-gray-500 dark:text-gray-400">{t('bookmarks_publish_defaults_hint')}</p>
          <label className="flex flex-col gap-1 text-sm" htmlFor="publish-config-dir">
            <span className="font-medium text-gray-700 dark:text-gray-200">{t('bookmarks_publish_config_dir')}</span>
            <input
              id="publish-config-dir"
              ref={publishConfigRef}
              className="input"
              value={configDir}
              onChange={(e) => setConfigDir(e.target.value)}
              placeholder="./config"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm" htmlFor="publish-instapaper">
            <span className="font-medium text-gray-700 dark:text-gray-200">{t('bookmarks_publish_instapaper')}</span>
            <select
              id="publish-instapaper"
              className="input"
              value={instapaperId}
              onChange={(e) => setInstapaperId(e.target.value)}
              disabled={!instapaperItems.length}
            >
              <option value="">
                {instapaperItems.length ? t('bookmarks_publish_instapaper_placeholder') : t('bookmarks_publish_no_credentials')}
              </option>
              {instapaperItems.map((cred: any) => (
                <option key={cred.id} value={cred.id}>{cred.id}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm" htmlFor="publish-folder">
            <span className="font-medium text-gray-700 dark:text-gray-200">{t('bookmarks_publish_folder')}</span>
            <input
              id="publish-folder"
              className="input"
              value={folder}
              onChange={(e) => setFolder(e.target.value)}
              placeholder="Archive"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm" htmlFor="publish-tags">
            <span className="font-medium text-gray-700 dark:text-gray-200">{t('bookmarks_publish_tags')}</span>
            <input
              id="publish-tags"
              className="input"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder={t('bookmarks_publish_tags_placeholder')}
            />
          </label>
        </form>
      </Modal>
      <Modal
        isOpen={showProgressModal}
        onClose={() => setShowProgressModal(false)}
        title={t('bookmarks_publish_progress_title')}
        description={totalJobs ? t('bookmarks_publish_progress_summary', { done: doneCount, total: totalJobs }) : t('bookmarks_publish_progress_waiting')}
        closeLabel={t('bookmarks_publish_close')}
        footer={(
          <>
            <Link href="/jobs" className="btn" onClick={() => setShowProgressModal(false)}>
              {t('bookmarks_publish_view_jobs')}
            </Link>
            <button type="button" className="btn" onClick={() => setShowProgressModal(false)}>
              {t('bookmarks_publish_close')}
            </button>
          </>
        )}
      >
        <div className="space-y-3 text-sm text-gray-700 dark:text-gray-200">
          {failedCount > 0 && <Alert kind="error" message={t('bookmarks_publish_progress_failed', { count: failedCount })} />}
          {waitingForData && <p>{t('bookmarks_publish_progress_waiting')}</p>}
          {publishMeta?.missing?.length ? (
            <p className="text-amber-600 dark:text-amber-400">{t('bookmarks_publish_missing_count', { count: publishMeta.missing.length })}</p>
          ) : null}
          {publishMeta?.skipped?.length ? (
            <p className="text-amber-600 dark:text-amber-400">{t('bookmarks_publish_skipped_count', { count: publishMeta.skipped.length })} — {t('bookmarks_publish_skipped_missing_url')}</p>
          ) : null}
          {jobList.length ? (
            <ul className="divide-y divide-gray-200 dark:divide-gray-700 rounded-md border border-gray-200 dark:border-gray-700">
              {jobList.map((job: any) => (
                <li key={job.id} className="flex items-center justify-between px-3 py-2">
                  <span className="font-mono text-xs text-gray-500 dark:text-gray-300">{job.id}</span>
                  <span className="capitalize">{String(job.status || '').replace(/_/g, ' ') || 'queued'}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-gray-500 dark:text-gray-400">{t('bookmarks_publish_progress_waiting')}</p>
          )}
        </div>
      </Modal>
    </div>
  )
}
