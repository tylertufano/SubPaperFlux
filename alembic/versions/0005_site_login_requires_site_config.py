"""Ensure site_login credentials reference a site config"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
import sqlmodel


revision = "0005_site_login_requires_site_config"
down_revision = "0004_bookmark_content_metadata"
branch_labels = None
depends_on = None


credential_table = sa.table(
    "credential",
    sa.column("id", sqlmodel.sql.sqltypes.AutoString()),
    sa.column("kind", sqlmodel.sql.sqltypes.AutoString()),
    sa.column("site_config_id", sqlmodel.sql.sqltypes.AutoString()),
)

cookie_table = sa.table(
    "cookie",
    sa.column("credential_id", sqlmodel.sql.sqltypes.AutoString()),
    sa.column("site_config_id", sqlmodel.sql.sqltypes.AutoString()),
)


def upgrade() -> None:
    connection = op.get_bind()

    rows = connection.execute(
        sa.select(credential_table.c.id).where(
            credential_table.c.kind == "site_login",
            credential_table.c.site_config_id.is_(None),
        )
    ).all()

    for row in rows:
        site_config = connection.execute(
            sa.select(cookie_table.c.site_config_id)
            .where(cookie_table.c.credential_id == row.id)
            .where(cookie_table.c.site_config_id.is_not(None))
            .limit(1)
        ).scalar_one_or_none()
        if site_config:
            connection.execute(
                sa.update(credential_table)
                .where(credential_table.c.id == row.id)
                .values(site_config_id=site_config)
            )

    remaining = connection.execute(
        sa.select(credential_table.c.id).where(
            credential_table.c.kind == "site_login",
            credential_table.c.site_config_id.is_(None),
        )
    ).all()
    if remaining:
        raise RuntimeError(
            "Found site_login credentials without a site_config_id; populate these before rerunning the migration.",
        )

    with op.batch_alter_table("credential") as batch_op:
        batch_op.drop_constraint("fk_credential_site_config", type_="foreignkey")
        batch_op.create_foreign_key(
            "fk_credential_site_config",
            "siteconfig",
            ["site_config_id"],
            ["id"],
            ondelete="CASCADE",
        )


def downgrade() -> None:
    with op.batch_alter_table("credential") as batch_op:
        batch_op.drop_constraint("fk_credential_site_config", type_="foreignkey")
        batch_op.create_foreign_key(
            "fk_credential_site_config",
            "siteconfig",
            ["site_config_id"],
            ["id"],
            ondelete="SET NULL",
        )
