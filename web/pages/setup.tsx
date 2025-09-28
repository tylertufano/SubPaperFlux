import { useCallback, useMemo, useState } from 'react'
import { useRouter } from 'next/router'
import { useSession } from 'next-auth/react'
import { Alert, Breadcrumbs, ErrorBoundary, Nav } from '../components'
import SetupWizard from '../components/setup/SetupWizard'
import { useI18n } from '../lib/i18n'
import { buildBreadcrumbs } from '../lib/breadcrumbs'
import { userHasAdminAccess } from '../lib/adminAccess'

export default function SetupPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const { t } = useI18n()
  const breadcrumbs = useMemo(() => buildBreadcrumbs(router.pathname, t), [router.pathname, t])
  const [redirecting, setRedirecting] = useState(false)
  const isAuthenticated = status === 'authenticated'
  const isAdmin = isAuthenticated && userHasAdminAccess(session?.user)
  const handleFinished = useCallback(() => {
    if (redirecting) {
      return
    }
    setRedirecting(true)
    void router.replace('/')
  }, [redirecting, router])

  return (
    <ErrorBoundary>
      <div>
        <Nav />
        <Breadcrumbs items={breadcrumbs} />
        <main className="container py-6 space-y-4">
          <header className="space-y-2">
            <h1 className="text-2xl font-semibold">{t('setup_title')}</h1>
            <p className="text-gray-700">{t('setup_intro')}</p>
          </header>
          {status === 'loading' ? <p className="text-gray-600">{t('loading_text')}</p> : null}
          {status !== 'loading' && !isAuthenticated ? (
            <Alert kind="warning" message={t('access_sign_in_message')} />
          ) : null}
          {isAuthenticated && !isAdmin ? <Alert kind="error" message={t('setup_access_denied')} /> : null}
          {redirecting ? <Alert kind="info" message={t('setup_completed_redirect')} /> : null}
          {isAdmin ? <SetupWizard onSetupFinished={handleFinished} /> : null}
        </main>
      </div>
    </ErrorBoundary>
  )
}
