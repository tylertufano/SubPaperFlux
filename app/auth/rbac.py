import os
from typing import Dict, Iterable


ADMIN_GROUPS_DEFAULT = {"admin", "admins", "administrator", "Administrators"}


def _normalize(groups: Iterable[str]) -> set:
    return {str(g).strip() for g in groups if g is not None}


def is_admin(user: Dict) -> bool:
    groups = _normalize(user.get("groups") or [])
    # Allow overriding/augmenting admin groups via env var (comma-separated)
    extra = os.getenv("ADMIN_GROUPS")
    admin_groups = set(ADMIN_GROUPS_DEFAULT)
    if extra:
        admin_groups |= {g.strip() for g in extra.split(",") if g.strip()}
    return bool(groups & admin_groups)


def _groups_for_env(var: str) -> set:
    extra = os.getenv(var)
    return {g.strip() for g in extra.split(",")} if extra else set()


def can_manage_global_site_configs(user: Dict) -> bool:
    groups = _normalize(user.get("groups") or [])
    return is_admin(user) or bool(groups & _groups_for_env("SITE_CONFIG_ADMIN_GROUPS"))


def can_manage_global_credentials(user: Dict) -> bool:
    groups = _normalize(user.get("groups") or [])
    return is_admin(user) or bool(groups & _groups_for_env("GLOBAL_CREDENTIALS_ADMIN_GROUPS"))
