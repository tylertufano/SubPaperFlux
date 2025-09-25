"""Add bookmark metadata storage"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0004_bookmark_content_metadata"
down_revision = "0003_site_login_cookie_pairs"
branch_labels = None
depends_on = None


def _json_server_default(bind) -> sa.sql.elements.TextClause:
    if bind.dialect.name == "postgresql":
        return sa.text("'{}'::jsonb")
    return sa.text("'{}'")


def upgrade() -> None:
    bind = op.get_bind()
    json_default = _json_server_default(bind)

    op.add_column(
        "bookmark",
        sa.Column("rss_entry", sa.JSON(), nullable=False, server_default=json_default),
    )
    op.add_column(
        "bookmark",
        sa.Column("raw_html_content", sa.Text(), nullable=True),
    )
    op.add_column(
        "bookmark",
        sa.Column(
            "publication_statuses",
            sa.JSON(),
            nullable=False,
            server_default=json_default,
        ),
    )

    if bind.dialect.name == "postgresql":
        op.execute(
            sa.text(
                "UPDATE bookmark SET rss_entry = '{}'::jsonb WHERE rss_entry IS NULL"
            )
        )
        op.execute(
            sa.text(
                "UPDATE bookmark SET publication_statuses = '{}'::jsonb WHERE publication_statuses IS NULL"
            )
        )
    else:
        op.execute(
            sa.text(
                "UPDATE bookmark SET rss_entry = '{}' WHERE rss_entry IS NULL"
            )
        )
        op.execute(
            sa.text(
                "UPDATE bookmark SET publication_statuses = '{}' WHERE publication_statuses IS NULL"
            )
        )


def downgrade() -> None:
    op.drop_column("bookmark", "publication_statuses")
    op.drop_column("bookmark", "raw_html_content")
    op.drop_column("bookmark", "rss_entry")
