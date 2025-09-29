import type { GetServerSideProps } from 'next'

export const getServerSideProps: GetServerSideProps = async ({ res }) => {
  const apiBase = process.env.API_BASE || process.env.NEXT_PUBLIC_API_BASE || ''
  const truthy = new Set(['1', 'true', 'yes', 'on'])
  const parseBoolean = (value?: string | null) => {
    if (value == null) return true
    const normalized = value.trim().toLowerCase()
    if (normalized.length === 0) return true
    return truthy.has(normalized)
  }
  const userMgmtCore = parseBoolean(process.env.USER_MGMT_CORE)
  const userMgmtUi = parseBoolean(process.env.USER_MGMT_UI ?? process.env.NEXT_PUBLIC_USER_MGMT_UI)
  const profile = process.env.SPF_PROFILE || process.env.NEXT_PUBLIC_SPF_PROFILE || ''
  res.setHeader('Content-Type', 'application/json')
  res.write(JSON.stringify({ apiBase, userMgmtCore, userMgmtUi, profile }))
  res.end()
  // Prevent rendering; response already sent
  return { props: {} as any }
}

export default function UiConfig() {
  return null
}

