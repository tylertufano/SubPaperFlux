import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'

type Messages = Record<string, string>
type Catalog = Record<string, Messages>

const catalog: Catalog = {
  en: {
    home_welcome: 'Welcome. Use the navigation to explore bookmarks, jobs, and admin tools.',
    nav_bookmarks: 'Bookmarks',
    nav_jobs: 'Jobs',
    nav_jobs_all: 'All Jobs',
    nav_jobs_dead: 'Dead-letter Queue',
    nav_credentials: 'Credentials',
    nav_site_configs: 'Site Configs',
    nav_admin: 'Admin',
    nav_feeds: 'Feeds',
    nav_feeds_all: 'All Feeds',
    nav_feeds_create: 'Create Feed',
    nav_profile: 'Profile',
    nav_tokens: 'API Tokens',
    nav_users: 'Users',
    nav_audit: 'Audit Log',
    btn_sign_in: 'Sign in',
    btn_sign_out: 'Sign out',
    bookmarks_title: 'Bookmarks',
    bookmarks_search: 'Search',
    bookmarks_saved_views: 'Saved Views',
    bookmarks_save_as: 'Save as...',
    bookmarks_save_view: 'Save View',
    bookmarks_saved_views_placeholder: 'Apply a saved view',
    bookmarks_saved_views_empty: 'No saved views yet',
    bookmarks_keyword_label: 'Keyword',
    bookmarks_keyword_placeholder: 'Search titles or URLs',
    bookmarks_feed_label: 'Feed',
    bookmarks_feed_all: 'All feeds',
    bookmarks_since_label: 'Since',
    bookmarks_until_label: 'Until',
    bookmarks_advanced: 'Advanced search',
    bookmarks_title_contains: 'Title contains',
    bookmarks_title_placeholder: 'Match words in the title',
    bookmarks_url_contains: 'URL contains',
    bookmarks_url_placeholder: 'Match words in the URL',
    bookmarks_regex_label: 'Regex pattern',
    bookmarks_regex_placeholder: '/pattern/ or (?i)pattern',
    bookmarks_regex_target: 'Apply to',
    bookmarks_regex_target_both: 'Title & URL',
    bookmarks_regex_target_title: 'Title only',
    bookmarks_regex_target_url: 'URL only',
    bookmarks_regex_case_insensitive: 'Case-insensitive',
    bookmarks_regex_help: 'Regex is available on Postgres deployments. Use /pattern/i for case-insensitive matches.',
    bookmarks_sort_label: 'Sort by',
    bookmarks_sort_published: 'Published',
    bookmarks_sort_title: 'Title',
    bookmarks_sort_url: 'URL',
    bookmarks_sort_relevance: 'Relevance',
    bookmarks_sort_direction: 'Direction',
    bookmarks_sort_desc: 'Descending',
    bookmarks_sort_asc: 'Ascending',
    bookmarks_confirm_delete: 'Delete {count} bookmarks? This also deletes in Instapaper.',
    bookmarks_deleted_success: 'Deleted {count} bookmarks.',
    bookmarks_delete_failed: 'Delete failed: {reason}',
    bookmarks_table_label: 'Bookmarks list',
    bookmarks_select_all: 'Select all bookmarks',
    bookmarks_select_row: 'Select bookmark {value}',
    bookmarks_select_row_unknown: 'without title',
    jobs_title: 'Jobs',
    credentials_title: 'Credentials',
    site_configs_title: 'Site Configs',
    feeds_title: 'Feeds',
    btn_clear_filters: 'Clear Filters',
    btn_search: 'Search',
    btn_clear: 'Clear',
    btn_create: 'Create',
    btn_delete: 'Delete',
    btn_edit: 'Edit',
    btn_save: 'Save',
    btn_cancel: 'Cancel',
    btn_retry: 'Retry',
    btn_retry_all_failed_dead: 'Retry All Failed/Dead',
    btn_export_json: 'Export JSON',
    btn_export_csv: 'Export CSV',
    btn_delete_selected: 'Delete Selected',
    loading_text: 'Loading...',
    status_label: 'Status',
    id_label: 'ID',
    type_label: 'Type',
    attempts_label: 'Attempts',
    last_error_label: 'Last Error',
    actions_label: 'Actions',
    url_label: 'URL',
    poll_label: 'Poll',
    lookback_label: 'Lookback',
    paywalled_label: 'Paywalled',
    rss_auth_label: 'RSS Auth',
    site_config_label: 'Site Config',
    title_label: 'Title',
    published_label: 'Published',
    empty_bookmarks_title: 'No bookmarks found',
    empty_bookmarks_desc: 'Try adjusting filters or disable fuzzy search.',
    empty_jobs_title: 'No jobs match this filter',
    empty_jobs_desc: 'Try a different status or clear filters to see all jobs.',
    empty_feeds_title: 'No feeds yet',
    empty_feeds_desc: 'Create your first feed using the form above.',
    empty_credentials_title: 'No credentials yet',
    empty_credentials_desc: 'Create site, Instapaper, or Miniflux credentials above.',
    empty_site_configs_title: 'No site configs yet',
    empty_site_configs_desc: 'Create a site config above to automate site logins.',
    pagination_prev: 'Prev',
    pagination_next: 'Next',
    pagination_status: 'Page {page} / {total}',
  },
}

type I18nCtx = { locale: string; setLocale: (l: string) => void; t: (k: string, vars?: Record<string, string | number>) => string }
const Ctx = createContext<I18nCtx>({ locale: 'en', setLocale: () => {}, t: (k) => k })

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocale] = useState('en')
  useEffect(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem('locale') : null
    if (saved) setLocale(saved)
  }, [])
  const t = useMemo(() => {
    const messages = catalog[locale] || catalog.en
    return (k: string, vars?: Record<string, string | number>) => {
      const template = messages[k] ?? k
      if (!vars) return template
      return template.replace(/\{(\w+)\}/g, (_, key) => (key in vars ? String(vars[key]) : ''))
    }
  }, [locale])
  const setL = (l: string) => { setLocale(l); if (typeof window !== 'undefined') localStorage.setItem('locale', l) }
  return <Ctx.Provider value={{ locale, setLocale: setL, t }}>{children}</Ctx.Provider>
}

export function useI18n() { return useContext(Ctx) }
