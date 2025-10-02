"""Add job created_at and run_at timestamps

Revision ID: 0010_job_run_timestamps
Revises: 0009_siteconfig_success_text_and_cookies
Create Date: 2024-05-16 00:00:00.000000
"""

from __future__ import annotations

from datetime import datetime, timezone

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0010_job_run_timestamps"
down_revision = "0009_siteconfig_success_text_and_cookies"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "job",
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "job",
        sa.Column("run_at", sa.DateTime(timezone=True), nullable=True),
    )

    job_table = sa.table(
        "job",
        sa.column("created_at", sa.DateTime(timezone=True)),
    )

    now = datetime.now(timezone.utc)
    op.execute(
        job_table.update()
        .where(job_table.c.created_at.is_(None))
        .values(created_at=now)
    )

    op.alter_column("job", "created_at", nullable=False)
    op.create_index("ix_job_created_at", "job", ["created_at"], unique=False)
    op.create_index("ix_job_run_at", "job", ["run_at"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_job_run_at", table_name="job")
    op.drop_index("ix_job_created_at", table_name="job")
    op.drop_column("job", "run_at")
    op.drop_column("job", "created_at")
