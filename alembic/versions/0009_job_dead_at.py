"""add job dead_at field

Revision ID: 0009_job_dead_at
Revises: 0008_enable_pg_trgm_and_gin
Create Date: 2025-09-12

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '0009_job_dead_at'
down_revision = '0008_enable_pg_trgm_and_gin'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('job', sa.Column('dead_at', sa.Float(), nullable=True))
    op.create_index('ix_job_dead_at', 'job', ['dead_at'])


def downgrade() -> None:
    op.drop_index('ix_job_dead_at', table_name='job')
    op.drop_column('job', 'dead_at')

