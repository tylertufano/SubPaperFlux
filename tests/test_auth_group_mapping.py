from __future__ import annotations

from pathlib import Path

import pytest


@pytest.fixture(autouse=True)
def _clear_env(monkeypatch):
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parents[1]))
    monkeypatch.delenv("OIDC_GROUP_ROLE_MAP", raising=False)
    monkeypatch.delenv("OIDC_GROUP_ROLE_DEFAULTS", raising=False)


def test_load_group_role_config_merges_entries(monkeypatch):
    from app.auth.mapping import load_group_role_config

    monkeypatch.setenv(
        "OIDC_GROUP_ROLE_MAP",
        "team-alpha=role-reader, team-beta=role-writer\nteam-alpha=role-admin",
    )
    monkeypatch.setenv(
        "OIDC_GROUP_ROLE_DEFAULTS",
        "default-one, default-two\n",
    )

    config = load_group_role_config()

    assert set(config.group_role_map.keys()) == {"team-alpha", "team-beta"}
    assert config.group_role_map["team-alpha"] == frozenset({"role-reader", "role-admin"})
    assert config.group_role_map["team-beta"] == frozenset({"role-writer"})
    assert config.default_roles == frozenset({"default-one", "default-two"})


@pytest.mark.parametrize(
    "value",
    [
        "team-no-equals",
        "team-missing-role=",
        "=missing-group",
    ],
)
def test_load_group_role_config_invalid_entries(monkeypatch, value):
    from app.auth.mapping import load_group_role_config

    monkeypatch.setenv("OIDC_GROUP_ROLE_MAP", value)

    with pytest.raises(ValueError):
        load_group_role_config()


def test_resolve_roles_for_groups_includes_defaults(monkeypatch):
    from app.auth.mapping import resolve_roles_for_groups

    monkeypatch.setenv(
        "OIDC_GROUP_ROLE_MAP",
        "team-one=role-alpha,team-two=role-beta",
    )
    monkeypatch.setenv("OIDC_GROUP_ROLE_DEFAULTS", "default-role")

    roles = resolve_roles_for_groups([" team-one ", None, "", "team-two", "unknown"])

    assert roles == frozenset({"default-role", "role-alpha", "role-beta"})
