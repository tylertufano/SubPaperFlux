"""add bookmark indexes

Revision ID: 0006_bookmark_indexes
Revises: 0005_job_available_at
Create Date: 2025-09-12

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '0006_bookmark_indexes'
down_revision = '0005_job_available_at'
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name if bind is not None else ''
    # Generic index on published_at for ORDER BY
    op.create_index('ix_bookmark_published_at', 'bookmark', ['published_at'])
    if dialect == 'postgresql':
        # Functional indexes to speed ILIKE searches (lowercase comparisons)
        op.execute('CREATE INDEX IF NOT EXISTS ix_bookmark_title_lower ON bookmark (LOWER(title));')
        op.execute('CREATE INDEX IF NOT EXISTS ix_bookmark_url_lower ON bookmark (LOWER(url));')


def downgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name if bind is not None else ''
    if dialect == 'postgresql':
        op.execute('DROP INDEX IF EXISTS ix_bookmark_title_lower;')
        op.execute('DROP INDEX IF EXISTS ix_bookmark_url_lower;')
    op.drop_index('ix_bookmark_published_at', table_name='bookmark')

