"""add bookmark table

Revision ID: 0003_add_bookmarks
Revises: 0002_add_cookies
Create Date: 2025-09-12

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '0003_add_bookmarks'
down_revision = '0002_add_cookies'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'bookmark',
        sa.Column('id', sa.String(), primary_key=True, nullable=False),
        sa.Column('owner_user_id', sa.String(), nullable=True),
        sa.Column('instapaper_bookmark_id', sa.String(), nullable=False),
        sa.Column('url', sa.String(), nullable=True),
        sa.Column('title', sa.String(), nullable=True),
        sa.Column('content_location', sa.String(), nullable=True),
        sa.Column('feed_id', sa.String(), nullable=True),
        sa.Column('published_at', sa.String(), nullable=True),
    )
    op.create_index('ix_bookmark_owner_user_id', 'bookmark', ['owner_user_id'])
    op.create_index('ix_bookmark_instapaper_bookmark_id', 'bookmark', ['instapaper_bookmark_id'])
    op.create_index('ix_bookmark_feed_id', 'bookmark', ['feed_id'])


def downgrade() -> None:
    op.drop_index('ix_bookmark_feed_id', table_name='bookmark')
    op.drop_index('ix_bookmark_instapaper_bookmark_id', table_name='bookmark')
    op.drop_index('ix_bookmark_owner_user_id', table_name='bookmark')
    op.drop_table('bookmark')

