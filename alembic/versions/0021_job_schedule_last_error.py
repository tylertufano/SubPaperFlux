"""Add error tracking columns to job schedules.

Revision ID: 0021_job_schedule_last_error
Revises: 0020_job_schedules
Create Date: 2024-09-24

"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0021_job_schedule_last_error"
down_revision = "0020_job_schedules"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "job_schedule",
        sa.Column("last_error", sa.Text(), nullable=True),
    )
    op.add_column(
        "job_schedule",
        sa.Column("last_error_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("job_schedule", "last_error_at")
    op.drop_column("job_schedule", "last_error")
