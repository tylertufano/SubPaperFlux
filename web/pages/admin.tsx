import Nav from '../components/Nav'
import { useState } from 'react'
import { v1 } from '../lib/openapi'

export default function Admin() {
  const [msg, setMsg] = useState<string>('')
  return (
    <div>
      <Nav />
      <main style={{ padding: 16 }}>
        <h2>Admin</h2>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <button
            onClick={async () => {
              const r = await v1.postgresPrepareV1AdminPostgresPreparePost()
              setMsg(JSON.stringify(r))
            }}
          >
            Prepare Postgres (pg_trgm + indexes)
          </button>
          <button
            onClick={async () => {
              const r = await v1.postgresEnableRlsV1AdminPostgresEnableRlsPost()
              setMsg(JSON.stringify(r))
            }}
          >
            Enable RLS (owner policies)
          </button>
        </div>
        {msg && <pre style={{ background: '#f8f8f8', padding: 8 }}>{msg}</pre>}
      </main>
    </div>
  )
}
