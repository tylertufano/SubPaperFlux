"""Add site settings table.

Revision ID: 0019_site_settings
Revises: 0018_add_organizations
Create Date: 2024-05-21

"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0019_site_settings"
down_revision = "0018_add_organizations"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "site_settings",
        sa.Column("key", sa.String(length=255), nullable=False),
        sa.Column("value", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.Column("updated_by_user_id", sa.String(), nullable=True),
        sa.PrimaryKeyConstraint("key"),
        sa.ForeignKeyConstraint(
            ["updated_by_user_id"],
            ["users.id"],
            ondelete="SET NULL",
            name="fk_site_settings_updated_by_user_id_users_id",
        ),
    )
    op.create_index(
        "ix_site_settings_updated_at",
        "site_settings",
        ["updated_at"],
        unique=False,
    )
    op.create_index(
        "ix_site_settings_updated_by_user_id",
        "site_settings",
        ["updated_by_user_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_site_settings_updated_by_user_id",
        table_name="site_settings",
    )
    op.drop_index("ix_site_settings_updated_at", table_name="site_settings")
    op.drop_table("site_settings")
