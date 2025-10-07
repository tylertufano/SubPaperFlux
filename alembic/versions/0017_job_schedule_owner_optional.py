import logging

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0017_job_schedule_owner_optional"
down_revision = "0016_job_schedule_owner_required"
branch_labels = None
depends_on = None


LEGACY_OWNER_PLACEHOLDER = "__legacy_global_schedule__"

job_schedule_table = sa.table(
    "job_schedule",
    sa.column("id", sa.String(length=255)),
    sa.column("schedule_name", sa.String(length=255)),
    sa.column("owner_user_id", sa.String(length=255)),
    sa.column("is_active", sa.Boolean()),
)


logger = logging.getLogger("alembic.runtime.migration")


def upgrade() -> None:
    conn = op.get_bind()

    legacy_rows = list(
        conn.execute(
            sa.select(job_schedule_table.c.id, job_schedule_table.c.schedule_name)
            .where(job_schedule_table.c.owner_user_id == LEGACY_OWNER_PLACEHOLDER)
            .order_by(job_schedule_table.c.id)
        ).mappings()
    )

    if legacy_rows:
        legacy_ids = [row["id"] for row in legacy_rows]
        logger.warning(
            "Restoring %s job schedule(s) previously migrated with placeholder owner '%s'. IDs: %s",
            len(legacy_ids),
            LEGACY_OWNER_PLACEHOLDER,
            ", ".join(legacy_ids),
        )
        op.execute(
            job_schedule_table.update()
            .where(job_schedule_table.c.owner_user_id == LEGACY_OWNER_PLACEHOLDER)
            .values(owner_user_id=None)
        )

    op.alter_column(
        "job_schedule",
        "owner_user_id",
        existing_type=sa.String(length=255),
        nullable=True,
    )


def downgrade() -> None:
    conn = op.get_bind()

    null_rows = list(
        conn.execute(
            sa.select(job_schedule_table.c.id, job_schedule_table.c.schedule_name)
            .where(job_schedule_table.c.owner_user_id.is_(None))
            .order_by(job_schedule_table.c.id)
        ).mappings()
    )

    if null_rows:
        null_ids = [row["id"] for row in null_rows]
        logger.warning(
            "Found %s job schedule(s) without an owner. Assigning placeholder '%s' and disabling them for manual cleanup. IDs: %s",
            len(null_ids),
            LEGACY_OWNER_PLACEHOLDER,
            ", ".join(null_ids),
        )
        op.execute(
            job_schedule_table.update()
            .where(job_schedule_table.c.owner_user_id.is_(None))
            .values(owner_user_id=LEGACY_OWNER_PLACEHOLDER, is_active=False)
        )

    op.alter_column(
        "job_schedule",
        "owner_user_id",
        existing_type=sa.String(length=255),
        nullable=False,
    )
