"""add job retry fields

Revision ID: 0004_job_retry_fields
Revises: 0003_add_bookmarks
Create Date: 2025-09-12

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '0004_job_retry_fields'
down_revision = '0003_add_bookmarks'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('job', sa.Column('attempts', sa.Integer(), nullable=False, server_default='0'))
    op.add_column('job', sa.Column('last_error', sa.String(), nullable=True))
    # Remove server_default to clean up metadata
    with op.batch_alter_table('job') as batch_op:
        batch_op.alter_column('attempts', server_default=None)


def downgrade() -> None:
    op.drop_column('job', 'last_error')
    op.drop_column('job', 'attempts')

