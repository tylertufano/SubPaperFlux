import NextAuth from 'next-auth'
import type { NextAuthOptions } from 'next-auth'
import { Issuer } from 'openid-client'
import { OAuthConfig } from 'next-auth/providers/oauth'

async function oidcProvider(): Promise<OAuthConfig<any>> {
  const wellKnown = process.env.OIDC_ISSUER!
  const issuer = await Issuer.discover(wellKnown)
  return {
    id: 'oidc',
    name: issuer.metadata.issuer || 'OIDC',
    type: 'oauth',
    version: '2.0',
    wellKnown,
    clientId: process.env.OIDC_CLIENT_ID,
    clientSecret: process.env.OIDC_CLIENT_SECRET,
    idToken: true,
    checks: ['pkce', 'state'],
    authorization: { params: { scope: 'openid profile email' } },
    profile(profile) {
      return {
        id: profile.sub,
        name: profile.name || profile.preferred_username || profile.sub,
        email: profile.email,
      }
    },
  }
}

export const authOptions: NextAuthOptions = {
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

