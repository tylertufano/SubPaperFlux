import Nav from '../components/Nav'

export default function Me() {
  return (
    <div>
      <Nav />
      <main className="container py-6">
        <h2 className="text-xl font-semibold mb-3">Profile</h2>
        <div className="card p-4">
          <p className="text-gray-700">This page will show your account details and allow updating preferences (including locale). Coming soon.</p>
        </div>
      </main>
    </div>
  )
}

