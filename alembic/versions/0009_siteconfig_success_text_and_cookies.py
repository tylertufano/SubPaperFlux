"""Add success text fields and required cookies to siteconfig

Revision ID: 0009_siteconfig_success_text_and_cookies
Revises: 0008_siteconfig_login_payloads
Create Date: 2024-10-06 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0009_siteconfig_success_text_and_cookies"
down_revision = "0008_siteconfig_login_payloads"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "siteconfig",
        sa.Column(
            "success_text_class",
            sa.String(length=255),
            nullable=True,
            server_default="",
        ),
    )
    op.add_column(
        "siteconfig",
        sa.Column(
            "expected_success_text",
            sa.Text(),
            nullable=True,
            server_default="",
        ),
    )
    op.add_column(
        "siteconfig",
        sa.Column(
            "required_cookies",
            sa.JSON(),
            nullable=True,
            server_default="[]",
        ),
    )

    siteconfig_table = sa.table(
        "siteconfig",
        sa.column("success_text_class", sa.String(length=255)),
        sa.column("expected_success_text", sa.Text()),
        sa.column("required_cookies", sa.JSON()),
    )

    conn = op.get_bind()
    conn.execute(
        siteconfig_table.update().values(
            success_text_class="",
            expected_success_text="",
            required_cookies=[],
        )
    )


def downgrade() -> None:
    op.drop_column("siteconfig", "required_cookies")
    op.drop_column("siteconfig", "expected_success_text")
    op.drop_column("siteconfig", "success_text_class")
