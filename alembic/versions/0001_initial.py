"""initial schema

Revision ID: 0001_initial
Revises: 
Create Date: 2025-09-12

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '0001_initial'
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # site_configs
    op.create_table(
        'siteconfig',
        sa.Column('id', sa.String(), primary_key=True, nullable=False),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('site_url', sa.String(), nullable=False),
        sa.Column('username_selector', sa.String(), nullable=False),
        sa.Column('password_selector', sa.String(), nullable=False),
        sa.Column('login_button_selector', sa.String(), nullable=False),
        sa.Column('post_login_selector', sa.String(), nullable=True),
        sa.Column('cookies_to_store', sa.JSON(), nullable=True),
        sa.Column('owner_user_id', sa.String(), nullable=True),
    )
    op.create_index('ix_siteconfig_owner_user_id', 'siteconfig', ['owner_user_id'])

    # feeds
    op.create_table(
        'feed',
        sa.Column('id', sa.String(), primary_key=True, nullable=False),
        sa.Column('url', sa.String(), nullable=False),
        sa.Column('poll_frequency', sa.String(), nullable=False),
        sa.Column('initial_lookback_period', sa.String(), nullable=True),
        sa.Column('is_paywalled', sa.Boolean(), nullable=False, server_default=sa.text('0')),
        sa.Column('rss_requires_auth', sa.Boolean(), nullable=False, server_default=sa.text('0')),
        sa.Column('site_config_id', sa.String(), nullable=True),
        sa.Column('owner_user_id', sa.String(), nullable=True),
    )
    op.create_index('ix_feed_site_config_id', 'feed', ['site_config_id'])
    op.create_index('ix_feed_owner_user_id', 'feed', ['owner_user_id'])

    # credentials
    op.create_table(
        'credential',
        sa.Column('id', sa.String(), primary_key=True, nullable=False),
        sa.Column('kind', sa.String(), nullable=False),
        sa.Column('data', sa.JSON(), nullable=True),
        sa.Column('owner_user_id', sa.String(), nullable=True),
    )
    op.create_index('ix_credential_owner_user_id', 'credential', ['owner_user_id'])

    # jobs
    op.create_table(
        'job',
        sa.Column('id', sa.String(), primary_key=True, nullable=False),
        sa.Column('type', sa.String(), nullable=False),
        sa.Column('payload', sa.JSON(), nullable=True),
        sa.Column('status', sa.String(), nullable=False),
        sa.Column('owner_user_id', sa.String(), nullable=True),
    )
    op.create_index('ix_job_status', 'job', ['status'])
    op.create_index('ix_job_owner_user_id', 'job', ['owner_user_id'])


def downgrade() -> None:
    op.drop_index('ix_job_owner_user_id', table_name='job')
    op.drop_index('ix_job_status', table_name='job')
    op.drop_table('job')

    op.drop_index('ix_credential_owner_user_id', table_name='credential')
    op.drop_table('credential')

    op.drop_index('ix_feed_owner_user_id', table_name='feed')
    op.drop_index('ix_feed_site_config_id', table_name='feed')
    op.drop_table('feed')

    op.drop_index('ix_siteconfig_owner_user_id', table_name='siteconfig')
    op.drop_table('siteconfig')

