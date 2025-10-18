import useSWR from 'swr'
import { Alert, Breadcrumbs, BulkActionToolbar, BulkPublishModal, EmptyState, InlineTip, Nav, PreviewPane, PreviewSlideOver } from '../components'
import type { BulkPublishResult } from '../components/BulkPublishModal'
import { v1 } from '../lib/openapi'
import { FormEvent, KeyboardEvent, MouseEvent, useEffect, useMemo, useRef, useState } from 'react'
import { useI18n } from '../lib/i18n'
import { formatDateTimeValue, formatNumberValue, useDateTimeFormatter, useNumberFormatter } from '../lib/format'
import { buildBreadcrumbs } from '../lib/breadcrumbs'
import { useRouter } from 'next/router'
import { useSessionReauth } from '../lib/useSessionReauth'
import {
  extractPermissionList,
  hasPermission,
  PERMISSION_MANAGE_BOOKMARKS,
  PERMISSION_READ_BOOKMARKS,
} from '../lib/rbac'
import type { FeedOut } from '../sdk/src/models/FeedOut'

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

type BulkPublishRequestItem = {
  id: string
  url: string
  title?: string | null
  feed_id?: string | null
  published_at?: string | null
}

type BulkPublishPlan = {
  runKey: number
  requestBody: { items: BulkPublishRequestItem[] }
}

type ItemsSource<T> = T[] | { items?: T[] }

function extractItems<T>(source: ItemsSource<T> | undefined): T[] {
  return Array.isArray(source) ? source : source?.items ?? []
}

export default function Bookmarks() {
  const { t } = useI18n()
  const router = useRouter()
  const { data: session, status } = useSessionReauth()
  const breadcrumbs = useMemo(() => buildBreadcrumbs(router.pathname, t), [router.pathname, t])
  const numberFormatter = useNumberFormatter()
  const dateTimeFormatter = useDateTimeFormatter({ dateStyle: 'medium', timeStyle: 'short' })
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
  const [previewBookmarkId, setPreviewBookmarkId] = useState<string | null>(null)
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)
  const [shouldAutoFocusPreview, setShouldAutoFocusPreview] = useState(true)
  const hasAdvancedFilters = Boolean(titleQuery || urlQuery || regexPattern)
  const [isAdvancedFiltersOpen, setIsAdvancedFiltersOpen] = useState(hasAdvancedFilters)
  const permissions = extractPermissionList(session?.user)
  const isAuthenticated = status === 'authenticated'
  const canViewBookmarks = Boolean(
    isAuthenticated &&
      (hasPermission(permissions, PERMISSION_READ_BOOKMARKS) ||
        hasPermission(permissions, PERMISSION_MANAGE_BOOKMARKS)),
  )
  function addZ(v?: string) { if (!v) return undefined; return v.endsWith('Z') ? v : v + ':00Z' }
  const { data, error, isLoading, mutate } = useSWR(
    canViewBookmarks
      ? [
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
  ]
      : null,
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
  const { data: feeds } = useSWR<ItemsSource<FeedOut>>(
    canViewBookmarks ? [`/v1/feeds`] : null,
    () => v1.listFeedsV1V1FeedsGet({}),
  )
  const feedItems = extractItems(feeds)
  const [banner, setBanner] = useState<{ kind: 'success' | 'error' | 'info'; message: string } | null>(null)
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [publishPlan, setPublishPlan] = useState<BulkPublishPlan | null>(null)
  const [publishInFlight, setPublishInFlight] = useState(false)
  const rowRefs = useRef<(HTMLTableRowElement | null)[]>([])
  const selectedIds = useMemo(
    () => Object.entries(selected).filter(([, value]) => value).map(([id]) => id),
    [selected],
  )
  const selectedCount = selectedIds.length
  const bookmarkItems = data?.items ?? []
  const previewHeadingId = 'bookmark-preview-heading'
  const previewScreenReaderHeadingId = 'bookmark-preview-sr-heading'
  const previewDialogId = 'bookmark-preview-dialog'
  const previewSelectionIndex = previewBookmarkId
    ? bookmarkItems.findIndex((item: any) => item.id === previewBookmarkId)
    : -1

  const { data: previewData, error: previewError, isLoading: previewLoading } = useSWR(
    canViewBookmarks && previewBookmarkId ? ['/v1/bookmarks', previewBookmarkId, 'preview'] : null,
    () => v1.previewBookmarkV1BookmarksBookmarkIdPreviewGet({ bookmarkId: previewBookmarkId as string }),
  )
  const previewSnippet = typeof previewData === 'string' ? previewData : ''
  const previewHasContent = previewSnippet.trim().length > 0
  const previewErrorMessage = previewError?.message?.trim()
  const previewEmptyState = previewError
    ? (
        <p className="text-sm text-red-600">
          {previewErrorMessage
            ? t('bookmarks_preview_error_detail', { reason: previewErrorMessage })
            : t('bookmarks_preview_error')}
        </p>
      )
    : previewBookmarkId
      ? previewLoading
        ? <p className="text-sm text-gray-500">{t('bookmarks_preview_loading')}</p>
        : previewHasContent
          ? undefined
          : <p className="text-sm text-gray-500">{t('bookmarks_preview_empty')}</p>
      : undefined

  useEffect(() => {
    if (hasAdvancedFilters) {
      setIsAdvancedFiltersOpen(true)
    }
  }, [hasAdvancedFilters])

  useEffect(() => {
    if (previewBookmarkId && previewSelectionIndex === -1) {
      setPreviewBookmarkId(null)
      setIsPreviewOpen(false)
    }
  }, [previewBookmarkId, previewSelectionIndex])

  useEffect(() => {
    if (!previewBookmarkId) {
      setIsPreviewOpen(false)
    }
  }, [previewBookmarkId])

  useEffect(() => {
    if (!isPreviewOpen) {
      setShouldAutoFocusPreview(true)
    }
  }, [isPreviewOpen])

  useEffect(() => {
    rowRefs.current.length = bookmarkItems.length
  }, [bookmarkItems.length])

  const getBookmarkLabel = (bookmark: any) => bookmark?.title || bookmark?.url || t('bookmarks_select_row_unknown')

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
    setIsAdvancedFiltersOpen(false)
  }

  const focusRow = (index: number) => {
    const row = rowRefs.current[index]
    if (row) {
      row.focus({ preventScroll: true })
      window.setTimeout(() => {
        if (document.activeElement !== row) {
          row.focus({ preventScroll: true })
        }
      }, 50)
    }
  }

  const handleRowClick = (event: MouseEvent<HTMLTableRowElement>, bookmarkId: string) => {
    const target = event.target as HTMLElement | null
    if (target && target.closest('button, a, input, select, textarea, label')) {
      return
    }
    const wasActive = previewBookmarkId === bookmarkId
    setShouldAutoFocusPreview(false)
    setPreviewBookmarkId(bookmarkId)
    setIsPreviewOpen(prev => (wasActive ? !prev : true))
  }

  const handleRowKeyDown = (
    event: KeyboardEvent<HTMLTableRowElement>,
    index: number,
    bookmarkId: string,
  ) => {
    if (event.target !== event.currentTarget) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      const nextIndex = Math.min(index + 1, bookmarkItems.length - 1)
      if (nextIndex !== index && bookmarkItems[nextIndex]) {
        setShouldAutoFocusPreview(false)
        setPreviewBookmarkId(bookmarkItems[nextIndex].id)
        setIsPreviewOpen(true)
        focusRow(nextIndex)
      }
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      const prevIndex = Math.max(index - 1, 0)
      if (prevIndex !== index && bookmarkItems[prevIndex]) {
        setShouldAutoFocusPreview(false)
        setPreviewBookmarkId(bookmarkItems[prevIndex].id)
        setIsPreviewOpen(true)
        focusRow(prevIndex)
      }
    } else if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar' || event.key === 'Space') {
      event.preventDefault()
      const wasActive = previewBookmarkId === bookmarkId
      setShouldAutoFocusPreview(false)
      setPreviewBookmarkId(bookmarkId)
      setIsPreviewOpen(prev => (wasActive ? !prev : true))
    }
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
  function clearSelection() {
    setSelected({})
  }
  function bulkPublish() {
    if (publishInFlight) return
    const items = (data?.items ?? []).filter((b: any) => selected[b.id])
    if (!items.length) return
    const requestItems: BulkPublishRequestItem[] = items.map((b: any) => ({
      id: b.id,
      url: b.url,
      title: b.title,
      feed_id: b.feed_id ?? undefined,
      published_at: b.published_at ?? undefined,
    }))
    setPublishInFlight(true)
    setPublishPlan({
      runKey: Date.now(),
      requestBody: { items: requestItems },
    })
  }
  function summarizeResult(result: BulkPublishResult | null): { success: number; failed: number } {
    if (!result) return { success: 0, failed: 0 }
    if (result.summary) {
      return {
        success: Number.isFinite(result.summary.success) ? result.summary.success : 0,
        failed: Number.isFinite(result.summary.failed) ? result.summary.failed : 0,
      }
    }
    let success = 0
    let failed = 0
    for (const item of result.items) {
      if (item.status === 'success') success += 1
      if (item.status === 'failure' || item.status === 'error') failed += 1
    }
    return { success, failed }
  }
  function handlePublishComplete(result: BulkPublishResult) {
    setPublishInFlight(false)
    const summary = summarizeResult(result)
    if (summary.failed === 0) {
      const count = summary.success > 0 ? summary.success : result.items.length
      setBanner({
        kind: 'success',
        message: t('bookmarks_publish_success', { count: formatNumberValue(count, numberFormatter, '0') }),
      })
      clearSelection()
    } else {
      setBanner({
        kind: 'error',
        message: t('bookmarks_publish_partial', {
          success: formatNumberValue(summary.success, numberFormatter, '0'),
          failed: formatNumberValue(summary.failed, numberFormatter, '0'),
        }),
      })
      const failedSelection: Record<string, boolean> = {}
      result.items.forEach(item => {
        if (item.status === 'failure' || item.status === 'error') failedSelection[item.id] = true
      })
      setSelected(failedSelection)
    }
    mutate()
  }
  function handlePublishCancel(_result: BulkPublishResult) {
    setPublishInFlight(false)
    setBanner({ kind: 'info', message: t('bookmarks_publish_cancelled') })
  }
  function handlePublishError(error: Error, _result: BulkPublishResult | null) {
    setPublishInFlight(false)
    const reason = error?.message || String(error)
    setBanner({ kind: 'error', message: t('bookmarks_publish_failed', { reason }) })
  }
  function closePublishModal() {
    setPublishPlan(null)
  }
  async function bulkDelete() {
    const ids = Object.entries(selected).filter(([, v]) => v).map(([k]) => k)
    if (!ids.length) return
    const formattedCount = formatNumberValue(ids.length, numberFormatter, '0')
    if (!confirm(t('bookmarks_confirm_delete', { count: formattedCount }))) return
    try {
      await v1.bulkDeleteBookmarksV1BookmarksBulkDeletePost({ requestBody: { ids, delete_remote: true } })
      setBanner({ kind: 'success', message: t('bookmarks_deleted_success', { count: formattedCount }) })
      clearSelection()
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
  if (status === 'loading') {
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
  if (status === 'unauthenticated') {
    return renderAccessMessage(t('access_sign_in_title'), t('access_sign_in_message'))
  }
  if (!canViewBookmarks) {
    return renderAccessMessage(t('access_denied_title'), t('access_denied_message'))
  }
  return (
    <div>
      <Nav />
      <Breadcrumbs items={breadcrumbs} />
      <main className="container py-6">
        <div className="flex items-center gap-2 mb-3">
          <h2 id="bookmarks-heading" className="text-xl font-semibold">{t('bookmarks_title')}</h2>
        </div>
        <form
          className="card p-4 mb-4 space-y-4"
          onSubmit={(e: FormEvent) => { e.preventDefault(); setPage(1); mutate() }}
          role="search"
          aria-labelledby="bookmarks-heading"
          aria-describedby="bookmarks-filter-description"
        >
          <p id="bookmarks-filter-description" className="sr-only">{t('bookmarks_filters_description')}</p>
          <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
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
            open={isAdvancedFiltersOpen}
            onToggle={(event) => setIsAdvancedFiltersOpen(event.currentTarget.open)}
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
                <InlineTip className="mt-1" message={t('bookmarks_regex_tip')} />
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
              <BulkActionToolbar
                selectedCount={selectedCount}
                disabled={publishInFlight}
                onClearSelection={clearSelection}
                actions={[
                  { label: t('btn_publish_selected'), onClick: bulkPublish, busy: publishInFlight },
                  { label: t('btn_delete_selected'), onClick: bulkDelete },
                  { label: t('btn_export_json'), onClick: () => exportSelected('json') },
                  { label: t('btn_export_csv'), onClick: () => exportSelected('csv') },
                ]}
              />
              {(!data.items || data.items.length === 0) ? (
                <div className="p-4">
                  <EmptyState
                    icon={<span>📭</span>}
                    message={(
                      <div className="space-y-1">
                        <p className="text-lg font-semibold text-gray-700 dark:text-gray-200">{t('empty_bookmarks_title')}</p>
                        <p>{t('empty_bookmarks_desc')}</p>
                      </div>
                    )}
                    action={
                      <button type="button" className="btn" onClick={clearFilters}>
                        {t('btn_clear_filters')}
                      </button>
                    }
                  />
                </div>
              ) : (
                <div className="border-t border-gray-200">
                  <div className="overflow-x-auto p-4">
                    <table className="table" role="table" aria-label={t('bookmarks_table_label')}>
                      <thead className="bg-gray-100 dark:bg-gray-800">
                        <tr>
                          <th className="th" scope="col">
                            <input
                              aria-label={t('bookmarks_select_all')}
                              type="checkbox"
                              onChange={(e) => toggleAll(e.target.checked)}
                              onClick={(event) => event.stopPropagation()}
                            />
                          </th>
                          <th
                            className="th"
                            scope="col"
                            aria-sort={sortBy === 'title' ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}
                          >
                            <button
                              type="button"
                              onClick={() => { setSortBy('title'); setSortDir(sortBy === 'title' && sortDir === 'asc' ? 'desc' : 'asc'); setPage(1); mutate() }}
                              className="rounded focus-visible:underline hover:underline"
                            >
                              {t('title_label')} {sortBy==='title' ? (sortDir==='asc'?'▲':'▼') : ''}
                            </button>
                          </th>
                          <th
                            className="th"
                            scope="col"
                            aria-sort={sortBy === 'url' ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}
                          >
                            <button
                              type="button"
                              onClick={() => { setSortBy('url'); setSortDir(sortBy === 'url' && sortDir === 'asc' ? 'desc' : 'asc'); setPage(1); mutate() }}
                              className="rounded focus-visible:underline hover:underline"
                            >
                              {t('url_label')} {sortBy==='url' ? (sortDir==='asc'?'▲':'▼') : ''}
                            </button>
                          </th>
                          <th
                            className="th"
                            scope="col"
                            aria-sort={sortBy === 'published_at' ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}
                          >
                            <button
                              type="button"
                              onClick={() => { setSortBy('published_at'); setSortDir(sortBy === 'published_at' && sortDir === 'asc' ? 'desc' : 'asc'); setPage(1); mutate() }}
                              className="rounded focus-visible:underline hover:underline"
                            >
                              {t('published_label')} {sortBy==='published_at' ? (sortDir==='asc'?'▲':'▼') : ''}
                            </button>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {bookmarkItems.map((b: any, index: number) => {
                          const isActive = previewBookmarkId === b.id
                          const bookmarkLabel = getBookmarkLabel(b)
                          return (
                            <tr
                              key={b.id}
                              ref={(el) => { rowRefs.current[index] = el }}
                              tabIndex={0}
                              aria-selected={isActive}
                              aria-controls={previewDialogId}
                              aria-expanded={isActive && isPreviewOpen}
                              onClick={(event) => handleRowClick(event, b.id)}
                              onKeyDown={(event) => handleRowKeyDown(event, index, b.id)}
                              className={`odd:bg-white even:bg-gray-50 dark:odd:bg-gray-800 dark:even:bg-gray-900 cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${isActive ? 'bg-blue-50 dark:bg-blue-900/40' : 'hover:bg-gray-100 dark:hover:bg-gray-800'}`}
                            >
                              <td className="td">
                                <input
                                  aria-label={t('bookmarks_select_row', { value: bookmarkLabel })}
                                  type="checkbox"
                                  checked={selected[b.id] || false}
                                  onChange={(e) => toggleOne(b.id, e.target.checked)}
                                  onClick={(event) => event.stopPropagation()}
                                />
                              </td>
                              <td className="td">
                                <span className="font-medium">
                                  {b.title}
                                </span>
                              </td>
                              <td className="td">
                                <a className="text-blue-600 hover:underline" href={b.url} target="_blank" rel="noreferrer">
                                  {b.url}
                                </a>
                              </td>
                              <td className="td">{formatDateTimeValue(b.published_at, dateTimeFormatter, b.published_at || '')}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
            <div className="mt-3 flex items-center gap-2">
              <button className="btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>{t('pagination_prev')}</button>
              <span className="text-gray-700 dark:text-gray-300">
                {t('pagination_status', {
                  page: numberFormatter.format(page),
                  total: numberFormatter.format(data.totalPages ?? 1),
                })}
              </span>
              <button className="btn" disabled={!data.hasNext} onClick={() => setPage(page + 1)}>{t('pagination_next')}</button>
            </div>
          </>
        )}
      </main>
      <div className="sr-only" data-testid="bookmark-preview-live-region">
        <h2 id={previewScreenReaderHeadingId}>{t('bookmarks_preview_heading')}</h2>
        <PreviewPane
          snippet={previewSnippet}
          emptyState={previewEmptyState}
          labelledBy={previewScreenReaderHeadingId}
          tabIndex={-1}
        />
      </div>
      {publishPlan && (
        <BulkPublishModal
          open
          runKey={publishPlan.runKey}
          requestBody={publishPlan.requestBody}
          onComplete={handlePublishComplete}
          onCancel={handlePublishCancel}
          onError={handlePublishError}
          onClose={closePublishModal}
        />
      )}
      {previewBookmarkId && (
        <PreviewSlideOver
          id={previewDialogId}
          open={isPreviewOpen}
          heading={t('bookmarks_preview_heading')}
          labelledBy={previewHeadingId}
          snippet={previewSnippet}
          emptyState={previewEmptyState}
          autoFocus={shouldAutoFocusPreview}
          onClose={() => setIsPreviewOpen(false)}
        />
      )}
    </div>
  )
}
