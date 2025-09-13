"""enable pg_trgm and add GIN trigram indexes

Revision ID: 0008_enable_pg_trgm_and_gin
Revises: 0007_bookmark_published_at_timestamptz
Create Date: 2025-09-12

"""
from alembic import op


# revision identifiers, used by Alembic.
revision = '0008_enable_pg_trgm_and_gin'
down_revision = '0007_bookmark_published_at_timestamptz'
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name if bind is not None else ''
    if dialect == 'postgresql':
        op.execute('CREATE EXTENSION IF NOT EXISTS pg_trgm;')
        op.execute('CREATE INDEX IF NOT EXISTS ix_bookmark_title_trgm ON bookmark USING gin (LOWER(title) gin_trgm_ops);')
        op.execute('CREATE INDEX IF NOT EXISTS ix_bookmark_url_trgm ON bookmark USING gin (LOWER(url) gin_trgm_ops);')


def downgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name if bind is not None else ''
    if dialect == 'postgresql':
        op.execute('DROP INDEX IF EXISTS ix_bookmark_title_trgm;')
        op.execute('DROP INDEX IF EXISTS ix_bookmark_url_trgm;')

