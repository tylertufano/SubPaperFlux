export type BreadcrumbItem = {
  label: string
  href?: string
}

const breadcrumbKeyMap: Record<string, string> = {
  '/': 'breadcrumb_home',
  '/bookmarks': 'nav_bookmarks',
  '/credentials': 'credentials_title',
  '/feeds': 'feeds_title',
  '/jobs': 'jobs_title',
  '/jobs-dead': 'nav_jobs_dead',
  '/site-configs': 'site_configs_title',

  // Admin navigation
  '/admin': 'nav_admin',
  '/admin/users': 'nav_users',
  '/admin/roles': 'nav_roles',
  '/admin/orgs': 'nav_orgs',
  '/admin/audit': 'nav_audit',
  '/me': 'nav_profile',
  '/me/tokens': 'nav_tokens',
}

function formatSegment(segment: string) {
  const decoded = decodeURIComponent(segment)
  return decoded
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

export function buildBreadcrumbs(
  pathname: string,
  translate: (key: string, vars?: Record<string, string | number>) => string,
): BreadcrumbItem[] {
  const segments = pathname.split('/').filter(Boolean)
  const items: BreadcrumbItem[] = []
  const homeKey = breadcrumbKeyMap['/'] ?? 'breadcrumb_home'
  const homeLabel = translate(homeKey)

  if (segments.length === 0) {
    items.push({ label: homeLabel })
    return items
  }

  items.push({ label: homeLabel, href: '/' })

  let currentPath = ''
  segments.forEach((segment, index) => {
    currentPath += `/${segment}`
    const key = breadcrumbKeyMap[currentPath]
    const label = key ? translate(key) : formatSegment(segment)
    const isLast = index === segments.length - 1
    items.push({ label, href: isLast ? undefined : currentPath })
  })

  if (items.length > 0) {
    items[items.length - 1].href = undefined
  }

  return items
}

