import useSWR from 'swr'
import { Alert, BulkPublishModal, EmptyState, Nav } from '../components'
import type { BulkPublishSummary } from '../components/BulkPublishModal'
import type { ProgressModalItem, ProgressModalStatus } from '../components/ProgressModal'
import { v1 } from '../lib/openapi'
import { streamBulkPublish, type BulkPublishEvent } from '../lib/bulkPublish'
import { FormEvent, useEffect, useRef, useState } from 'react'
import { useI18n } from '../lib/i18n'
import { formatDateTimeValue, formatNumberValue, useDateTimeFormatter, useNumberFormatter } from '../lib/format'

type RegexTarget = 'both' | 'title' | 'url'
type SortOption = 'title' | 'url' | 'published_at' | 'relevance'
type SavedView = {
  name: string
  search?: string
  feed_id?: string
  tag_id?: string
  folder_id?: string
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

type BulkProgressState = {
  open: boolean
  status: ProgressModalStatus
  items: ProgressModalItem[]
  message?: string
  summary?: BulkPublishSummary | null
  totalCount?: number
  errorMessage?: string | null
}

export default function Bookmarks() {
  const { t } = useI18n()
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
  const [tagIdFilter, setTagIdFilter] = useState('')
  const [folderIdFilter, setFolderIdFilter] = useState('')
  const [since, setSince] = useState('')
  const [until, setUntil] = useState('')
  const [sortBy, setSortBy] = useState<SortOption>('published_at')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [newTagName, setNewTagName] = useState('')
  const [tagEditId, setTagEditId] = useState<string | null>(null)
  const [tagEditName, setTagEditName] = useState('')
  const [tagActionBusy, setTagActionBusy] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [newFolderInstapaperId, setNewFolderInstapaperId] = useState('')
  const [folderEditId, setFolderEditId] = useState<string | null>(null)
  const [folderEditName, setFolderEditName] = useState('')
  const [folderEditInstapaperId, setFolderEditInstapaperId] = useState('')
  const [folderActionBusy, setFolderActionBusy] = useState(false)
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
    tagIdFilter,
    folderIdFilter,
    since,
    until,
    sortBy,
    sortDir,
  ],
    ([, p, kw, tQuery, uQuery, regexValue, target, regexCI, f, tagFilter, folderFilter, s, u, sb, sd]) => v1.listBookmarksV1BookmarksGet({
      page: p,
      search: kw || undefined,
      titleQuery: tQuery || undefined,
      urlQuery: uQuery || undefined,
      regex: regexValue || undefined,
      regexTarget: target,
      regexFlags: regexValue ? (regexCI ? 'i' : '') : undefined,
      feedId: f || undefined,
      tagId: tagFilter || undefined,
      folderId: folderFilter || undefined,
      since: addZ(s),
      until: addZ(u),
      fuzzy: sb === 'relevance',
      sortBy: sb,
      sortDir: sb === 'relevance' ? undefined : sd,
    }))
  const { data: feeds } = useSWR([`/v1/feeds`], () => v1.listFeedsV1V1FeedsGet({}))
  const feedItems = Array.isArray(feeds) ? feeds : feeds?.items ?? []
  const { data: tagsData, error: tagsError, isLoading: tagsLoading, mutate: mutateTags } = useSWR([`/v1/bookmarks/tags`], () => v1.listTagsBookmarksTagsGet())
  const tagItems = Array.isArray(tagsData) ? tagsData : tagsData?.items ?? []
  const { data: foldersData, error: foldersError, isLoading: foldersLoading, mutate: mutateFolders } = useSWR([`/v1/bookmarks/folders`], () => v1.listFoldersBookmarksFoldersGet())
  const folderItems = Array.isArray(foldersData) ? foldersData : foldersData?.items ?? []
  const [banner, setBanner] = useState<{ kind: 'success' | 'error' | 'info'; message: string } | null>(null)
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [progress, setProgress] = useState<BulkProgressState | null>(null)
  const progressRef = useRef<BulkProgressState | null>(null)
  const publishController = useRef<AbortController | null>(null)
  const selectedCount = Object.values(selected).filter(Boolean).length
  const hasSelection = selectedCount > 0

  const setProgressState = (
    updater: BulkProgressState | null | ((prev: BulkProgressState | null) => BulkProgressState | null),
  ) => {
    if (typeof updater === 'function') {
      setProgress(prev => {
        const next = (updater as (prev: BulkProgressState | null) => BulkProgressState | null)(prev)
        progressRef.current = next
        return next
      })
    } else {
      progressRef.current = updater
      setProgress(updater)
    }
  }

  function clearFilters() {
    setKeyword('')
    setTitleQuery('')
    setUrlQuery('')
    setRegexPattern('')
    setRegexTarget('both')
    setRegexCaseInsensitive(true)
    setFeedId('')
    setTagIdFilter('')
    setFolderIdFilter('')
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
      tag_id: tagIdFilter || undefined,
      folder_id: folderIdFilter || undefined,
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
    setTagIdFilter(v.tag_id || '')
    setFolderIdFilter(v.folder_id || '')
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

  function startEditTag(tag: any) {
    setTagEditId(tag.id)
    setTagEditName(tag.name || '')
  }

  function cancelEditTag() {
    setTagEditId(null)
    setTagEditName('')
  }

  async function handleCreateTag(event: FormEvent) {
    event.preventDefault()
    const trimmed = newTagName.trim()
    if (!trimmed || tagActionBusy) return
    setTagActionBusy(true)
    try {
      await v1.createTagBookmarksTagsPost({ tagCreate: { name: trimmed } })
      setBanner({ kind: 'success', message: t('bookmarks_tag_create_success', { name: trimmed }) })
      setNewTagName('')
      mutateTags()
    } catch (err: any) {
      setBanner({ kind: 'error', message: t('bookmarks_tag_action_failed', { reason: err?.message || String(err) }) })
    } finally {
      setTagActionBusy(false)
    }
  }

  async function handleSaveTag() {
    if (!tagEditId || tagActionBusy) return
    const trimmed = tagEditName.trim()
    if (!trimmed) {
      setBanner({ kind: 'error', message: t('bookmarks_tag_name_required') })
      return
    }
    setTagActionBusy(true)
    try {
      await v1.updateTagBookmarksTagsTagIdPut({ tagId: tagEditId, tagUpdate: { name: trimmed } })
      setBanner({ kind: 'success', message: t('bookmarks_tag_update_success', { name: trimmed }) })
      cancelEditTag()
      mutateTags()
      mutate()
    } catch (err: any) {
      setBanner({ kind: 'error', message: t('bookmarks_tag_action_failed', { reason: err?.message || String(err) }) })
    } finally {
      setTagActionBusy(false)
    }
  }

  async function handleDeleteTag(tag: any) {
    if (tagActionBusy) return
    const name = tag?.name || ''
    if (!confirm(t('bookmarks_tag_confirm_delete', { name: name || t('bookmarks_tag_fallback') }))) return
    setTagActionBusy(true)
    try {
      await v1.deleteTagBookmarksTagsTagIdDelete({ tagId: tag.id })
      setBanner({ kind: 'success', message: t('bookmarks_tag_delete_success', { name: name || t('bookmarks_tag_fallback') }) })
      if (tagIdFilter === tag.id) {
        setTagIdFilter('')
        setPage(1)
      }
      mutateTags()
      mutate()
    } catch (err: any) {
      setBanner({ kind: 'error', message: t('bookmarks_tag_action_failed', { reason: err?.message || String(err) }) })
    } finally {
      setTagActionBusy(false)
    }
  }

  function startEditFolder(folder: any) {
    setFolderEditId(folder.id)
    setFolderEditName(folder.name || '')
    setFolderEditInstapaperId(folder.instapaper_folder_id || '')
  }

  function cancelEditFolder() {
    setFolderEditId(null)
    setFolderEditName('')
    setFolderEditInstapaperId('')
  }

  async function handleCreateFolder(event: FormEvent) {
    event.preventDefault()
    if (folderActionBusy) return
    const trimmed = newFolderName.trim()
    if (!trimmed) {
      setBanner({ kind: 'error', message: t('bookmarks_folder_name_required') })
      return
    }
    const instapaper = newFolderInstapaperId.trim()
    setFolderActionBusy(true)
    try {
      await v1.createFolderBookmarksFoldersPost({
        folderCreate: {
          name: trimmed,
          instapaper_folder_id: instapaper ? instapaper : undefined,
        },
      })
      setBanner({ kind: 'success', message: t('bookmarks_folder_create_success', { name: trimmed }) })
      setNewFolderName('')
      setNewFolderInstapaperId('')
      mutateFolders()
    } catch (err: any) {
      setBanner({ kind: 'error', message: t('bookmarks_folder_action_failed', { reason: err?.message || String(err) }) })
    } finally {
      setFolderActionBusy(false)
    }
  }

  async function handleSaveFolder() {
    if (!folderEditId || folderActionBusy) return
    const trimmed = folderEditName.trim()
    if (!trimmed) {
      setBanner({ kind: 'error', message: t('bookmarks_folder_name_required') })
      return
    }
    const instapaperRaw = folderEditInstapaperId.trim()
    const payload: any = { name: trimmed }
    payload.instapaper_folder_id = instapaperRaw ? instapaperRaw : null
    setFolderActionBusy(true)
    try {
      await v1.updateFolderBookmarksFoldersFolderIdPut({ folderId: folderEditId, folderUpdate: payload })
      setBanner({ kind: 'success', message: t('bookmarks_folder_update_success', { name: trimmed }) })
      cancelEditFolder()
      mutateFolders()
      mutate()
    } catch (err: any) {
      setBanner({ kind: 'error', message: t('bookmarks_folder_action_failed', { reason: err?.message || String(err) }) })
    } finally {
      setFolderActionBusy(false)
    }
  }

  async function handleDeleteFolder(folder: any) {
    if (folderActionBusy) return
    const name = folder?.name || ''
    if (!confirm(t('bookmarks_folder_confirm_delete', { name: name || t('bookmarks_folder_fallback') }))) return
    setFolderActionBusy(true)
    try {
      await v1.deleteFolderBookmarksFoldersFolderIdDelete({ folderId: folder.id })
      setBanner({ kind: 'success', message: t('bookmarks_folder_delete_success', { name: name || t('bookmarks_folder_fallback') }) })
      if (folderIdFilter === folder.id) {
        setFolderIdFilter('')
        setPage(1)
      }
      mutateFolders()
      mutate()
    } catch (err: any) {
      setBanner({ kind: 'error', message: t('bookmarks_folder_action_failed', { reason: err?.message || String(err) }) })
    } finally {
      setFolderActionBusy(false)
    }
  }

  function toggleOne(id: string, checked: boolean) {
    setSelected(prev => ({ ...prev, [id]: checked }))
  }
  function toggleAll(checked: boolean) {
    const next: Record<string, boolean> = {}
    for (const b of data?.items ?? []) next[b.id] = checked
    setSelected(next)
  }
  async function bulkPublish() {
    const items = (data?.items ?? []).filter((b: any) => selected[b.id])
    if (!items.length) return
    const formattedCount = formatNumberValue(items.length, numberFormatter, '0')
    const modalItems: ProgressModalItem[] = items.map((b: any) => ({
      id: b.id,
      label: b.title || b.url || t('bookmarks_select_row_unknown'),
      status: 'pending',
    }))
    const initialState: BulkProgressState = {
      open: true,
      status: 'running',
      items: modalItems,
      message: t('bookmarks_publish_in_progress', { count: formattedCount }),
      summary: null,
      totalCount: items.length,
      errorMessage: null,
    }
    setProgressState(initialState)
    const controller = new AbortController()
    publishController.current = controller
    let finalSummary: { success: number; failed: number } | null = null
    try {
      const requestBody = {
        items: items.map((b: any) => ({
          id: b.id,
          url: b.url,
          title: b.title,
          feed_id: b.feed_id,
          published_at: b.published_at,
        })),
      }
      await streamBulkPublish({
        requestBody,
        signal: controller.signal,
        onEvent: (event: BulkPublishEvent) => {
          if (event.type === 'item') {
            setProgressState(prev => {
              if (!prev) return prev
              const nextItems = prev.items.map(item => {
                if (item.id !== event.id) return item
                const nextStatus: ProgressModalItem['status'] =
                  event.status === 'running' ? 'running' : event.status === 'success' ? 'success' : 'error'
                return {
                  ...item,
                  status: nextStatus,
                  message: event.message ? String(event.message) : undefined,
                }
              })
              return { ...prev, items: nextItems }
            })
          } else if (event.type === 'error') {
            const reason = event.message ? String(event.message) : t('bookmarks_publish_modal_failed_generic')
            setProgressState(prev => (prev ? { ...prev, status: 'error', message: reason, errorMessage: reason } : prev))
          } else if (event.type === 'start') {
            setProgressState(prev => {
              if (!prev) return prev
              const total = Number(event.total ?? prev.totalCount ?? items.length)
              const resolvedTotal = Number.isFinite(total)
                ? total
                : typeof prev.totalCount === 'number'
                  ? prev.totalCount
                  : items.length
              const nextMessage = t('bookmarks_publish_in_progress', { count: numberFormatter.format(resolvedTotal) })
              return { ...prev, message: nextMessage, totalCount: resolvedTotal }
            })
          } else if (event.type === 'complete') {
            const success = Number(event.success ?? 0) || 0
            const failed = Number(event.failed ?? 0) || 0
            finalSummary = { success, failed }
            setProgressState(prev => {
              if (!prev) return prev
              const status: ProgressModalStatus = failed > 0 ? 'error' : 'success'
              const message = failed > 0
                ? t('bookmarks_publish_modal_partial', {
                  success: numberFormatter.format(success),
                  failed: numberFormatter.format(failed),
                })
                : t('bookmarks_publish_modal_success', { count: numberFormatter.format(success) })
              return {
                ...prev,
                status,
                message,
                summary: { success, failed },
                totalCount: typeof prev.totalCount === 'number' ? prev.totalCount : success + failed,
                errorMessage: failed > 0 ? prev.errorMessage : null,
              }
            })
          }
        },
      })
      const summary = finalSummary ?? (() => {
        const current = progressRef.current
        if (!current) return null
        let success = 0
        let failed = 0
        for (const item of current.items) {
          if (item.status === 'success') success += 1
          if (item.status === 'error') failed += 1
        }
        return { success, failed }
      })()
      if (summary) {
        setProgressState(prev => {
          if (!prev) return prev
          const hasErrorMessage = Boolean(prev.errorMessage)
          const status: ProgressModalStatus = hasErrorMessage ? prev.status : summary.failed > 0 ? 'error' : 'success'
          const message = hasErrorMessage
            ? prev.message
            : summary.failed > 0
              ? t('bookmarks_publish_modal_partial', {
                success: numberFormatter.format(summary.success),
                failed: numberFormatter.format(summary.failed),
              })
              : t('bookmarks_publish_modal_success', { count: numberFormatter.format(summary.success) })
          return {
            ...prev,
            status,
            message,
            summary,
            totalCount: typeof prev.totalCount === 'number' ? prev.totalCount : summary.success + summary.failed,
            errorMessage: status === 'success' ? null : prev.errorMessage,
          }
        })
        if (summary.failed === 0) {
          setBanner({ kind: 'success', message: t('bookmarks_publish_success', { count: formatNumberValue(summary.success, numberFormatter, '0') }) })
          setSelected({})
        } else {
          setBanner({
            kind: 'error',
            message: t('bookmarks_publish_partial', {
              success: formatNumberValue(summary.success, numberFormatter, '0'),
              failed: formatNumberValue(summary.failed, numberFormatter, '0'),
            }),
          })
          const current = progressRef.current
          if (current) {
            const failedSelection: Record<string, boolean> = {}
            current.items.forEach(item => { if (item.status === 'error') failedSelection[item.id] = true })
            setSelected(failedSelection)
          }
        }
        mutate()
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        setProgressState(prev => (prev ? { ...prev, status: 'cancelled', message: t('bookmarks_publish_modal_cancelled'), errorMessage: null } : prev))
        setBanner({ kind: 'info', message: t('bookmarks_publish_cancelled') })
      } else {
        const reason = err?.message || String(err)
        setProgressState(prev => (prev ? { ...prev, status: 'error', message: t('bookmarks_publish_modal_failed', { reason }), errorMessage: reason } : prev))
        setBanner({ kind: 'error', message: t('bookmarks_publish_failed', { reason }) })
      }
    } finally {
      publishController.current = null
    }
  }
  function cancelPublish() {
    publishController.current?.abort()
  }
  function closeProgress() {
    setProgressState(null)
  }
  async function bulkDelete() {
    const ids = Object.entries(selected).filter(([, v]) => v).map(([k]) => k)
    if (!ids.length) return
    const formattedCount = formatNumberValue(ids.length, numberFormatter, '0')
    if (!confirm(t('bookmarks_confirm_delete', { count: formattedCount }))) return
    try {
      await v1.bulkDeleteBookmarksV1BookmarksBulkDeletePost({ requestBody: { ids, delete_remote: true } })
      setBanner({ kind: 'success', message: t('bookmarks_deleted_success', { count: formattedCount }) })
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
            <label className="flex flex-col gap-1" htmlFor="bookmark-tag">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-200">{t('bookmarks_tag_label')}</span>
              <select id="bookmark-tag" className="input" value={tagIdFilter} onChange={(e) => setTagIdFilter(e.target.value)}>
                <option value="">{t('bookmarks_tag_all')}</option>
                {tagItems.map((tag: any) => (
                  <option key={tag.id} value={tag.id}>{tag.name || t('bookmarks_tag_fallback')}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1" htmlFor="bookmark-folder">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-200">{t('bookmarks_folder_label')}</span>
              <select id="bookmark-folder" className="input" value={folderIdFilter} onChange={(e) => setFolderIdFilter(e.target.value)}>
                <option value="">{t('bookmarks_folder_all')}</option>
                {folderItems.map((folder: any) => (
                  <option key={folder.id} value={folder.id}>{folder.name || t('bookmarks_folder_fallback')}</option>
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
            {...({ defaultOpen: Boolean(titleQuery || urlQuery || regexPattern) } as any)}
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
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <section className="card p-4 space-y-4" aria-labelledby="bookmark-tags-heading">
            <div className="space-y-1">
              <h3 id="bookmark-tags-heading" className="text-lg font-semibold text-gray-900 dark:text-gray-100">{t('bookmarks_tags_heading')}</h3>
              <p className="text-sm text-gray-600 dark:text-gray-300">{t('bookmarks_tags_description')}</p>
            </div>
            <form className="flex flex-wrap items-center gap-2" onSubmit={handleCreateTag}>
              <label className="sr-only" htmlFor="bookmark-new-tag">{t('bookmarks_tags_name_label')}</label>
              <input
                id="bookmark-new-tag"
                className="input flex-1 min-w-[160px]"
                value={newTagName}
                onChange={(e) => setNewTagName(e.target.value)}
                placeholder={t('bookmarks_tags_create_placeholder')}
              />
              <button type="submit" className="btn" disabled={tagActionBusy}>{t('btn_create')}</button>
            </form>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn text-sm"
                onClick={() => { setTagIdFilter(''); setPage(1); }}
                disabled={!tagIdFilter}
              >
                {t('bookmarks_filter_clear_tag')}
              </button>
            </div>
            {tagsError && <Alert kind="error" message={String(tagsError)} />}
            <ul role="list" className="divide-y divide-gray-200 dark:divide-gray-700">
              {tagsLoading && !tagItems.length ? (
                <li className="py-2 text-sm text-gray-600 dark:text-gray-300">{t('loading_text')}</li>
              ) : tagItems.length === 0 ? (
                <li className="py-2 text-sm text-gray-600 dark:text-gray-300">{t('bookmarks_tags_empty')}</li>
              ) : (
                tagItems.map((tag: any) => (
                  <li key={tag.id} className="py-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex flex-col gap-1 sm:gap-2">
                      {tagEditId === tag.id ? (
                        <input
                          className="input"
                          value={tagEditName}
                          onChange={(e) => setTagEditName(e.target.value)}
                          aria-label={t('bookmarks_tags_edit_label', { name: tag.name || t('bookmarks_tag_fallback') })}
                        />
                      ) : (
                        <button
                          type="button"
                          className={`rounded px-2 py-1 text-left font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 ${tagIdFilter === tag.id ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-200' : 'hover:bg-gray-100 dark:hover:bg-gray-800'}`}
                          onClick={() => { setTagIdFilter(tag.id); setPage(1) }}
                          aria-pressed={tagIdFilter === tag.id}
                        >
                          {tag.name || t('bookmarks_tag_fallback')}
                        </button>
                      )}
                      <span className="text-xs text-gray-500 dark:text-gray-400">{t('bookmarks_manage_count', { count: formatNumberValue(tag.bookmark_count ?? 0, numberFormatter, '0') })}</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {tagEditId === tag.id ? (
                        <>
                          <button type="button" className="btn text-sm" onClick={handleSaveTag} disabled={tagActionBusy}>{t('btn_save')}</button>
                          <button type="button" className="btn text-sm" onClick={cancelEditTag}>{t('btn_cancel')}</button>
                        </>
                      ) : (
                        <>
                          <button type="button" className="btn text-sm" onClick={() => startEditTag(tag)} disabled={tagActionBusy}>{t('btn_edit')}</button>
                          <button type="button" className="btn text-sm" onClick={() => handleDeleteTag(tag)} disabled={tagActionBusy}>{t('btn_delete')}</button>
                        </>
                      )}
                    </div>
                  </li>
                ))
              )}
            </ul>
          </section>
          <section className="card p-4 space-y-4" aria-labelledby="bookmark-folders-heading">
            <div className="space-y-1">
              <h3 id="bookmark-folders-heading" className="text-lg font-semibold text-gray-900 dark:text-gray-100">{t('bookmarks_folders_heading')}</h3>
              <p className="text-sm text-gray-600 dark:text-gray-300">{t('bookmarks_folders_description')}</p>
            </div>
            <form className="grid grid-cols-1 sm:grid-cols-3 gap-2" onSubmit={handleCreateFolder}>
              <div className="flex flex-col gap-1">
                <label className="sr-only" htmlFor="bookmark-new-folder">{t('bookmarks_folders_name_label')}</label>
                <input
                  id="bookmark-new-folder"
                  className="input"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  placeholder={t('bookmarks_folders_create_placeholder')}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="sr-only" htmlFor="bookmark-new-folder-instapaper">{t('bookmarks_folder_instapaper_label')}</label>
                <input
                  id="bookmark-new-folder-instapaper"
                  className="input"
                  value={newFolderInstapaperId}
                  onChange={(e) => setNewFolderInstapaperId(e.target.value)}
                  placeholder={t('bookmarks_folder_instapaper_placeholder')}
                />
              </div>
              <div className="flex items-start">
                <button type="submit" className="btn w-full" disabled={folderActionBusy}>{t('btn_create')}</button>
              </div>
            </form>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn text-sm"
                onClick={() => { setFolderIdFilter(''); setPage(1); }}
                disabled={!folderIdFilter}
              >
                {t('bookmarks_filter_clear_folder')}
              </button>
            </div>
            {foldersError && <Alert kind="error" message={String(foldersError)} />}
            <ul role="list" className="divide-y divide-gray-200 dark:divide-gray-700">
              {foldersLoading && !folderItems.length ? (
                <li className="py-2 text-sm text-gray-600 dark:text-gray-300">{t('loading_text')}</li>
              ) : folderItems.length === 0 ? (
                <li className="py-2 text-sm text-gray-600 dark:text-gray-300">{t('bookmarks_folders_empty')}</li>
              ) : (
                folderItems.map((folder: any) => (
                  <li key={folder.id} className="py-2 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex flex-col gap-1">
                      {folderEditId === folder.id ? (
                        <>
                          <label className="sr-only" htmlFor={`bookmark-folder-edit-${folder.id}`}>{t('bookmarks_folders_edit_label', { name: folder.name || t('bookmarks_folder_fallback') })}</label>
                          <input
                            id={`bookmark-folder-edit-${folder.id}`}
                            className="input"
                            value={folderEditName}
                            onChange={(e) => setFolderEditName(e.target.value)}
                          />
                          <label className="sr-only" htmlFor={`bookmark-folder-edit-instapaper-${folder.id}`}>{t('bookmarks_folder_instapaper_edit_label')}</label>
                          <input
                            id={`bookmark-folder-edit-instapaper-${folder.id}`}
                            className="input"
                            value={folderEditInstapaperId}
                            onChange={(e) => setFolderEditInstapaperId(e.target.value)}
                            placeholder={t('bookmarks_folder_instapaper_placeholder')}
                          />
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            className={`rounded px-2 py-1 text-left font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 ${folderIdFilter === folder.id ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-200' : 'hover:bg-gray-100 dark:hover:bg-gray-800'}`}
                            onClick={() => { setFolderIdFilter(folder.id); setPage(1) }}
                            aria-pressed={folderIdFilter === folder.id}
                          >
                            {folder.name || t('bookmarks_folder_fallback')}
                          </button>
                          <span className="text-xs text-gray-500 dark:text-gray-400">
                            {folder.instapaper_folder_id
                              ? t('bookmarks_folder_instapaper_value', { value: folder.instapaper_folder_id })
                              : t('bookmarks_folder_instapaper_none')}
                          </span>
                        </>
                      )}
                      <span className="text-xs text-gray-500 dark:text-gray-400">{t('bookmarks_manage_count', { count: formatNumberValue(folder.bookmark_count ?? 0, numberFormatter, '0') })}</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {folderEditId === folder.id ? (
                        <>
                          <button type="button" className="btn text-sm" onClick={handleSaveFolder} disabled={folderActionBusy}>{t('btn_save')}</button>
                          <button type="button" className="btn text-sm" onClick={cancelEditFolder}>{t('btn_cancel')}</button>
                        </>
                      ) : (
                        <>
                          <button type="button" className="btn text-sm" onClick={() => startEditFolder(folder)} disabled={folderActionBusy}>{t('btn_edit')}</button>
                          <button type="button" className="btn text-sm" onClick={() => handleDeleteFolder(folder)} disabled={folderActionBusy}>{t('btn_delete')}</button>
                        </>
                      )}
                    </div>
                  </li>
                ))
              )}
            </ul>
          </section>
        </div>
        {banner && <div className="mb-3"><Alert kind={banner.kind} message={banner.message} onClose={() => setBanner(null)} /></div>}
        {isLoading && <p className="text-gray-600">{t('loading_text')}</p>}
        {error && <Alert kind="error" message={String(error)} />}
        {data && (
          <>
              <div className="card p-0 overflow-hidden">
              <div className="p-3 flex items-center gap-2">
                <button className="btn" disabled={!hasSelection || progress?.status === 'running'} onClick={bulkPublish}>{t('btn_publish_selected')}</button>
                <button className="btn" disabled={!hasSelection || progress?.status === 'running'} onClick={bulkDelete}>{t('btn_delete_selected')}</button>
                <button className="btn" disabled={!hasSelection || progress?.status === 'running'} onClick={() => exportSelected('json')}>{t('btn_export_json')}</button>
                <button className="btn" disabled={!hasSelection || progress?.status === 'running'} onClick={() => exportSelected('csv')}>{t('btn_export_csv')}</button>
              </div>
              {(!data.items || data.items.length === 0) ? (
                <div className="p-4">
                  <EmptyState
                    icon={<span>📭</span>}
                    message={(
                      <div className="space-y-1">
                        <p className="text-lg font-semibold text-gray-700">{t('empty_bookmarks_title')}</p>
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
              <table className="table" role="table" aria-label={t('bookmarks_table_label')}>
                <thead className="bg-gray-100">
                  <tr>
                    <th className="th" scope="col"><input aria-label={t('bookmarks_select_all')} type="checkbox" onChange={(e) => toggleAll(e.target.checked)} /></th>
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
                  {data.items.map((b: any) => (
                    <tr key={b.id} className="odd:bg-white even:bg-gray-50">
                      <td className="td"><input aria-label={t('bookmarks_select_row', { value: b.title || b.url || t('bookmarks_select_row_unknown') })} type="checkbox" checked={selected[b.id] || false} onChange={(e) => toggleOne(b.id, e.target.checked)} /></td>
                      <td className="td">{b.title}</td>
                      <td className="td"><a className="text-blue-600 hover:underline" href={b.url} target="_blank" rel="noreferrer">{b.url}</a></td>
                      <td className="td">{formatDateTimeValue(b.published_at, dateTimeFormatter, b.published_at || '')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              )}
            </div>
            <div className="mt-3 flex items-center gap-2">
              <button className="btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>{t('pagination_prev')}</button>
              <span className="text-gray-700">
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
      {progress && (
        <BulkPublishModal
          open={progress.open}
          status={progress.status}
          items={progress.items}
          summary={progress.summary}
          totalCount={progress.totalCount ?? progress.items.length}
          message={progress.message}
          errorMessage={progress.errorMessage}
          onCancel={progress.status === 'running' ? cancelPublish : undefined}
          onClose={closeProgress}
        />
      )}
    </div>
  )
}
