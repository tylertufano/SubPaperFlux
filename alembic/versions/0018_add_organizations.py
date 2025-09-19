"""Add organizations and memberships.

Revision ID: 0018_add_organizations
Revises: 0017_credential_description
Create Date: 2025-10-06

"""

from alembic import op
import sqlalchemy as sa

from app.organization_defaults import (
    DEFAULT_ORGANIZATION_DESCRIPTION,
    DEFAULT_ORGANIZATION_ID,
    DEFAULT_ORGANIZATION_NAME,
    DEFAULT_ORGANIZATION_SLUG,
)

# revision identifiers, used by Alembic.
revision = "0018_add_organizations"
down_revision = "0017_credential_description"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "organizations",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("slug", sa.String(length=255), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column(
            "is_default",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("slug", name="uq_organizations_slug"),
        sa.UniqueConstraint("name", name="uq_organizations_name"),
    )
    op.create_index(
        "ix_organizations_is_default", "organizations", ["is_default"], unique=False
    )

    op.create_table(
        "organization_memberships",
        sa.Column("organization_id", sa.String(), nullable=False),
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.PrimaryKeyConstraint("organization_id", "user_id"),
        sa.UniqueConstraint(
            "organization_id",
            "user_id",
            name="uq_organization_memberships_org_user",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id"], ["organizations.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
    )
    op.create_index(
        "ix_organization_memberships_user_id",
        "organization_memberships",
        ["user_id"],
        unique=False,
    )

    op.execute(
        sa.text(
            """
            INSERT INTO organizations (id, slug, name, description, is_default, created_at, updated_at)
            VALUES (:id, :slug, :name, :description, :is_default, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            """
        ).bindparams(
            sa.bindparam("id", value=DEFAULT_ORGANIZATION_ID),
            sa.bindparam("slug", value=DEFAULT_ORGANIZATION_SLUG),
            sa.bindparam("name", value=DEFAULT_ORGANIZATION_NAME),
            sa.bindparam("description", value=DEFAULT_ORGANIZATION_DESCRIPTION),
            sa.bindparam("is_default", value=True),
        )
    )

    op.execute(
        sa.text(
            """
            INSERT INTO organization_memberships (organization_id, user_id, created_at)
            SELECT :organization_id, id, CURRENT_TIMESTAMP
            FROM users
            """
        ).bindparams(
            sa.bindparam("organization_id", value=DEFAULT_ORGANIZATION_ID)
        )
    )


def downgrade() -> None:
    op.drop_index(
        "ix_organization_memberships_user_id", table_name="organization_memberships"
    )
    op.drop_table("organization_memberships")

    op.drop_index("ix_organizations_is_default", table_name="organizations")
    op.drop_table("organizations")
