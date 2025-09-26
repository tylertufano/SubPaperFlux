"""Add login_type and config payloads to siteconfig

Revision ID: 0008_siteconfig_login_payloads
Revises: 0007_feed_site_login_credential_reference
Create Date: 2024-08-30 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa
import sqlmodel


# revision identifiers, used by Alembic.
revision = "0008_siteconfig_login_payloads"
down_revision = "0007_feed_site_login_credential_reference"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "siteconfig",
        sa.Column(
            "login_type",
            sa.String(length=32),
            nullable=False,
            server_default="selenium",
        ),
    )
    op.add_column(
        "siteconfig",
        sa.Column("selenium_config", sa.JSON(), nullable=True),
    )
    op.add_column(
        "siteconfig",
        sa.Column("api_config", sa.JSON(), nullable=True),
    )

    siteconfig_table = sa.table(
        "siteconfig",
        sa.column("id", sqlmodel.sql.sqltypes.AutoString()),
        sa.column("username_selector", sqlmodel.sql.sqltypes.AutoString()),
        sa.column("password_selector", sqlmodel.sql.sqltypes.AutoString()),
        sa.column("login_button_selector", sqlmodel.sql.sqltypes.AutoString()),
        sa.column("post_login_selector", sqlmodel.sql.sqltypes.AutoString()),
        sa.column("cookies_to_store", sa.JSON()),
        sa.column("selenium_config", sa.JSON()),
        sa.column("login_type", sa.String()),
    )

    conn = op.get_bind()
    rows = conn.execute(
        sa.select(
            siteconfig_table.c.id,
            siteconfig_table.c.username_selector,
            siteconfig_table.c.password_selector,
            siteconfig_table.c.login_button_selector,
            siteconfig_table.c.post_login_selector,
            siteconfig_table.c.cookies_to_store,
        )
    ).mappings()
    for row in rows:
        cookies = row["cookies_to_store"] or []
        if not isinstance(cookies, list):
            cookies = list(cookies) if cookies is not None else []
        selenium_payload = {
            "username_selector": row["username_selector"],
            "password_selector": row["password_selector"],
            "login_button_selector": row["login_button_selector"],
            "post_login_selector": row["post_login_selector"],
            "cookies_to_store": cookies,
        }
        conn.execute(
            siteconfig_table.update()
            .where(siteconfig_table.c.id == row["id"])
            .values(
                login_type="selenium",
                selenium_config=selenium_payload,
            )
        )

    op.drop_column("siteconfig", "login_button_selector")
    op.drop_column("siteconfig", "password_selector")
    op.drop_column("siteconfig", "username_selector")
    op.drop_column("siteconfig", "post_login_selector")
    op.drop_column("siteconfig", "cookies_to_store")


def downgrade() -> None:
    op.add_column(
        "siteconfig",
        sa.Column("cookies_to_store", sa.JSON(), nullable=True),
    )
    op.add_column(
        "siteconfig",
        sa.Column(
            "post_login_selector",
            sqlmodel.sql.sqltypes.AutoString(),
            nullable=True,
        ),
    )
    op.add_column(
        "siteconfig",
        sa.Column(
            "login_button_selector",
            sqlmodel.sql.sqltypes.AutoString(),
            nullable=True,
        ),
    )
    op.add_column(
        "siteconfig",
        sa.Column(
            "password_selector",
            sqlmodel.sql.sqltypes.AutoString(),
            nullable=True,
        ),
    )
    op.add_column(
        "siteconfig",
        sa.Column(
            "username_selector",
            sqlmodel.sql.sqltypes.AutoString(),
            nullable=True,
        ),
    )

    siteconfig_table = sa.table(
        "siteconfig",
        sa.column("id", sqlmodel.sql.sqltypes.AutoString()),
        sa.column("selenium_config", sa.JSON()),
        sa.column("cookies_to_store", sa.JSON()),
        sa.column("username_selector", sqlmodel.sql.sqltypes.AutoString()),
        sa.column("password_selector", sqlmodel.sql.sqltypes.AutoString()),
        sa.column("login_button_selector", sqlmodel.sql.sqltypes.AutoString()),
        sa.column("post_login_selector", sqlmodel.sql.sqltypes.AutoString()),
    )

    conn = op.get_bind()
    rows = conn.execute(
        sa.select(siteconfig_table.c.id, siteconfig_table.c.selenium_config)
    ).mappings()
    for row in rows:
        selenium_payload = row["selenium_config"] or {}
        cookies = selenium_payload.get("cookies_to_store") or []
        conn.execute(
            siteconfig_table.update()
            .where(siteconfig_table.c.id == row["id"])
            .values(
                username_selector=selenium_payload.get("username_selector"),
                password_selector=selenium_payload.get("password_selector"),
                login_button_selector=selenium_payload.get("login_button_selector"),
                post_login_selector=selenium_payload.get("post_login_selector"),
                cookies_to_store=cookies,
            )
        )

    op.alter_column(
        "siteconfig",
        "username_selector",
        existing_type=sqlmodel.sql.sqltypes.AutoString(),
        nullable=False,
    )
    op.alter_column(
        "siteconfig",
        "password_selector",
        existing_type=sqlmodel.sql.sqltypes.AutoString(),
        nullable=False,
    )
    op.alter_column(
        "siteconfig",
        "login_button_selector",
        existing_type=sqlmodel.sql.sqltypes.AutoString(),
        nullable=False,
    )

    op.drop_column("siteconfig", "api_config")
    op.drop_column("siteconfig", "selenium_config")
    op.drop_column("siteconfig", "login_type")
