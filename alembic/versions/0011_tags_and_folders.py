"""add tag and folder tables with bookmark links

Revision ID: 0011_tags_and_folders
Revises: 0010_job_details
Create Date: 2025-09-16

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '0011_tags_and_folders'
down_revision = '0010_job_details'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'tag',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('owner_user_id', sa.String(), nullable=True),
        sa.Column('name', sa.String(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('owner_user_id', 'name', name='uq_tag_owner_name'),
    )
    op.create_index('ix_tag_owner_user_id', 'tag', ['owner_user_id'])
    op.create_index('ix_tag_name', 'tag', ['name'])

    op.create_table(
        'folder',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('owner_user_id', sa.String(), nullable=True),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('instapaper_folder_id', sa.String(), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('owner_user_id', 'name', name='uq_folder_owner_name'),
    )
    op.create_index('ix_folder_owner_user_id', 'folder', ['owner_user_id'])
    op.create_index('ix_folder_name', 'folder', ['name'])
    op.create_index('ix_folder_instapaper_folder_id', 'folder', ['instapaper_folder_id'])

    op.create_table(
        'bookmark_tag_link',
        sa.Column('bookmark_id', sa.String(), nullable=False),
        sa.Column('tag_id', sa.String(), nullable=False),
        sa.ForeignKeyConstraint(['bookmark_id'], ['bookmark.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['tag_id'], ['tag.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('bookmark_id', 'tag_id'),
    )
    op.create_index('ix_bookmark_tag_link_tag_id', 'bookmark_tag_link', ['tag_id'])

    op.create_table(
        'bookmark_folder_link',
        sa.Column('bookmark_id', sa.String(), nullable=False),
        sa.Column('folder_id', sa.String(), nullable=False),
        sa.ForeignKeyConstraint(['bookmark_id'], ['bookmark.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['folder_id'], ['folder.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('bookmark_id', 'folder_id'),
    )
    op.create_index('ix_bookmark_folder_link_folder_id', 'bookmark_folder_link', ['folder_id'])


def downgrade() -> None:
    op.drop_index('ix_bookmark_folder_link_folder_id', table_name='bookmark_folder_link')
    op.drop_table('bookmark_folder_link')

    op.drop_index('ix_bookmark_tag_link_tag_id', table_name='bookmark_tag_link')
    op.drop_table('bookmark_tag_link')

    op.drop_index('ix_folder_instapaper_folder_id', table_name='folder')
    op.drop_index('ix_folder_name', table_name='folder')
    op.drop_index('ix_folder_owner_user_id', table_name='folder')
    op.drop_table('folder')

    op.drop_index('ix_tag_name', table_name='tag')
    op.drop_index('ix_tag_owner_user_id', table_name='tag')
    op.drop_table('tag')
