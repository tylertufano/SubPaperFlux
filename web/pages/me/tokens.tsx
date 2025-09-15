import Nav from '../../components/Nav'

export default function Tokens() {
  return (
    <div>
      <Nav />
      <main className="container py-6">
        <h2 className="text-xl font-semibold mb-3">API Tokens</h2>
        <div className="card p-4">
          <p className="text-gray-700">Manage personal API tokens for CLI and integrations. Coming soon.</p>
        </div>
      </main>
    </div>
  )
}

