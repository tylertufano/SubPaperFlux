"""add audit log table

Revision ID: 0012_audit_log
Revises: 0011_tags_and_folders
Create Date: 2025-09-17

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '0012_audit_log'
down_revision = '0011_tags_and_folders'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'audit_log',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('entity_type', sa.String(), nullable=False),
        sa.Column('entity_id', sa.String(), nullable=False),
        sa.Column('action', sa.String(), nullable=False),
        sa.Column('owner_user_id', sa.String(), nullable=True),
        sa.Column('actor_user_id', sa.String(), nullable=True),
        sa.Column('details', sa.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('CURRENT_TIMESTAMP')),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_audit_log_entity_type', 'audit_log', ['entity_type'])
    op.create_index('ix_audit_log_entity_id', 'audit_log', ['entity_id'])
    op.create_index('ix_audit_log_action', 'audit_log', ['action'])
    op.create_index('ix_audit_log_owner_user_id', 'audit_log', ['owner_user_id'])
    op.create_index('ix_audit_log_actor_user_id', 'audit_log', ['actor_user_id'])
    op.create_index('ix_audit_log_created_at', 'audit_log', ['created_at'])


def downgrade() -> None:
    op.drop_index('ix_audit_log_created_at', table_name='audit_log')
    op.drop_index('ix_audit_log_actor_user_id', table_name='audit_log')
    op.drop_index('ix_audit_log_owner_user_id', table_name='audit_log')
    op.drop_index('ix_audit_log_action', table_name='audit_log')
    op.drop_index('ix_audit_log_entity_id', table_name='audit_log')
    op.drop_index('ix_audit_log_entity_type', table_name='audit_log')
    op.drop_table('audit_log')
