"""Require siteconfig owner assignment."""

from __future__ import annotations

import logging
from uuid import uuid4

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0015_siteconfig_owner_required"
down_revision = "0014_remove_schedule_lookback"
branch_labels = None
depends_on = None


siteconfig_table = sa.table(
    "siteconfig",
    sa.column("id", sa.String(length=255)),
    sa.column("name", sa.String(length=255)),
    sa.column("site_url", sa.String(length=255)),
    sa.column("success_text_class", sa.String(length=255)),
    sa.column("expected_success_text", sa.Text()),
    sa.column("required_cookies", sa.JSON()),
    sa.column("login_type", sa.String(length=32)),
    sa.column("selenium_config", sa.JSON()),
    sa.column("api_config", sa.JSON()),
    sa.column("owner_user_id", sa.String(length=255)),
)

feed_table = sa.table(
    "feed",
    sa.column("id", sa.String(length=255)),
    sa.column("owner_user_id", sa.String(length=255)),
    sa.column("site_config_id", sa.String(length=255)),
    sa.column("site_login_credential_id", sa.String(length=255)),
)

credential_table = sa.table(
    "credential",
    sa.column("id", sa.String(length=255)),
    sa.column("owner_user_id", sa.String(length=255)),
    sa.column("site_config_id", sa.String(length=255)),
)

cookie_table = sa.table(
    "cookie",
    sa.column("id", sa.String(length=255)),
    sa.column("owner_user_id", sa.String(length=255)),
    sa.column("credential_id", sa.String(length=255)),
    sa.column("site_config_id", sa.String(length=255)),
)


logger = logging.getLogger("alembic.runtime.migration")


def _generate_siteconfig_id() -> str:
    return f"sc_{uuid4().hex[:12]}"


def upgrade() -> None:
    conn = op.get_bind()

    legacy_configs = list(
        conn.execute(
            sa.select(siteconfig_table).where(siteconfig_table.c.owner_user_id.is_(None))
        ).mappings()
    )

    for row in legacy_configs:
        config_id = row["id"]
        base_payload = {
            key: row[key]
            for key in row.keys()
            if key not in {"id", "owner_user_id"}
        }

        feed_owner_values = conn.execute(
            sa.select(feed_table.c.owner_user_id).where(
                feed_table.c.site_config_id == config_id
            )
        ).scalars()
        feed_owner_values = list(feed_owner_values)

        credential_rows = list(
            conn.execute(
                sa.select(
                    credential_table.c.id,
                    credential_table.c.owner_user_id,
                ).where(credential_table.c.site_config_id == config_id)
            ).mappings()
        )

        cookie_rows = list(
            conn.execute(
                sa.select(
                    cookie_table.c.id,
                    cookie_table.c.owner_user_id,
                    cookie_table.c.credential_id,
                ).where(cookie_table.c.site_config_id == config_id)
            ).mappings()
        )

        owner_set: set[str] = set(
            owner for owner in feed_owner_values if owner is not None
        )

        credential_ids_by_owner: dict[str, list[str]] = {}
        ownerless_credentials: list[str] = []
        for cred_row in credential_rows:
            cred_owner = cred_row["owner_user_id"]
            cred_id = cred_row["id"]
            if cred_owner:
                owner_set.add(cred_owner)
                credential_ids_by_owner.setdefault(cred_owner, []).append(cred_id)
            else:
                ownerless_credentials.append(cred_id)

        cookie_owner_map: dict[str, set[str]] = {}
        for cookie_row in cookie_rows:
            cookie_owner = cookie_row["owner_user_id"]
            credential_id = cookie_row["credential_id"]
            if cookie_owner:
                owner_set.add(cookie_owner)
                cookie_owner_map.setdefault(credential_id, set()).add(cookie_owner)

        if ownerless_credentials:
            feed_owner_map: dict[str, set[str]] = {}
            feed_for_credentials = conn.execute(
                sa.select(
                    feed_table.c.site_login_credential_id,
                    feed_table.c.owner_user_id,
                ).where(feed_table.c.site_login_credential_id.in_(ownerless_credentials))
            ).mappings()
            for feed_row in feed_for_credentials:
                candidate_owner = feed_row["owner_user_id"]
                credential_id = feed_row["site_login_credential_id"]
                if candidate_owner:
                    feed_owner_map.setdefault(credential_id, set()).add(candidate_owner)

            for cred_id in ownerless_credentials:
                owner_candidates = set()
                owner_candidates.update(feed_owner_map.get(cred_id, set()))
                owner_candidates.update(cookie_owner_map.get(cred_id, set()))

                if len(owner_candidates) == 1:
                    inferred_owner = next(iter(owner_candidates))
                    conn.execute(
                        credential_table.update()
                        .where(credential_table.c.id == cred_id)
                        .values(owner_user_id=inferred_owner)
                    )
                    owner_set.add(inferred_owner)
                    credential_ids_by_owner.setdefault(inferred_owner, []).append(cred_id)
                else:
                    if owner_candidates:
                        logger.warning(
                            "Deleting credential %s for siteconfig %s; multiple owners discovered (%s)",
                            cred_id,
                            config_id,
                            ", ".join(sorted(owner_candidates)),
                        )
                    else:
                        logger.warning(
                            "Deleting credential %s for siteconfig %s; unable to infer owner",
                            cred_id,
                            config_id,
                        )
                    conn.execute(
                        cookie_table.delete().where(
                            cookie_table.c.credential_id == cred_id
                        )
                    )
                    conn.execute(
                        credential_table.delete().where(
                            credential_table.c.id == cred_id
                        )
                    )

        if not owner_set:
            if feed_owner_values or credential_rows or cookie_rows:
                logger.warning(
                    "Removing global siteconfig %s with dependent records; ensure replacements exist",
                    config_id,
                )
            else:
                logger.info(
                    "Removing unused global siteconfig %s", config_id
                )

            conn.execute(
                feed_table.update()
                .where(feed_table.c.site_config_id == config_id)
                .values(site_config_id=None)
            )
            conn.execute(
                siteconfig_table.delete().where(siteconfig_table.c.id == config_id)
            )
            continue

        owners = sorted(owner_set)
        primary_owner = owners[0]

        conn.execute(
            siteconfig_table.update()
            .where(siteconfig_table.c.id == config_id)
            .values(owner_user_id=primary_owner)
        )

        conn.execute(
            feed_table.update()
            .where(
                sa.and_(
                    feed_table.c.site_config_id == config_id,
                    feed_table.c.owner_user_id.is_(None),
                )
            )
            .values(site_config_id=None)
        )

        if len(owners) > 1:
            logger.warning(
                "Cloning global siteconfig %s for additional owners: %s (primary owner %s)",
                config_id,
                ", ".join(owners[1:]),
                primary_owner,
            )

        clone_ids: dict[str, str] = {}
        for owner in owners[1:]:
            clone_id = _generate_siteconfig_id()
            clone_ids[owner] = clone_id
            insert_payload = dict(base_payload)
            insert_payload["id"] = clone_id
            insert_payload["owner_user_id"] = owner
            conn.execute(siteconfig_table.insert().values(insert_payload))

        for owner in owners:
            target_siteconfig_id = config_id if owner == primary_owner else clone_ids[owner]
            conn.execute(
                feed_table.update()
                .where(
                    sa.and_(
                        feed_table.c.site_config_id == config_id,
                        feed_table.c.owner_user_id == owner,
                    )
                )
                .values(site_config_id=target_siteconfig_id)
            )

            owner_credential_ids = credential_ids_by_owner.get(owner, [])
            if owner_credential_ids:
                conn.execute(
                    credential_table.update()
                    .where(
                        sa.and_(
                            credential_table.c.site_config_id == config_id,
                            credential_table.c.owner_user_id == owner,
                            credential_table.c.id.in_(owner_credential_ids),
                        )
                    )
                    .values(site_config_id=target_siteconfig_id)
                )
                conn.execute(
                    cookie_table.update()
                    .where(
                        sa.and_(
                            cookie_table.c.site_config_id == config_id,
                            cookie_table.c.credential_id.in_(owner_credential_ids),
                        )
                    )
                    .values(site_config_id=target_siteconfig_id, owner_user_id=owner)
                )

        conn.execute(
            credential_table.delete()
            .where(
                sa.and_(
                    credential_table.c.site_config_id == config_id,
                    credential_table.c.owner_user_id.is_(None),
                )
            )
        )
        conn.execute(
            cookie_table.delete()
            .where(
                sa.and_(
                    cookie_table.c.site_config_id == config_id,
                    cookie_table.c.owner_user_id.is_(None),
                )
            )
        )

    remaining_nulls = conn.execute(
        sa.select(sa.func.count())
        .select_from(siteconfig_table)
        .where(siteconfig_table.c.owner_user_id.is_(None))
    ).scalar_one()
    if remaining_nulls:
        raise RuntimeError(
            "siteconfig.owner_user_id still contains NULL values after cleanup"
        )

    op.create_check_constraint(
        "ck_siteconfig_owner_not_empty",
        "siteconfig",
        "owner_user_id <> ''",
    )
    op.alter_column(
        "siteconfig",
        "owner_user_id",
        existing_type=sa.String(length=255),
        nullable=False,
    )


def downgrade() -> None:
    # NOTE: Global siteconfigs removed during upgrade are not recreated here.
    op.alter_column(
        "siteconfig",
        "owner_user_id",
        existing_type=sa.String(length=255),
        nullable=True,
    )
    op.drop_constraint(
        "ck_siteconfig_owner_not_empty",
        "siteconfig",
        type_="check",
    )
