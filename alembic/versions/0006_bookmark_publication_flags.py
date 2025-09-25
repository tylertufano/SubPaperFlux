from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlmodel.sql.sqltypes import AutoString


# revision identifiers, used by Alembic.
revision = "0006_bookmark_publication_flags"
down_revision = "0005_site_login_requires_site_config"
branch_labels = None
depends_on = None


def _json_server_default(bind) -> sa.sql.elements.TextClause:
    if bind.dialect.name == "postgresql":
        return sa.text("'{}'::jsonb")
    return sa.text("'{}'")


def upgrade() -> None:
    bind = op.get_bind()
    json_default = _json_server_default(bind)

    op.alter_column(
        "bookmark",
        "instapaper_bookmark_id",
        existing_type=AutoString(),
        nullable=True,
    )

    op.add_column(
        "bookmark",
        sa.Column(
            "publication_flags",
            sa.JSON(),
            nullable=False,
            server_default=json_default,
        ),
    )

    if bind.dialect.name == "postgresql":
        op.execute(
            sa.text(
                "UPDATE bookmark SET publication_flags = '{}'::jsonb WHERE publication_flags IS NULL"
            )
        )
    else:
        op.execute(
            sa.text(
                "UPDATE bookmark SET publication_flags = '{}' WHERE publication_flags IS NULL"
            )
        )


def downgrade() -> None:
    op.drop_column("bookmark", "publication_flags")
    op.alter_column(
        "bookmark",
        "instapaper_bookmark_id",
        existing_type=AutoString(),
        nullable=False,
    )
