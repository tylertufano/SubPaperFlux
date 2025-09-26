"""Add optional site_login_credential_id to feed

Revision ID: 0007_feed_site_login_credential_reference
Revises: 0006_bookmark_publication_flags
Create Date: 2024-06-08 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa
import sqlmodel


# revision identifiers, used by Alembic.
revision = "0007_feed_site_login_credential_reference"
down_revision = "0006_bookmark_publication_flags"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "feed",
        sa.Column(
            "site_login_credential_id",
            sqlmodel.sql.sqltypes.AutoString(),
            nullable=True,
        ),
    )
    op.create_index(
        op.f("ix_feed_site_login_credential_id"),
        "feed",
        ["site_login_credential_id"],
        unique=False,
    )
    op.create_foreign_key(
        "fk_feed_site_login_credential_id",
        "feed",
        "credential",
        ["site_login_credential_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint(
        "fk_feed_site_login_credential_id",
        "feed",
        type_="foreignkey",
    )
    op.drop_index(
        op.f("ix_feed_site_login_credential_id"),
        table_name="feed",
    )
    op.drop_column("feed", "site_login_credential_id")
