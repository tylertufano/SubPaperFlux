import NextAuth from 'next-auth'
import type { NextAuthConfig } from 'next-auth'
import type { OIDCConfig } from 'next-auth/providers'

async function oidcProvider(): Promise<OIDCConfig<any>> {
  const wellKnown = process.env.OIDC_ISSUER!
  let name = 'OIDC'
  try {
    const res = await fetch(wellKnown)
    if (res.ok) {
      const meta = await res.json()
      name = meta.issuer || name
    }
  } catch {}
  return {
    id: 'oidc',
    name,
    type: 'oidc',
    wellKnown,
    clientId: process.env.OIDC_CLIENT_ID,
    clientSecret: process.env.OIDC_CLIENT_SECRET,
    idToken: true,
    checks: ['pkce', 'state'],
    authorization: { params: { scope: 'openid profile email' } },
    profile(profile: any) {
      return {
        id: profile.sub,
        name: profile.name || profile.preferred_username || profile.sub,
        email: profile.email,
      }
    },
  }
}

export const authOptions: NextAuthConfig = {
  providers: [await oidcProvider()],
  callbacks: {
    async jwt({ token, account }) {
      if (account) {
        token.accessToken = account.access_token
        token.idToken = account.id_token
      }
      return token
    },
    async session({ session, token }) {
      ;(session as any).accessToken = token.accessToken
      ;(session as any).idToken = token.idToken
      return session
    },
  },
  session: { strategy: 'jwt' },
  secret: process.env.NEXTAUTH_SECRET,
}

export default NextAuth(authOptions)

