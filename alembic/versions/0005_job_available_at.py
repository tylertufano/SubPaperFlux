"""add job available_at field

Revision ID: 0005_job_available_at
Revises: 0004_job_retry_fields
Create Date: 2025-09-12

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '0005_job_available_at'
down_revision = '0004_job_retry_fields'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('job', sa.Column('available_at', sa.Float(), nullable=True))
    op.create_index('ix_job_available_at', 'job', ['available_at'])


def downgrade() -> None:
    op.drop_index('ix_job_available_at', table_name='job')
    op.drop_column('job', 'available_at')

