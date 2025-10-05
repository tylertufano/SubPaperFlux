"""Add feed folder reference and ordered tag link table

Revision ID: 0012_feed_folder_and_tags
Revises: 0011_job_schedule_names
Create Date: 2024-08-30 00:00:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
import sqlmodel


# revision identifiers, used by Alembic.
revision = "0012_feed_folder_and_tags"
down_revision = "0011_job_schedule_names"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "feed",
        sa.Column(
            "folder_id",
            sqlmodel.sql.sqltypes.AutoString(),
            nullable=True,
        ),
    )
    op.create_foreign_key(
        "fk_feed_folder_id_folder",
        "feed",
        "folder",
        ["folder_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        op.f("ix_feed_folder_id"),
        "feed",
        ["folder_id"],
        unique=False,
    )

    op.create_table(
        "feed_tag_link",
        sa.Column("feed_id", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("tag_id", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint("feed_id", "tag_id"),
        sa.UniqueConstraint(
            "feed_id",
            "tag_id",
            name="uq_feed_tag_link_feed_tag",
        ),
        sa.ForeignKeyConstraint([
            "feed_id"
        ], [
            "feed.id"
        ], ondelete="CASCADE"),
        sa.ForeignKeyConstraint([
            "tag_id"
        ], [
            "tag.id"
        ], ondelete="CASCADE"),
    )
    op.create_index(
        "ix_feed_tag_link_feed_id",
        "feed_tag_link",
        ["feed_id"],
        unique=False,
    )
    op.create_index(
        "ix_feed_tag_link_tag_id",
        "feed_tag_link",
        ["tag_id"],
        unique=False,
    )
    op.create_index(
        "ix_feed_tag_link_position",
        "feed_tag_link",
        ["position"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_feed_tag_link_position", table_name="feed_tag_link")
    op.drop_index("ix_feed_tag_link_tag_id", table_name="feed_tag_link")
    op.drop_index("ix_feed_tag_link_feed_id", table_name="feed_tag_link")
    op.drop_table("feed_tag_link")

    op.drop_index(op.f("ix_feed_folder_id"), table_name="feed")
    op.drop_constraint("fk_feed_folder_id_folder", "feed", type_="foreignkey")
    op.drop_column("feed", "folder_id")
