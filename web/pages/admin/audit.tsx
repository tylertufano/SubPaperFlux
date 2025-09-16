import { EmptyState, ErrorBoundary, Nav } from '../../components'
import { useI18n } from '../../lib/i18n'

export default function AdminAudit() {
  const { t } = useI18n()
  return (
    <ErrorBoundary>
      <div>
        <Nav />
        <main className="container py-6">
          <h2 className="text-xl font-semibold mb-3">{t('nav_audit')}</h2>
          <div className="card p-6">
            <EmptyState
              icon={<span aria-hidden="true">📜</span>}
              message={(
                <div className="space-y-1">
                  <p className="text-lg font-semibold text-gray-700">{t('empty_admin_audit_title')}</p>
                  <p>{t('admin_audit_description')}</p>
                </div>
              )}
            />
          </div>
        </main>
      </div>
    </ErrorBoundary>
  )
}

