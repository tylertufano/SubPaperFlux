"""add job details json column

Revision ID: 0010_job_details
Revises: 0009_job_dead_at
Create Date: 2025-09-12

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '0010_job_details'
down_revision = '0009_job_dead_at'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('job', sa.Column('details', sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column('job', 'details')

