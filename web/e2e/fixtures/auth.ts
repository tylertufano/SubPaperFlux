import {
  test as base,
  expect,
  type Fixtures,
  type Page,
  type PlaywrightTestArgs,
  type PlaywrightTestOptions,
  type PlaywrightWorkerArgs,
  type PlaywrightWorkerOptions,
  type TestType,
} from '@playwright/test'
import { createHash, randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { URL } from 'node:url'
import { SignJWT, exportJWK, generateKeyPair, type JWK, type KeyLike } from 'jose'

const DEFAULT_STUB_PORT = Number(process.env.OIDC_STUB_PORT ?? 4455)
const DEFAULT_CLIENT_ID = process.env.OIDC_CLIENT_ID ?? 'local'
const DEFAULT_CLIENT_SECRET = process.env.OIDC_CLIENT_SECRET ?? 'local'
const DEFAULT_AUDIENCE = process.env.OIDC_AUDIENCE ?? DEFAULT_CLIENT_ID
const DEFAULT_ISSUER = process.env.OIDC_ISSUER ?? `http://127.0.0.1:${DEFAULT_STUB_PORT}/oidc`
const DEFAULT_SCOPE = 'openid profile email groups'
const TOKEN_TTL_SECONDS = 60 * 60

export type TestUser = {
  sub: string
  email: string
  name: string
  groups: string[]
  claims?: Record<string, unknown>
}

export type OidcTokens = {
  accessToken: string
  idToken: string
  user: TestUser
}

export type AuthSession = {
  user?: {
    name?: string | null
    email?: string | null
    image?: string | null
  }
  accessToken?: string
  idToken?: string
  expires?: string
  [key: string]: unknown
}

const DEFAULT_TEST_USER: TestUser = {
  sub: 'user-e2e',
  email: 'playwright@example.com',
  name: 'Playwright Tester',
  groups: ['admin'],
  claims: {
    roles: ['admin'],
  },
}

type AuthorizationRecord = {
  redirectUri: string
  state?: string | null
  codeChallenge?: string | null
  codeChallengeMethod?: string | null
  nonce?: string | null
  clientId?: string | null
  user: TestUser
}

function cloneUser(user: TestUser): TestUser {
  return {
    ...user,
    groups: [...user.groups],
    claims: user.claims ? { ...user.claims } : undefined,
  }
}

function toBase64Url(buffer: Buffer): string {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

async function readFormBody(req: IncomingMessage): Promise<URLSearchParams> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  }
  const body = Buffer.concat(chunks).toString('utf8')
  return new URLSearchParams(body)
}

class OidcStub {
  private readonly port: number
  private readonly clientId: string
  private readonly clientSecret: string
  private readonly audience: string
  private readonly scope: string
  private readonly issuer: string
  private readonly basePath: string
  private readonly jwksPath: string
  private readonly authorizePath: string
  private readonly tokenPath: string
  private readonly userInfoPath: string
  private readonly keyId: string
  private server?: Server
  private startPromise: Promise<void> | null = null
  private signingKey?: KeyLike
  private publicJwk?: JWK
  private codes = new Map<string, AuthorizationRecord>()
  private defaultUser: TestUser
  private currentUser: TestUser

  constructor(options?: {
    port?: number
    clientId?: string
    clientSecret?: string
    audience?: string
    issuer?: string
    scope?: string
    keyId?: string
    user?: TestUser
  }) {
    this.port = options?.port ?? DEFAULT_STUB_PORT
    this.clientId = options?.clientId ?? DEFAULT_CLIENT_ID
    this.clientSecret = options?.clientSecret ?? DEFAULT_CLIENT_SECRET
    this.audience = options?.audience ?? DEFAULT_AUDIENCE
    this.scope = options?.scope ?? DEFAULT_SCOPE
    this.issuer = (options?.issuer ?? DEFAULT_ISSUER).replace(/\/$/, '')
    const issuerUrl = new URL(this.issuer)
    this.basePath = issuerUrl.pathname || '/oidc'
    this.jwksPath = `${this.basePath}/jwks`
    this.authorizePath = `${this.basePath}/authorize`
    this.tokenPath = `${this.basePath}/token`
    this.userInfoPath = `${this.basePath}/userinfo`
    this.keyId = options?.keyId ?? 'stub-key'
    this.defaultUser = cloneUser(options?.user ?? DEFAULT_TEST_USER)
    this.currentUser = cloneUser(this.defaultUser)
  }

  get baseIssuer(): string {
    return this.issuer
  }

  get jwksUri(): string {
    return `${this.issuer}${this.jwksPath}`
  }

  get authorizationEndpoint(): string {
    return `${this.issuer}${this.authorizePath}`
  }

  get tokenEndpoint(): string {
    return `${this.issuer}${this.tokenPath}`
  }

  get userInfoEndpoint(): string {
    return `${this.issuer}${this.userInfoPath}`
  }

  async ensureStarted(): Promise<void> {
    if (this.server) return
    if (!this.startPromise) {
      this.startPromise = this.startServer()
    }
    await this.startPromise
  }

  async stop(): Promise<void> {
    if (!this.server) return
    await new Promise<void>((resolve) => {
      this.server?.close(() => resolve())
    })
    this.server = undefined
    this.startPromise = null
    this.codes.clear()
  }

  setUser(user: TestUser | Partial<TestUser>): void {
    const merged: TestUser = {
      ...this.defaultUser,
      ...user,
      groups: Array.isArray(user.groups) ? [...user.groups] : [...this.defaultUser.groups],
      claims: {
        ...(this.defaultUser.claims ?? {}),
        ...(user.claims ?? {}),
      },
    }
    this.currentUser = merged
  }

  resetUser(): void {
    this.currentUser = cloneUser(this.defaultUser)
  }

  async issueTokens(overrides?: Partial<TestUser>, options?: { nonce?: string | null }): Promise<OidcTokens> {
    await this.ensureStarted()
    const baseUser = overrides ? { ...this.currentUser, ...overrides } : this.currentUser
    const user = cloneUser(baseUser)
    if (overrides?.claims) {
      user.claims = { ...(user.claims ?? {}), ...overrides.claims }
    }
    const now = Math.floor(Date.now() / 1000)
    const idTokenPayload: Record<string, unknown> = {
      sub: user.sub,
      email: user.email,
      name: user.name,
      groups: user.groups,
      ...user.claims,
    }
    if (options?.nonce) {
      idTokenPayload.nonce = options.nonce
    }
    const idToken = await new SignJWT(idTokenPayload)
      .setProtectedHeader({ alg: 'RS256', kid: this.keyId })
      .setIssuer(this.issuer)
      .setAudience(this.clientId)
      .setIssuedAt(now)
      .setExpirationTime(now + TOKEN_TTL_SECONDS)
      .sign(this.signingKey as KeyLike)

    const accessTokenPayload: Record<string, unknown> = {
      sub: user.sub,
      email: user.email,
      name: user.name,
      groups: user.groups,
      scope: this.scope,
      ...user.claims,
    }
    const accessToken = await new SignJWT(accessTokenPayload)
      .setProtectedHeader({ alg: 'RS256', kid: this.keyId })
      .setIssuer(this.issuer)
      .setAudience(this.audience)
      .setIssuedAt(now)
      .setExpirationTime(now + TOKEN_TTL_SECONDS)
      .sign(this.signingKey as KeyLike)

    return {
      accessToken,
      idToken,
      user,
    }
  }

  private async startServer(): Promise<void> {
    const { privateKey, publicKey } = await generateKeyPair('RS256')
    this.signingKey = privateKey
    const jwk = await exportJWK(publicKey)
    this.publicJwk = {
      ...jwk,
      use: 'sig',
      alg: 'RS256',
      kid: this.keyId,
    }

    this.server = createServer((req, res) => {
      void this.handleRequest(req, res)
    })

    await new Promise<void>((resolve) => {
      this.server!.listen(this.port, '127.0.0.1', () => resolve())
    })
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${this.port}`)
      if (req.method === 'GET' &&
          (url.pathname === `${this.basePath}/.well-known/openid-configuration`)) {
        this.respondJson(res, this.discoveryDocument())
        return
      }
      if (req.method === 'GET' &&
          (url.pathname === this.jwksPath || url.pathname === `${this.basePath}/.well-known/jwks.json`)) {
        this.respondJson(res, { keys: [this.publicJwk] })
        return
      }
      if (req.method === 'GET' && url.pathname === this.authorizePath) {
        this.handleAuthorize(url, res)
        return
      }
      if (req.method === 'POST' && url.pathname === this.tokenPath) {
        await this.handleToken(req, res)
        return
      }
      if (req.method === 'GET' && url.pathname === this.userInfoPath) {
        this.respondJson(res, this.userInfo())
        return
      }
      res.statusCode = 404
      res.end('Not Found')
    } catch (error) {
      res.statusCode = 500
      res.end('OIDC stub error')
      console.error('[playwright][oidc-stub] Error handling request:', error)
    }
  }

  private discoveryDocument(): Record<string, unknown> {
    return {
      issuer: this.issuer,
      authorization_endpoint: this.authorizationEndpoint,
      token_endpoint: this.tokenEndpoint,
      userinfo_endpoint: this.userInfoEndpoint,
      jwks_uri: this.jwksUri,
      response_types_supported: ['code'],
      subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['RS256'],
      token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
      code_challenge_methods_supported: ['plain', 'S256'],
      scopes_supported: this.scope.split(' '),
    }
  }

  private handleAuthorize(url: URL, res: ServerResponse): void {
    const redirectUri = url.searchParams.get('redirect_uri')
    if (!redirectUri) {
      res.statusCode = 400
      res.end('Missing redirect_uri')
      return
    }
    const state = url.searchParams.get('state')
    const codeChallenge = url.searchParams.get('code_challenge')
    const codeChallengeMethod = url.searchParams.get('code_challenge_method')
    const nonce = url.searchParams.get('nonce')
    const clientId = url.searchParams.get('client_id')
    const code = randomBytes(16).toString('hex')
    this.codes.set(code, {
      redirectUri,
      state,
      codeChallenge,
      codeChallengeMethod,
      nonce,
      clientId,
      user: cloneUser(this.currentUser),
    })
    const target = new URL(redirectUri)
    target.searchParams.set('code', code)
    if (state) target.searchParams.set('state', state)
    res.statusCode = 302
    res.setHeader('Location', target.toString())
    res.setHeader('Cache-Control', 'no-store')
    res.end()
  }

  private async handleToken(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const params = await readFormBody(req)
    const code = params.get('code')
    if (!code || !this.codes.has(code)) {
      res.statusCode = 400
      res.end('Invalid code')
      return
    }
    const record = this.codes.get(code)!
    const verifier = params.get('code_verifier') ?? ''
    if (record.codeChallenge) {
      const method = (record.codeChallengeMethod || 'plain').toLowerCase()
      let expected = record.codeChallenge
      let actual = verifier
      if (method === 's256') {
        if (!verifier) {
          this.codes.delete(code)
          res.statusCode = 400
          res.end('PKCE verification failed')
          return
        }
        actual = toBase64Url(createHash('sha256').update(verifier).digest())
      }
      if (!verifier || actual !== expected) {
        res.statusCode = 400
        res.end('PKCE verification failed')
        this.codes.delete(code)
        return
      }
    }
    const clientId = params.get('client_id')
    const clientSecret = params.get('client_secret')
    const authHeader = req.headers['authorization']
    if (authHeader?.startsWith('Basic ')) {
      const decoded = Buffer.from(authHeader.slice('Basic '.length), 'base64').toString('utf8')
      const [id, secret] = decoded.split(':')
      if (id !== this.clientId || secret !== this.clientSecret) {
        res.statusCode = 401
        res.end('Invalid client credentials')
        this.codes.delete(code)
        return
      }
    } else if ((clientId && clientId !== this.clientId) || (clientSecret && clientSecret !== this.clientSecret)) {
      res.statusCode = 401
      res.end('Invalid client credentials')
      this.codes.delete(code)
      return
    }

    const tokens = await this.issueTokens(record.user, { nonce: record.nonce })
    this.codes.delete(code)
    const body = {
      access_token: tokens.accessToken,
      id_token: tokens.idToken,
      token_type: 'Bearer',
      expires_in: TOKEN_TTL_SECONDS,
      scope: this.scope,
    }
    this.respondJson(res, body)
  }

  private userInfo(): Record<string, unknown> {
    const user = this.currentUser
    return {
      sub: user.sub,
      email: user.email,
      name: user.name,
      groups: user.groups,
      ...user.claims,
    }
  }

  private respondJson(res: ServerResponse, body: unknown): void {
    res.statusCode = 200
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Pragma', 'no-cache')
    res.end(JSON.stringify(body))
  }
}

async function fetchSession(page: Page): Promise<AuthSession> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const session = await page.evaluate(async () => {
      try {
        const response = await fetch('/api/auth/session')
        if (!response.ok) return null
        return (await response.json()) as AuthSession
      } catch {
        return null
      }
    })
    if (session && typeof session === 'object' && session.user) {
      return session
    }
    await page.waitForTimeout(200)
  }
  throw new Error('Unable to retrieve authenticated session from NextAuth')
}

async function authenticatePage(page: Page, baseURL: string, oidc: OidcStub, redirectPath = '/'): Promise<AuthSession> {
  await oidc.ensureStarted()
  const callbackUrl = new URL(redirectPath, baseURL).toString()
  const expectedUrl = new URL(redirectPath || '/', baseURL)
  const signInUrl = new URL('/api/auth/signin/oidc', baseURL)
  signInUrl.searchParams.set('callbackUrl', callbackUrl)
  await page.goto(signInUrl.toString(), { waitUntil: 'networkidle' })
  const normalizePathname = (pathname: string) => {
    const normalized = pathname.replace(/\/+$/, '')
    return normalized === '' ? '/' : normalized
  }
  const expectedPath = normalizePathname(expectedUrl.pathname)
  await page.waitForURL(
    (url) => url.origin === expectedUrl.origin && normalizePathname(url.pathname) === expectedPath,
    { waitUntil: 'domcontentloaded' },
  )
  return fetchSession(page)
}

type BaseTestArgs = PlaywrightTestArgs & PlaywrightTestOptions
type BaseWorkerArgs = PlaywrightWorkerArgs & PlaywrightWorkerOptions

type ExtendWithWorker = <T extends {}, W extends {} = {}>(
  fixtures: Fixtures<T, W, BaseTestArgs, BaseWorkerArgs>,
  workerFixtures: Fixtures<{}, W, BaseTestArgs & T, BaseWorkerArgs & W>,
) => TestType<BaseTestArgs & T, BaseWorkerArgs & W>

type TestFixtures = {
  testUser: TestUser
  page: Page
  authSession: AuthSession
  oidcTokens: OidcTokens
}

type WorkerFixtures = {
  oidc: OidcStub
}

const workerFixtures = {
  oidc: [async ({}, use) => {
    const stub = new OidcStub()
    await stub.ensureStarted()
    try {
      await use(stub)
    } finally {
      await stub.stop()
    }
  }, { scope: 'worker' }],
} satisfies Fixtures<{}, WorkerFixtures, BaseTestArgs, BaseWorkerArgs>

const testFixtures = {
  testUser: async ({}, use) => {
    await use(cloneUser(DEFAULT_TEST_USER))
  },
  page: async ({ page, oidc, testUser }, use, testInfo) => {
    const baseURL = (testInfo.project.use.baseURL as string | undefined) ?? 'http://127.0.0.1:3000'
    oidc.setUser(testUser)
    await authenticatePage(page, baseURL, oidc)
    await use(page)
    oidc.resetUser()
  },
  authSession: async ({ page }, use) => {
    const session = await fetchSession(page)
    await use(session)
  },
  oidcTokens: async ({ oidc, testUser }, use) => {
    const tokens = await oidc.issueTokens(testUser)
    await use(tokens)
  },
} satisfies Fixtures<TestFixtures, WorkerFixtures, BaseTestArgs, BaseWorkerArgs>

const typed = (base.extend as unknown as ExtendWithWorker)<TestFixtures, WorkerFixtures>(
  testFixtures,
  workerFixtures,
)

export const test = typed.extend<{}, WorkerFixtures>(workerFixtures)

export { expect, OidcStub }
