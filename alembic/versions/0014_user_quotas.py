"""Add per-user quota columns.

Revision ID: 0014_user_quotas
Revises: 0013_users_roles_api_tokens
Create Date: 2025-09-19
"""

from alembic import op
import sqlalchemy as sa


revision = "0014_user_quotas"
down_revision = "0013_users_roles_api_tokens"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("quota_credentials", sa.Integer(), nullable=True))
    op.add_column("users", sa.Column("quota_site_configs", sa.Integer(), nullable=True))
    op.add_column("users", sa.Column("quota_feeds", sa.Integer(), nullable=True))
    op.add_column("users", sa.Column("quota_api_tokens", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "quota_api_tokens")
    op.drop_column("users", "quota_feeds")
    op.drop_column("users", "quota_site_configs")
    op.drop_column("users", "quota_credentials")

