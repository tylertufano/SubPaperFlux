export const PERMISSION_READ_GLOBAL_SITE_CONFIGS = 'site_configs:read'
export const PERMISSION_MANAGE_GLOBAL_SITE_CONFIGS = 'site_configs:manage'
export const PERMISSION_READ_GLOBAL_CREDENTIALS = 'credentials:read'
export const PERMISSION_MANAGE_GLOBAL_CREDENTIALS = 'credentials:manage'
export const PERMISSION_READ_BOOKMARKS = 'bookmarks:read'
export const PERMISSION_MANAGE_BOOKMARKS = 'bookmarks:manage'

export const ALL_PERMISSIONS = [
  PERMISSION_READ_GLOBAL_SITE_CONFIGS,
  PERMISSION_MANAGE_GLOBAL_SITE_CONFIGS,
  PERMISSION_READ_GLOBAL_CREDENTIALS,
  PERMISSION_MANAGE_GLOBAL_CREDENTIALS,
  PERMISSION_READ_BOOKMARKS,
  PERMISSION_MANAGE_BOOKMARKS,
] as const

export type Permission = (typeof ALL_PERMISSIONS)[number]

export const ADMIN_ROLE_NAME = 'admin'

export const ROLE_PERMISSIONS: Record<string, readonly Permission[]> = {
  [ADMIN_ROLE_NAME]: ALL_PERMISSIONS,
}

function isIterable(value: unknown): value is Iterable<unknown> {
  return typeof value === 'object' && value !== null && typeof (value as any)[Symbol.iterator] === 'function'
}

export function normalizeIdentifier(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed ? trimmed.toLowerCase() : null
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    const text = String(value).trim()
    return text ? text.toLowerCase() : null
  }
  return null
}

export function normalizeIdentifierList(values: unknown): string[] {
  const seen = new Set<string>()
  const result: string[] = []

  const visit = (value: unknown): void => {
    if (value === null || value === undefined) {
      return
    }
    if (Array.isArray(value)) {
      for (const entry of value) {
        visit(entry)
      }
      return
    }
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
      const normalized = normalizeIdentifier(value)
      if (normalized && !seen.has(normalized)) {
        seen.add(normalized)
        result.push(normalized)
      }
      return
    }
    if (isIterable(value)) {
      for (const entry of value as Iterable<unknown>) {
        visit(entry)
      }
    }
  }

  visit(values)
  return result
}

export function derivePermissionsFromRoles(roles: Iterable<string> | null | undefined): Permission[] {
  const normalizedRoles = normalizeIdentifierList(roles ?? [])
  const seen = new Set<Permission>()
  const permissions: Permission[] = []

  for (const role of normalizedRoles) {
    const rolePermissions = ROLE_PERMISSIONS[role]
    if (!rolePermissions) {
      continue
    }
    for (const permission of rolePermissions) {
      if (!seen.has(permission)) {
        seen.add(permission)
        permissions.push(permission)
      }
    }
  }

  return permissions
}

export function extractPermissionList(source: unknown): string[] {
  if (source === null || source === undefined) {
    return []
  }

  const values: unknown =
    typeof source === 'object' && source !== null && 'permissions' in (source as Record<string, unknown>)
      ? (source as { permissions?: unknown }).permissions
      : source

  const results: string[] = []

  const add = (candidate: unknown) => {
    if (typeof candidate !== 'string') {
      return
    }
    const trimmed = candidate.trim()
    if (trimmed) {
      results.push(trimmed)
    }
  }

  if (typeof values === 'string') {
    add(values)
    return results
  }

  if (Array.isArray(values)) {
    for (const entry of values) {
      add(entry)
    }
    return results
  }

  if (isIterable(values)) {
    for (const entry of values as Iterable<unknown>) {
      add(entry)
    }
  }

  return results
}

export function hasPermission(permissions: Iterable<string> | null | undefined, permission: Permission): boolean {
  if (!permission) {
    return false
  }
  if (!permissions) {
    return false
  }
  for (const candidate of permissions) {
    if (typeof candidate === 'string' && candidate === permission) {
      return true
    }
  }
  return false
}
