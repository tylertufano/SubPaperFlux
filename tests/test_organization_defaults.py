import sys
from pathlib import Path

from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel, Session, create_engine, select

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.models import Organization, OrganizationMembership, User  # noqa: E402
from app.organization_defaults import (  # noqa: E402
    ensure_default_organization,
    ensure_organization_membership,
)


def test_ensure_default_org_membership_idempotent():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)

    with Session(engine) as session:
        session.add(User(id="demo-user"))
        session.commit()

    for _ in range(2):
        with Session(engine) as session:
            organization = ensure_default_organization(session)
            ensure_organization_membership(
                session,
                organization_id=organization.id,
                user_id="demo-user",
            )
            session.commit()

    with Session(engine) as session:
        organizations = session.exec(select(Organization)).all()
        memberships = session.exec(select(OrganizationMembership)).all()

    assert len(organizations) == 1
    assert organizations[0].is_default
    assert len(memberships) == 1
    assert memberships[0].organization_id == organizations[0].id
    assert memberships[0].user_id == "demo-user"
