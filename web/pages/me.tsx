import Nav from '../components/Nav'
import { useI18n } from '../lib/i18n'

export default function Me() {
  const { t } = useI18n()
  return (
    <div>
      <Nav />
      <main className="container py-6">
        <h2 className="text-xl font-semibold mb-3">{t('nav_profile')}</h2>
        <div className="card p-4">
          <p className="text-gray-700">{t('profile_description')}</p>
        </div>
      </main>
    </div>
  )
}

