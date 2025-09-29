import { NextRequest, NextResponse } from 'next/server'
import { handlers, signIn } from '../../../../../auth'

type RouteParams = {
  params: {
    provider?: string
  }
}

function buildAuthorizationParams(url: URL): Record<string, string> | undefined {
  const params = new URLSearchParams(url.search)
  params.delete('callbackUrl')
  const entries = Array.from(params.entries())
  if (entries.length === 0) {
    return undefined
  }
  return entries.reduce<Record<string, string>>((acc, [key, value]) => {
    acc[key] = value
    return acc
  }, {})
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const provider = params.provider?.trim()
  if (!provider) {
    return NextResponse.redirect(new URL('/api/auth/signin', request.url))
  }

  const requestUrl = new URL(request.url)
  const callbackUrl = requestUrl.searchParams.get('callbackUrl') ?? undefined
  const authorizationParams = buildAuthorizationParams(requestUrl)
  const redirectTarget = await signIn(provider, { redirect: false, redirectTo: callbackUrl }, authorizationParams)

  const location = redirectTarget ?? callbackUrl ?? '/'
  return NextResponse.redirect(location, { status: 302 })
}

export async function POST(request: NextRequest) {
  return handlers.POST(request)
}
