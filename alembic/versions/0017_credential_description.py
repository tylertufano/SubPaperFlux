"""Add description to credentials.

Revision ID: 0017_credential_description
Revises: 0016_tag_folder_foreign_keys
Create Date: 2025-10-05

"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0017_credential_description"
down_revision = "0016_tag_folder_foreign_keys"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "credential",
        sa.Column("description", sa.String(length=200), nullable=True),
    )
    op.execute("UPDATE credential SET description = id")
    op.alter_column(
        "credential",
        "description",
        existing_type=sa.String(length=200),
        nullable=False,
    )


def downgrade() -> None:
    op.drop_column("credential", "description")
