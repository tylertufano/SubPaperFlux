"""Add feed.last_rss_poll_at

Revision ID: 0013_feed_last_rss_poll_at
Revises: 0012_feed_folder_and_tags
Create Date: 2024-09-05 00:00:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0013_feed_last_rss_poll_at"
down_revision = "0012_feed_folder_and_tags"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "feed",
        sa.Column("last_rss_poll_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("feed", "last_rss_poll_at")
