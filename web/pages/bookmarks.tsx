import useSWR from 'swr'
import Nav from '../components/Nav'
import { v1 } from '../lib/openapi'
import { FormEvent, useEffect, useState } from 'react'
import Alert from '../components/Alert'
import { useI18n } from '../lib/i18n'
import EmptyState from '../components/EmptyState'

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
  const [banner, setBanner] = useState<{ kind: 'success' | 'error'; message: string } | null>(null)
  const [selected, setSelected] = useState<Record<string, boolean>>({})

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
    const ids = Object.entries(selected).filter(([, v]) => v).map(([k]) => k)
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
    const items = (data?.items ?? []).filter((b: any) => selected[b.id])
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
          <details className="rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 p-3" defaultOpen={Boolean(titleQuery || urlQuery || regexPattern)}>
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
              <div className="p-3 flex items-center gap-2">
                <button className="btn" disabled={!data.items?.length} onClick={bulkDelete}>{t('btn_delete_selected')}</button>
                <button className="btn" disabled={!data.items?.length} onClick={() => exportSelected('json')}>{t('btn_export_json')}</button>
                <button className="btn" disabled={!data.items?.length} onClick={() => exportSelected('csv')}>{t('btn_export_csv')}</button>
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
              <span className="text-gray-700">{t('pagination_status', { page, total: data.totalPages })}</span>
              <button className="btn" disabled={!data.hasNext} onClick={() => setPage(page + 1)}>{t('pagination_next')}</button>
            </div>
          </>
        )}
      </main>
    </div>
  )
}
