"""Add job schedules table.

Revision ID: 0020_job_schedules
Revises: 0019_site_settings
Create Date: 2024-06-01

"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0020_job_schedules"
down_revision = "0019_site_settings"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "job_schedule",
        sa.Column("id", sa.String(length=255), nullable=False),
        sa.Column("job_type", sa.String(length=255), nullable=False),
        sa.Column("owner_user_id", sa.String(), nullable=True),
        sa.Column("payload", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("frequency", sa.String(length=255), nullable=False),
        sa.Column("next_run_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_run_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_job_id", sa.String(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_job_schedule_job_type", "job_schedule", ["job_type"], unique=False)
    op.create_index("ix_job_schedule_owner_user_id", "job_schedule", ["owner_user_id"], unique=False)
    op.create_index("ix_job_schedule_next_run_at", "job_schedule", ["next_run_at"], unique=False)
    op.create_index("ix_job_schedule_is_active", "job_schedule", ["is_active"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_job_schedule_is_active", table_name="job_schedule")
    op.drop_index("ix_job_schedule_next_run_at", table_name="job_schedule")
    op.drop_index("ix_job_schedule_owner_user_id", table_name="job_schedule")
    op.drop_index("ix_job_schedule_job_type", table_name="job_schedule")
    op.drop_table("job_schedule")
