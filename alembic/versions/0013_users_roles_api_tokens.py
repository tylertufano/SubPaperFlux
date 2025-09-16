"""users roles api tokens tables

Revision ID: 0013_users_roles_api_tokens
Revises: 0012_audit_log
Create Date: 2025-09-18

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '0013_users_roles_api_tokens'
down_revision = '0012_audit_log'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'users',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('email', sa.String(), nullable=True),
        sa.Column('full_name', sa.String(), nullable=True),
        sa.Column('picture_url', sa.String(), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.text('true')),
        sa.Column('claims', sa.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('CURRENT_TIMESTAMP')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('CURRENT_TIMESTAMP')),
        sa.Column('last_login_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('email', name='uq_users_email'),
    )
    op.create_index('ix_users_email', 'users', ['email'])
    op.create_index('ix_users_is_active', 'users', ['is_active'])
    op.create_index('ix_users_created_at', 'users', ['created_at'])

    op.create_table(
        'roles',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('description', sa.String(), nullable=True),
        sa.Column('is_system', sa.Boolean(), nullable=False, server_default=sa.text('false')),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('CURRENT_TIMESTAMP')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('CURRENT_TIMESTAMP')),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('name', name='uq_roles_name'),
    )
    op.create_index('ix_roles_name', 'roles', ['name'])
    op.create_index('ix_roles_is_system', 'roles', ['is_system'])
    op.create_index('ix_roles_created_at', 'roles', ['created_at'])

    op.create_table(
        'user_roles',
        sa.Column('user_id', sa.String(), nullable=False),
        sa.Column('role_id', sa.String(), nullable=False),
        sa.Column('granted_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('CURRENT_TIMESTAMP')),
        sa.Column('granted_by_user_id', sa.String(), nullable=True),
        sa.PrimaryKeyConstraint('user_id', 'role_id'),
        sa.UniqueConstraint('user_id', 'role_id', name='uq_user_roles_user_role'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['role_id'], ['roles.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['granted_by_user_id'], ['users.id'], ondelete='SET NULL'),
    )
    op.create_index('ix_user_roles_granted_at', 'user_roles', ['granted_at'])

    op.create_table(
        'api_tokens',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('user_id', sa.String(), nullable=False),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('description', sa.String(), nullable=True),
        sa.Column('token_hash', sa.String(), nullable=False),
        sa.Column('scopes', sa.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('CURRENT_TIMESTAMP')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('CURRENT_TIMESTAMP')),
        sa.Column('last_used_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('revoked_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id', 'name', name='uq_api_tokens_user_name'),
        sa.UniqueConstraint('token_hash', name='uq_api_tokens_token_hash'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    )
    op.create_index('ix_api_tokens_user_id', 'api_tokens', ['user_id'])
    op.create_index('ix_api_tokens_name', 'api_tokens', ['name'])
    op.create_index('ix_api_tokens_created_at', 'api_tokens', ['created_at'])


def downgrade() -> None:
    op.drop_index('ix_api_tokens_created_at', table_name='api_tokens')
    op.drop_index('ix_api_tokens_name', table_name='api_tokens')
    op.drop_index('ix_api_tokens_user_id', table_name='api_tokens')
    op.drop_table('api_tokens')

    op.drop_index('ix_user_roles_granted_at', table_name='user_roles')
    op.drop_table('user_roles')

    op.drop_index('ix_roles_created_at', table_name='roles')
    op.drop_index('ix_roles_is_system', table_name='roles')
    op.drop_index('ix_roles_name', table_name='roles')
    op.drop_table('roles')

    op.drop_index('ix_users_created_at', table_name='users')
    op.drop_index('ix_users_is_active', table_name='users')
    op.drop_index('ix_users_email', table_name='users')
    op.drop_table('users')
