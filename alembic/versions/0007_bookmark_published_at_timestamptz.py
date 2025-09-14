"""convert bookmark.published_at to timestamptz on Postgres

Revision ID: 0007_bookmark_published_at_timestamptz
Revises: 0006_bookmark_indexes
Create Date: 2025-09-12

"""
from alembic import op


# revision identifiers, used by Alembic.
revision = '0007_bookmark_published_at_timestamptz'
down_revision = '0006_bookmark_indexes'
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name if bind is not None else ''
    if dialect == 'postgresql':
        # Ensure alembic_version can store longer revision IDs
        op.execute("ALTER TABLE alembic_version ALTER COLUMN version_num TYPE VARCHAR(128);")
        # Convert TEXT/unknown to TIMESTAMPTZ using safe cast
        op.execute(
            """
            ALTER TABLE bookmark
            ALTER COLUMN published_at TYPE timestamptz USING (
                CASE
                    WHEN published_at IS NULL OR published_at = '' THEN NULL
                    ELSE published_at::timestamptz
                END
            );
            """
        )


def downgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name if bind is not None else ''
    if dialect == 'postgresql':
        # Revert to text
        op.execute("ALTER TABLE bookmark ALTER COLUMN published_at TYPE text;")
        # Optionally shrink alembic_version column back to 32
        op.execute("ALTER TABLE alembic_version ALTER COLUMN version_num TYPE VARCHAR(32);")
