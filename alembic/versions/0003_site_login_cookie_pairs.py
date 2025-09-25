"""Require site_login credentials to reference site configs and enforce cookie pairs"""

from __future__ import annotations

import json

from alembic import op
import sqlalchemy as sa
import sqlmodel

revision = "0003_site_login_cookie_pairs"
down_revision = "0002_add_cookie_credential_reference"
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
    sa.column("id", sqlmodel.sql.sqltypes.AutoString()),
    sa.column("cookie_key", sqlmodel.sql.sqltypes.AutoString()),
    sa.column("credential_id", sqlmodel.sql.sqltypes.AutoString()),
    sa.column("site_config_id", sqlmodel.sql.sqltypes.AutoString()),
    sa.column("cookies", sa.JSON()),
    sa.column("encrypted_cookies", sa.Text()),
)


def upgrade() -> None:
    op.add_column(
        "credential",
        sa.Column("site_config_id", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
    )
    op.create_index(
        op.f("ix_credential_site_config_id"),
        "credential",
        ["site_config_id"],
        unique=False,
    )
    op.create_foreign_key(
        "fk_credential_site_config",
        "credential",
        "siteconfig",
        ["site_config_id"],
        ["id"],
        ondelete="SET NULL",
    )

    op.add_column(
        "cookie",
        sa.Column("encrypted_cookies", sa.Text(), nullable=True),
    )

    connection = op.get_bind()

    cookie_rows = connection.execute(
        sa.select(
            cookie_table.c.id,
            cookie_table.c.cookie_key,
            cookie_table.c.credential_id,
            cookie_table.c.site_config_id,
            cookie_table.c.cookies,
        )
    ).all()

    for row in cookie_rows:
        updates: dict[str, object] = {}
        cred_id = row.credential_id
        site_config_id = row.site_config_id
        if (not cred_id or not site_config_id) and isinstance(row.cookie_key, str):
            if "-" in row.cookie_key:
                parsed_cred, parsed_site = row.cookie_key.split("-", 1)
                if not cred_id:
                    cred_id = parsed_cred
                    updates["credential_id"] = parsed_cred
                if not site_config_id:
                    site_config_id = parsed_site
                    updates["site_config_id"] = parsed_site
        cookies_value = row.cookies
        if isinstance(cookies_value, (dict, list)):
            serialized = json.dumps(cookies_value)
        elif isinstance(cookies_value, str):
            serialized = cookies_value
        elif cookies_value is None:
            serialized = json.dumps({})
        else:
            serialized = json.dumps(cookies_value)
        updates["encrypted_cookies"] = serialized
        connection.execute(
            sa.update(cookie_table)
            .where(cookie_table.c.id == row.id)
            .values(**updates)
        )

        if cred_id and site_config_id:
            connection.execute(
                sa.update(credential_table)
                .where(credential_table.c.id == cred_id)
                .where(credential_table.c.site_config_id.is_(None))
                .values(site_config_id=site_config_id)
            )

    op.drop_column("cookie", "cookies")

    op.drop_index(op.f("ix_cookie_cookie_key"), table_name="cookie")
    op.drop_column("cookie", "cookie_key")

    op.alter_column(
        "cookie",
        "credential_id",
        existing_type=sqlmodel.sql.sqltypes.AutoString(),
        nullable=False,
    )
    op.alter_column(
        "cookie",
        "site_config_id",
        existing_type=sqlmodel.sql.sqltypes.AutoString(),
        nullable=False,
    )
    op.alter_column(
        "cookie",
        "encrypted_cookies",
        existing_type=sa.Text(),
        nullable=False,
    )

    op.create_foreign_key(
        "fk_cookie_site_config",
        "cookie",
        "siteconfig",
        ["site_config_id"],
        ["id"],
        ondelete="CASCADE",
    )

    op.create_check_constraint(
        "ck_credential_site_login_site_config",
        "credential",
        "(kind <> 'site_login') OR (site_config_id IS NOT NULL)",
    )


def downgrade() -> None:
    op.drop_constraint(
        "ck_credential_site_login_site_config",
        "credential",
        type_="check",
    )

    op.drop_constraint("fk_cookie_site_config", "cookie", type_="foreignkey")

    op.alter_column(
        "cookie",
        "encrypted_cookies",
        existing_type=sa.Text(),
        nullable=True,
    )
    op.alter_column(
        "cookie",
        "site_config_id",
        existing_type=sqlmodel.sql.sqltypes.AutoString(),
        nullable=True,
    )
    op.alter_column(
        "cookie",
        "credential_id",
        existing_type=sqlmodel.sql.sqltypes.AutoString(),
        nullable=True,
    )

    op.add_column(
        "cookie",
        sa.Column("cookie_key", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
    )
    op.add_column(
        "cookie",
        sa.Column("cookies", sa.JSON(), nullable=True),
    )

    connection = op.get_bind()
    cookie_rows = connection.execute(
        sa.select(
            cookie_table.c.id,
            cookie_table.c.credential_id,
            cookie_table.c.site_config_id,
            cookie_table.c.encrypted_cookies,
        )
    ).all()

    for row in cookie_rows:
        updates: dict[str, object] = {}
        cred_id = row.credential_id
        site_config_id = row.site_config_id
        updates["cookie_key"] = f"{cred_id}-{site_config_id}" if cred_id and site_config_id else None
        encrypted = row.encrypted_cookies
        try:
            decoded = json.loads(encrypted) if encrypted else None
        except json.JSONDecodeError:
            decoded = None
        updates["cookies"] = decoded
        connection.execute(
            sa.update(cookie_table)
            .where(cookie_table.c.id == row.id)
            .values(**updates)
        )

    op.drop_column("cookie", "encrypted_cookies")

    op.create_index(op.f("ix_cookie_cookie_key"), "cookie", ["cookie_key"], unique=False)

    op.drop_constraint("fk_credential_site_config", "credential", type_="foreignkey")
    op.drop_index(op.f("ix_credential_site_config_id"), table_name="credential")
    op.drop_column("credential", "site_config_id")
