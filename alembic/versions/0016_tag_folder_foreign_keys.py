"""Add foreign keys for tag/folder ownership.

Revision ID: 0016_tag_folder_foreign_keys
Revises: 0015_user_preferences
Create Date: 2025-09-24

"""
from alembic import op


# revision identifiers, used by Alembic.
revision = "0016_tag_folder_foreign_keys"
down_revision = "0015_user_preferences"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_foreign_key(
        "fk_tag_owner_user_id_users",
        "tag",
        "users",
        ["owner_user_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_foreign_key(
        "fk_folder_owner_user_id_users",
        "folder",
        "users",
        ["owner_user_id"],
        ["id"],
        ondelete="CASCADE",
    )


def downgrade() -> None:
    op.drop_constraint("fk_folder_owner_user_id_users", "folder", type_="foreignkey")
    op.drop_constraint("fk_tag_owner_user_id_users", "tag", type_="foreignkey")
