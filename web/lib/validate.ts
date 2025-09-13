export function isValidUrl(value: string): boolean {
  try { new URL(value); return true } catch { return false }
}

export function parseJsonSafe<T = any>(value: string): { ok: true; data: T } | { ok: false; error: string } {
  try { return { ok: true, data: JSON.parse(value) } } catch (e: any) { return { ok: false, error: e?.message || 'Invalid JSON' } }
}

export function validateCredential(kind: string, data: any): string | null {
  if (!data || typeof data !== 'object') return 'Data must be a JSON object'
  if (kind === 'site_login') {
    if (!data.username) return 'username is required'
    if (!data.password) return 'password is required'
    return null
  }
  if (kind === 'miniflux') {
    if (!data.miniflux_url || !isValidUrl(data.miniflux_url)) return 'miniflux_url is invalid'
    if (!data.api_key) return 'api_key is required'
    return null
  }
  if (kind === 'instapaper') {
    if (!data.oauth_token) return 'oauth_token is required'
    if (!data.oauth_token_secret) return 'oauth_token_secret is required'
    return null
  }
  if (kind === 'instapaper_app') {
    if (!data.consumer_key) return 'consumer_key is required'
    if (!data.consumer_secret) return 'consumer_secret is required'
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

