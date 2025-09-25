export function isValidUrl(value: string): boolean {
  try { new URL(value); return true } catch { return false }
}

export function parseJsonSafe<T = any>(value: string): { ok: true; data: T } | { ok: false; error: string } {
  try { return { ok: true, data: JSON.parse(value) } } catch (e: any) { return { ok: false, error: e?.message || 'Invalid JSON' } }
}

export function validateCredential(
  kind: string,
  data: any,
  description?: string,
  siteConfigId?: string | null,
): string | null {
  const trimmedDescription = typeof description === 'string' ? description.trim() : ''
  if (!trimmedDescription) return 'description is required'
  if (!data || typeof data !== 'object') return 'Data must be a JSON object'
  if (kind === 'site_login') {
    const resolvedSiteConfigId = typeof siteConfigId === 'string' ? siteConfigId.trim() : ''
    if (!resolvedSiteConfigId) return 'site_config_id is required'
    const username = typeof data.username === 'string' ? data.username.trim() : ''
    const password = typeof data.password === 'string' ? data.password.trim() : ''
    if (!username) return 'username is required'
    if (!password) return 'password is required'
    return null
  }
  if (kind === 'miniflux') {
    const url = typeof data.miniflux_url === 'string' ? data.miniflux_url.trim() : ''
    const apiKey = typeof data.api_key === 'string' ? data.api_key.trim() : ''
    if (!url || !isValidUrl(url)) return 'miniflux_url is invalid'
    if (!apiKey) return 'api_key is required'
    return null
  }
  if (kind === 'instapaper') {
    const username = typeof data.username === 'string' ? data.username.trim() : ''
    const password = typeof data.password === 'string' ? data.password.trim() : ''
    if (!username) return 'username is required'
    if (!password) return 'password is required'
    return null
  }
  if (kind === 'instapaper_app') {
    const consumerKey = typeof data.consumer_key === 'string' ? data.consumer_key.trim() : ''
    const consumerSecret = typeof data.consumer_secret === 'string' ? data.consumer_secret.trim() : ''
    if (!consumerKey) return 'consumer_key is required'
    if (!consumerSecret) return 'consumer_secret is required'
    return null
  }
  return null
}

export function validateSiteConfig(form: { name: string; site_url: string; username_selector: string; password_selector: string; login_button_selector: string; }): string | null {
  if (!form.name?.trim()) return 'Name is required'
  if (!form.site_url || !isValidUrl(form.site_url)) return 'Site URL is invalid'
  if (!form.username_selector?.trim()) return 'Username selector is required'
  if (!form.password_selector?.trim()) return 'Password selector is required'
  if (!form.login_button_selector?.trim()) return 'Login button selector is required'
  return null
}

