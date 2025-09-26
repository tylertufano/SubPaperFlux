"""Simple seeding utility to add demo data into the DB.

Usage:
  DATABASE_URL=... python -m app.seed
"""

from __future__ import annotations

import os
from sqlmodel import Session

from .auth import ensure_admin_role
from .db import engine, init_db
from .models import SiteConfig, Credential, Feed, SiteLoginType
from .organization_defaults import (
    ensure_default_organization,
    ensure_organization_membership,
)
from .security.crypto import encrypt_dict


def seed(user_id: str = "demo-user") -> None:
    init_db()
    with Session(engine) as session:
        # Ensure the built-in admin role exists for RBAC helpers/tests.
        ensure_admin_role(session)
        default_org = ensure_default_organization(session)
        ensure_organization_membership(
            session,
            organization_id=default_org.id,
            user_id=user_id,
        )

        # Global Instapaper app creds (placeholder)
        app_cred = Credential(
            kind="instapaper_app",
            description="Instapaper app credential",
            data=encrypt_dict(
                {
                    "consumer_key": "replace_me",
                    "consumer_secret": "replace_me",
                }
            ),
            owner_user_id=None,
        )
        session.add(app_cred)

        # User Instapaper tokens (placeholder)
        insta = Credential(
            kind="instapaper",
            description="User Instapaper credential",
            data=encrypt_dict(
                {
                    "oauth_token": "replace_me",
                    "oauth_token_secret": "replace_me",
                }
            ),
            owner_user_id=user_id,
        )
        session.add(insta)

        # User Miniflux creds (placeholder)
        mini = Credential(
            kind="miniflux",
            description="User Miniflux credential",
            data=encrypt_dict(
                {
                    "miniflux_url": "http://miniflux:8080",
                    "api_key": "replace_me",
                }
            ),
            owner_user_id=user_id,
        )
        session.add(mini)

        # Global site config example
        sc_global = SiteConfig(
            name="Example Global",
            site_url="https://example.com/login",
            login_type=SiteLoginType.SELENIUM,
            selenium_config={
                "username_selector": "#user",
                "password_selector": "#pass",
                "login_button_selector": "button[type='submit']",
                "cookies_to_store": ["sessionid"],
            },
            owner_user_id=None,
        )
        session.add(sc_global)

        # User site config example
        sc_user = SiteConfig(
            name="Example User",
            site_url="https://example.org/login",
            login_type=SiteLoginType.SELENIUM,
            selenium_config={
                "username_selector": "#email",
                "password_selector": "#password",
                "login_button_selector": "button[type='submit']",
                "cookies_to_store": ["csrftoken", "sessionid"],
            },
            owner_user_id=user_id,
        )
        session.add(sc_user)

        # A feed example
        feed = Feed(
            url="https://example.org/feed.xml",
            poll_frequency="1h",
            is_paywalled=False,
            rss_requires_auth=False,
            owner_user_id=user_id,
        )
        session.add(feed)

        session.commit()


def main():
    user_id = os.getenv("SEED_USER_ID", "demo-user")
    seed(user_id)
    print(f"Seeded demo data for user_id={user_id}")


if __name__ == "__main__":
    main()
