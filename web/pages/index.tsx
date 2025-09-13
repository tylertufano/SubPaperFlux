import Nav from '../components/Nav'
import { useI18n } from '../lib/i18n'

export default function Home() {
  const { t } = useI18n()
  return (
    <div>
      <Nav />
      <main className="container py-6">
        <div className="card p-6">
          <h1 className="text-2xl font-semibold mb-2">SubPaperFlux</h1>
          <p className="text-gray-700">{t('home_welcome')}</p>
        </div>
      </main>
    </div>
  )
}
