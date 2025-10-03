"""Add schedule names to job schedules.

Revision ID: 0011_job_schedule_names
Revises: 0010_job_run_timestamps
Create Date: 2024-05-17 00:00:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0011_job_schedule_names"
down_revision = "0010_job_run_timestamps"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "job_schedule",
        sa.Column("schedule_name", sa.String(length=255), nullable=True),
    )
    op.execute("UPDATE job_schedule SET schedule_name = id")
    op.alter_column("job_schedule", "schedule_name", nullable=False)
    op.create_index(
        "ix_job_schedule_schedule_name",
        "job_schedule",
        ["schedule_name"],
        unique=False,
    )
    op.create_unique_constraint(
        "uq_job_schedule_owner_name",
        "job_schedule",
        ["owner_user_id", "schedule_name"],
    )


def downgrade() -> None:
    op.drop_constraint(
        "uq_job_schedule_owner_name",
        "job_schedule",
        type_="unique",
    )
    op.drop_index("ix_job_schedule_schedule_name", table_name="job_schedule")
    op.drop_column("job_schedule", "schedule_name")
