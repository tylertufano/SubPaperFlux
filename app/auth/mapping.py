"""Helpers for resolving role assignments from OIDC group claims."""

from __future__ import annotations

import os
from dataclasses import dataclass
from types import MappingProxyType
from typing import FrozenSet, Iterable, Mapping, MutableMapping, Set


@dataclass(frozen=True)
class GroupRoleConfig:
    """Configuration parsed from environment variables."""

    group_role_map: Mapping[str, FrozenSet[str]]
    default_roles: FrozenSet[str]


def _iter_tokens(raw: str) -> Iterable[str]:
    for token in raw.replace("\n", ",").split(","):
        token = token.strip()
        if token:
            yield token


def _parse_group_role_map(raw: str) -> Mapping[str, FrozenSet[str]]:
    mapping: MutableMapping[str, Set[str]] = {}
    for token in _iter_tokens(raw):
        if "=" not in token:
            raise ValueError(f"Invalid group role mapping entry: {token!r}")
        group, role = token.split("=", 1)
        group = group.strip()
        role = role.strip()
        if not group or not role:
            raise ValueError(f"Invalid group role mapping entry: {token!r}")
        mapping.setdefault(group, set()).add(role)
    return MappingProxyType({group: frozenset(roles) for group, roles in mapping.items()})


def _parse_default_roles(raw: str) -> FrozenSet[str]:
    return frozenset(_iter_tokens(raw))


def load_group_role_config() -> GroupRoleConfig:
    """Load group to role mappings from the environment."""

    raw_map = os.getenv("OIDC_GROUP_ROLE_MAP", "")
    raw_defaults = os.getenv("OIDC_GROUP_ROLE_DEFAULTS", "")
    mapping = _parse_group_role_map(raw_map)
    defaults = _parse_default_roles(raw_defaults)
    return GroupRoleConfig(group_role_map=mapping, default_roles=defaults)


def resolve_roles_for_groups(groups: Iterable[str]) -> FrozenSet[str]:
    """Resolve role names for a collection of identity provider groups."""

    config = load_group_role_config()
    resolved: Set[str] = set(config.default_roles)
    for group in groups:
        if group is None:
            continue
        group_name = group.strip()
        if not group_name:
            continue
        roles = config.group_role_map.get(group_name)
        if roles:
            resolved.update(roles)
    return frozenset(resolved)


__all__ = [
    "GroupRoleConfig",
    "load_group_role_config",
    "resolve_roles_for_groups",
]
