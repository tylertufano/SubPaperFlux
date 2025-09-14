import type { GetServerSideProps } from 'next'

export const getServerSideProps: GetServerSideProps = async ({ res }) => {
  const apiBase = process.env.API_BASE || process.env.NEXT_PUBLIC_API_BASE || ''
  res.setHeader('Content-Type', 'application/json')
  res.write(JSON.stringify({ apiBase }))
  res.end()
  // Prevent rendering; response already sent
  return { props: {} as any }
}

export default function UiConfig() {
  return null
}

