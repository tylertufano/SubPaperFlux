"""Add locale and notification preferences to users.

Revision ID: 0015_user_preferences
Revises: 0014_user_quotas
Create Date: 2025-09-20
"""

from alembic import op
import sqlalchemy as sa


revision = "0015_user_preferences"
down_revision = "0014_user_quotas"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("locale", sa.String(length=32), nullable=True))
    op.add_column("users", sa.Column("notification_preferences", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "notification_preferences")
    op.drop_column("users", "locale")

