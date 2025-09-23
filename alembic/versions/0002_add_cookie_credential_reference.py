"""Add credential reference to cookie table.

Revision ID: 0002_add_cookie_credential_reference
Revises: 0001_initial
Create Date: 2025-10-31 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
import sqlmodel


# revision identifiers, used by Alembic.
revision = "0002_add_cookie_credential_reference"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


cookie_table = sa.table(
    "cookie",
    sa.column("id", sqlmodel.sql.sqltypes.AutoString()),
    sa.column("cookie_key", sqlmodel.sql.sqltypes.AutoString()),
    sa.column("credential_id", sqlmodel.sql.sqltypes.AutoString()),
)


def upgrade() -> None:
    op.add_column(
        "cookie",
        sa.Column("credential_id", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
    )
    op.create_index(
        op.f("ix_cookie_credential_id"), "cookie", ["credential_id"], unique=False
    )
    op.create_foreign_key(
        "fk_cookie_credential_id",
        "cookie",
        "credential",
        ["credential_id"],
        ["id"],
        ondelete="CASCADE",
    )

    connection = op.get_bind()
    results = connection.execute(
        sa.select(cookie_table.c.id, cookie_table.c.cookie_key)
    ).all()
    for row in results:
        cookie_key = row.cookie_key
        if isinstance(cookie_key, str) and "-" in cookie_key:
            credential_id = cookie_key.split("-", 1)[0]
            connection.execute(
                sa.update(cookie_table)
                .where(cookie_table.c.id == row.id)
                .values(credential_id=credential_id)
            )

    op.create_unique_constraint(
        "uq_cookie_site_config_credential",
        "cookie",
        ["site_config_id", "credential_id"],
    )


def downgrade() -> None:
    op.drop_constraint(
        "uq_cookie_site_config_credential", "cookie", type_="unique"
    )
    op.drop_constraint("fk_cookie_credential_id", "cookie", type_="foreignkey")
    op.drop_index(op.f("ix_cookie_credential_id"), table_name="cookie")
    op.drop_column("cookie", "credential_id")
