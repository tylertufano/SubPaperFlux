import NextAuth from 'next-auth'
import type { NextAuthConfig } from 'next-auth'
import OIDC from 'next-auth/providers/oidc'

const wellKnown = process.env.OIDC_ISSUER!

export const authOptions: NextAuthConfig = {
  providers: [
    OIDC({
      wellKnown,
      clientId: process.env.OIDC_CLIENT_ID,
      clientSecret: process.env.OIDC_CLIENT_SECRET,
      authorization: { params: { scope: 'openid profile email' } },
    }),
  ],
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
