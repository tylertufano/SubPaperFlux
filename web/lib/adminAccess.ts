export type AdminCandidate = Record<string, unknown>

function includesAdminRole(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some((entry) => typeof entry === 'string' && entry.toLowerCase() === 'admin')
  }
  if (typeof value === 'string') {
    return value.toLowerCase() === 'admin'
  }
  return false
}

export function userHasAdminAccess(user: unknown): boolean {
  if (!user || typeof user !== 'object') {
    return false
  }
  const candidate = user as AdminCandidate
  if (typeof candidate.isAdmin === 'boolean') {
    return candidate.isAdmin
  }
  if (typeof candidate.is_admin === 'boolean') {
    return candidate.is_admin
  }
  const roleSources = [candidate.roles, candidate.groups, candidate.permissions, candidate.role, candidate.group]
  return roleSources.some((source) => includesAdminRole(source))
}
