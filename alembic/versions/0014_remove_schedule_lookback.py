"""Remove lookback from job schedule payloads

Revision ID: 0014_remove_schedule_lookback
Revises: 0013_feed_last_rss_poll_at
Create Date: 2024-09-06 00:00:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0014_remove_schedule_lookback"
down_revision = "0013_feed_last_rss_poll_at"
branch_labels = None
depends_on = None


job_schedule = sa.table(
    "job_schedule",
    sa.column("id", sa.String()),
    sa.column("payload", sa.JSON().with_variant(sa.Text(), "sqlite")),
)


def upgrade() -> None:
    connection = op.get_bind()
    rows = connection.execute(
        sa.select(job_schedule.c.id, job_schedule.c.payload)
    ).fetchall()
    for schedule_id, payload in rows:
        if not isinstance(payload, dict):
            continue
        if "lookback" not in payload:
            continue
        new_payload = dict(payload)
        new_payload.pop("lookback", None)
        connection.execute(
            sa.update(job_schedule)
            .where(job_schedule.c.id == schedule_id)
            .values(payload=new_payload)
        )


def downgrade() -> None:
    # No-op: legacy lookback values are intentionally removed.
    pass
