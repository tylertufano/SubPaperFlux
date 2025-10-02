import { describe, expect, it } from 'vitest'
import { serializeSiteConfigRequest } from '../lib/openapi'

describe('serializeSiteConfigRequest', () => {
  it('converts selenium configs to API payload shape', () => {
    const payload = serializeSiteConfigRequest({
      loginType: 'selenium',
      name: 'Example Login',
      siteUrl: 'https://example.com/login',
      successTextClass: 'alert',
      expectedSuccessText: 'Welcome',
      requiredCookies: ['session'],
      seleniumConfig: {
        usernameSelector: '#user',
        passwordSelector: '#pass',
        loginButtonSelector: 'button[type="submit"]',
        postLoginSelector: '.done',
        cookiesToStore: ['session', 'prefs'],
      },
    })

    expect(payload).toMatchObject({
      login_type: 'selenium',
      site_url: 'https://example.com/login',
      selenium_config: {
        username_selector: '#user',
        password_selector: '#pass',
        login_button_selector: 'button[type="submit"]',
        post_login_selector: '.done',
        cookies_to_store: ['session', 'prefs'],
      },
      required_cookies: ['session'],
    })
  })

  it('converts API configs to API payload shape', () => {
    const payload = serializeSiteConfigRequest({
      loginType: 'api',
      name: 'API Login',
      siteUrl: 'https://api.example/login',
      successTextClass: 'toast',
      expectedSuccessText: 'Ready',
      requiredCookies: ['session'],
      apiConfig: {
        endpoint: 'https://api.example/login',
        method: 'POST',
        headers: { 'X-Test': 'value' },
        body: { username: '{{credential.username}}' },
        cookies: { session: '{{credential.password}}' },
      },
    })

    expect(payload).toMatchObject({
      login_type: 'api',
      site_url: 'https://api.example/login',
      api_config: {
        endpoint: 'https://api.example/login',
        method: 'POST',
        headers: { 'X-Test': 'value' },
        body: { username: '{{credential.username}}' },
        cookies: { session: '{{credential.password}}' },
      },
      required_cookies: ['session'],
    })
  })
})
