import Nav from '../components/Nav'
import { apiPost } from '../lib/api'
import { useState } from 'react'

export default function Admin() {
  const [msg, setMsg] = useState<string>('')
  return (
    <div>
      <Nav />
      <main style={{ padding: 16 }}>
        <h2>Admin</h2>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <button onClick={async () => { const r = await apiPost('/v1/admin/postgres/prepare'); setMsg(JSON.stringify(r)) }}>Prepare Postgres (pg_trgm + indexes)</button>
          <button onClick={async () => { const r = await apiPost('/v1/admin/postgres/enable-rls'); setMsg(JSON.stringify(r)) }}>Enable RLS (owner policies)</button>
        </div>
        {msg && <pre style={{ background: '#f8f8f8', padding: 8 }}>{msg}</pre>}
      </main>
    </div>
  )
}

