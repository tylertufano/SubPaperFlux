import NextAuth from 'next-auth'
import type { Account, NextAuthConfig, Session } from 'next-auth'
import type { JWT } from 'next-auth/jwt'

const issuer = process.env.OIDC_ISSUER!

export const authOptions: NextAuthConfig = {
  providers: [
    {
      id: 'oidc',
      name: 'OIDC',
      type: 'oidc',
      issuer,
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
    } as any,
  ],
  callbacks: {
    async jwt({ token, account }: { token: JWT; account: Account | null | undefined }) {
      if (account) {
        token.accessToken = account.access_token
        token.idToken = account.id_token
      }
      return token
    },
    async session({ session, token }: { session: Session; token: JWT }) {
      session.accessToken = token.accessToken
      session.idToken = token.idToken
      return session
    },
  },
  session: { strategy: 'jwt' },
  secret: process.env.NEXTAUTH_SECRET,
}

const { handlers, auth, signIn, signOut } = NextAuth(authOptions)

export { handlers, auth, signIn, signOut }
