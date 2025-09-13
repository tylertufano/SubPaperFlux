"""add cookies table

Revision ID: 0002_add_cookies
Revises: 0001_initial
Create Date: 2025-09-12

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '0002_add_cookies'
down_revision = '0001_initial'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'cookie',
        sa.Column('id', sa.String(), primary_key=True, nullable=False),
        sa.Column('cookie_key', sa.String(), nullable=False),
        sa.Column('owner_user_id', sa.String(), nullable=True),
        sa.Column('site_config_id', sa.String(), nullable=True),
        sa.Column('cookies', sa.JSON(), nullable=True),
        sa.Column('last_refresh', sa.String(), nullable=True),
        sa.Column('expiry_hint', sa.Float(), nullable=True),
    )
    op.create_index('ix_cookie_cookie_key', 'cookie', ['cookie_key'])
    op.create_index('ix_cookie_owner_user_id', 'cookie', ['owner_user_id'])
    op.create_index('ix_cookie_site_config_id', 'cookie', ['site_config_id'])


def downgrade() -> None:
    op.drop_index('ix_cookie_site_config_id', table_name='cookie')
    op.drop_index('ix_cookie_owner_user_id', table_name='cookie')
    op.drop_index('ix_cookie_cookie_key', table_name='cookie')
    op.drop_table('cookie')

