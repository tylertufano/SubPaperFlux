import { FormEvent, useMemo, useState } from 'react'
import useSWR from 'swr'
import { Alert, Breadcrumbs, Nav } from '../components'
import { buildBreadcrumbs } from '../lib/breadcrumbs'
import { useRouter } from 'next/router'
import { useI18n } from '../lib/i18n'
import { useSessionReauth } from '../lib/useSessionReauth'
import {
  extractPermissionList,
  hasPermission,
  PERMISSION_MANAGE_BOOKMARKS,
  PERMISSION_READ_BOOKMARKS,
} from '../lib/rbac'
import { v1 } from '../lib/openapi'
import type { TagOut } from '../sdk/src/models/TagOut'
import type { FolderOut } from '../sdk/src/models/FolderOut'
import { formatNumberValue, useNumberFormatter } from '../lib/format'

type ItemsSource<T> = T[] | { items?: T[] }

function extractItems<T>(source: ItemsSource<T> | undefined): T[] {
  return Array.isArray(source) ? source : source?.items ?? []
}

export default function FoldersTagsPage() {
  const { t } = useI18n()
  const router = useRouter()
  const { data: session, status } = useSessionReauth()
  const breadcrumbs = useMemo(() => buildBreadcrumbs(router.pathname, t), [router.pathname, t])
  const permissions = extractPermissionList(session?.user)
  const numberFormatter = useNumberFormatter()
  const isAuthenticated = status === 'authenticated'
  const canViewBookmarks = Boolean(
    isAuthenticated &&
      (hasPermission(permissions, PERMISSION_READ_BOOKMARKS) ||
        hasPermission(permissions, PERMISSION_MANAGE_BOOKMARKS)),
  )
  const {
    data: tagsData,
    error: tagsError,
    isLoading: tagsLoading,
    mutate: mutateTags,
  } = useSWR<ItemsSource<TagOut>>(
    canViewBookmarks ? ['/v1/bookmarks/tags', 'manage'] : null,
    () => v1.listTagsBookmarksTagsGet(),
  )
  const tagItems = extractItems(tagsData)
  const {
    data: foldersData,
    error: foldersError,
    isLoading: foldersLoading,
    mutate: mutateFolders,
  } = useSWR<ItemsSource<FolderOut>>(
    canViewBookmarks ? ['/v1/bookmarks/folders', 'manage'] : null,
    () => v1.listFoldersBookmarksFoldersGet(),
  )
  const folderItems = extractItems(foldersData)
  const [banner, setBanner] = useState<{ kind: 'success' | 'error'; message: string } | null>(null)
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
      mutateTags()
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
      mutateFolders()
    } catch (err: any) {
      setBanner({ kind: 'error', message: t('bookmarks_folder_action_failed', { reason: err?.message || String(err) }) })
    } finally {
      setFolderActionBusy(false)
    }
  }
 
  return (
    <div>
      <Nav />
      <Breadcrumbs items={breadcrumbs} />
      <main className="container py-6 space-y-4">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold">{t('folders_tags_title')}</h1>
        </div>
        {banner && (
          <div className="max-w-2xl">
            <Alert kind={banner.kind} message={banner.message} onClose={() => setBanner(null)} />
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <section className="card p-4 space-y-4" aria-labelledby="manage-tags-heading">
            <div className="space-y-1">
              <h2 id="manage-tags-heading" className="text-lg font-semibold text-gray-900 dark:text-gray-100">{t('bookmarks_tags_heading')}</h2>
              <p className="text-sm text-gray-600 dark:text-gray-300">{t('bookmarks_tags_description')}</p>
            </div>
            <form className="flex flex-wrap items-center gap-2" onSubmit={handleCreateTag}>
              <label className="sr-only" htmlFor="manage-new-tag">{t('bookmarks_tags_name_label')}</label>
              <input
                id="manage-new-tag"
                className="input flex-1 min-w-[160px]"
                value={newTagName}
                onChange={(e) => setNewTagName(e.target.value)}
                placeholder={t('bookmarks_tags_create_placeholder')}
              />
              <button type="submit" className="btn" disabled={tagActionBusy}>{t('btn_create')}</button>
            </form>
            {tagsError && <Alert kind="error" message={String(tagsError)} />}
            <ul role="list" className="divide-y divide-gray-200 dark:divide-gray-700">
              {tagsLoading && !tagItems.length ? (
                <li className="py-2 text-sm text-gray-600 dark:text-gray-300">{t('loading_text')}</li>
              ) : tagItems.length === 0 ? (
                <li className="py-2 text-sm text-gray-600 dark:text-gray-300">{t('bookmarks_tags_empty')}</li>
              ) : (
                tagItems.map((tag: any) => (
                  <li key={tag.id} className="py-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex flex-col gap-1">
                      {tagEditId === tag.id ? (
                        <input
                          className="input"
                          value={tagEditName}
                          onChange={(e) => setTagEditName(e.target.value)}
                          aria-label={t('bookmarks_tags_edit_label', { name: tag.name || t('bookmarks_tag_fallback') })}
                        />
                      ) : (
                        <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                          {tag.name || t('bookmarks_tag_fallback')}
                        </span>
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
          <section className="card p-4 space-y-4" aria-labelledby="manage-folders-heading">
            <div className="space-y-1">
              <h2 id="manage-folders-heading" className="text-lg font-semibold text-gray-900 dark:text-gray-100">{t('bookmarks_folders_heading')}</h2>
              <p className="text-sm text-gray-600 dark:text-gray-300">{t('bookmarks_folders_description')}</p>
            </div>
            <form className="grid grid-cols-1 sm:grid-cols-3 gap-2" onSubmit={handleCreateFolder}>
              <div className="flex flex-col gap-1">
                <label className="sr-only" htmlFor="manage-new-folder">{t('bookmarks_folders_name_label')}</label>
                <input
                  id="manage-new-folder"
                  className="input"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  placeholder={t('bookmarks_folders_create_placeholder')}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="sr-only" htmlFor="manage-new-folder-instapaper">{t('bookmarks_folder_instapaper_label')}</label>
                <input
                  id="manage-new-folder-instapaper"
                  className="input"
                  value={newFolderInstapaperId}
                  onChange={(e) => setNewFolderInstapaperId(e.target.value)}
                  placeholder={t('bookmarks_folder_instapaper_placeholder')}
                />
              </div>
              <button type="submit" className="btn w-full" disabled={folderActionBusy}>{t('btn_create')}</button>
            </form>
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
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <label className="sr-only" htmlFor={`manage-folder-edit-${folder.id}`}>{t('bookmarks_folders_edit_label', { name: folder.name || t('bookmarks_folder_fallback') })}</label>
                          <input
                            id={`manage-folder-edit-${folder.id}`}
                            className="input"
                            value={folderEditName}
                            onChange={(e) => setFolderEditName(e.target.value)}
                          />
                          <label className="sr-only" htmlFor={`manage-folder-edit-instapaper-${folder.id}`}>{t('bookmarks_folder_instapaper_edit_label')}</label>
                          <input
                            id={`manage-folder-edit-instapaper-${folder.id}`}
                            className="input"
                            value={folderEditInstapaperId}
                            onChange={(e) => setFolderEditInstapaperId(e.target.value)}
                            placeholder={t('bookmarks_folder_instapaper_placeholder')}
                          />
                        </div>
                      ) : (
                        <div className="space-y-1">
                          <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                            {folder.name || t('bookmarks_folder_fallback')}
                          </span>
                          <span className="text-xs text-gray-500 dark:text-gray-400">
                            {folder.instapaper_folder_id
                              ? t('bookmarks_folder_instapaper_value', { value: folder.instapaper_folder_id })
                              : t('bookmarks_folder_instapaper_none')}
                          </span>
                        </div>
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
      </main>
    </div>
  )
 }

