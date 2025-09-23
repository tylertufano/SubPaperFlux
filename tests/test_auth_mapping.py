import sys
from importlib import util
from pathlib import Path
from types import ModuleType

import pytest

_MAPPING_PATH = Path(__file__).resolve().parents[1] / "app" / "auth" / "mapping.py"
_SPEC = util.spec_from_file_location("app.auth.mapping", _MAPPING_PATH)
assert _SPEC is not None and _SPEC.loader is not None
_MODULE = util.module_from_spec(_SPEC)

sys.modules.setdefault("app", ModuleType("app"))
sys.modules.setdefault("app.auth", ModuleType("app.auth"))
sys.modules["app"].__path__ = []  # type: ignore[attr-defined]
sys.modules["app.auth"].__path__ = []  # type: ignore[attr-defined]
sys.modules[_SPEC.name] = _MODULE
_SPEC.loader.exec_module(_MODULE)

load_group_role_config = _MODULE.load_group_role_config
resolve_roles_for_groups = _MODULE.resolve_roles_for_groups


@pytest.fixture(autouse=True)
def _clear_env(monkeypatch):
    monkeypatch.delenv("OIDC_GROUP_ROLE_MAP", raising=False)
    monkeypatch.delenv("OIDC_GROUP_ROLE_DEFAULTS", raising=False)


def test_load_group_role_config_parses_map_and_defaults(monkeypatch):
    monkeypatch.setenv(
        "OIDC_GROUP_ROLE_MAP",
        "team-one=role-viewer,team-two=role-editor\nteam-one=role-admin",
    )
    monkeypatch.setenv(
        "OIDC_GROUP_ROLE_DEFAULTS",
        "default-one, default-two\n",
    )

    cfg = load_group_role_config()

    assert cfg.group_role_map["team-one"] == frozenset({"role-viewer", "role-admin"})
    assert cfg.group_role_map["team-two"] == frozenset({"role-editor"})
    assert cfg.default_roles == frozenset({"default-one", "default-two"})


def test_load_group_role_config_trims_whitespace(monkeypatch):
    monkeypatch.setenv(
        "OIDC_GROUP_ROLE_MAP",
        "  team-alpha = role-reader  ,   team-beta= role-writer   ",
    )

    cfg = load_group_role_config()

    assert set(cfg.group_role_map.keys()) == {"team-alpha", "team-beta"}
    assert cfg.group_role_map["team-alpha"] == frozenset({"role-reader"})
    assert cfg.group_role_map["team-beta"] == frozenset({"role-writer"})


def test_load_group_role_config_normalizes_group_names(monkeypatch):
    monkeypatch.setenv(
        "OIDC_GROUP_ROLE_MAP",
        "Team-Alpha=role-reader,TEAM-ALPHA=role-writer",
    )

    cfg = load_group_role_config()

    assert set(cfg.group_role_map.keys()) == {"team-alpha"}
    assert cfg.group_role_map["team-alpha"] == frozenset({"role-reader", "role-writer"})


@pytest.mark.parametrize(
    "value",
    [
        "team-no-equals",
        "team-missing-role=",
        "=missing-group",
    ],
)
def test_load_group_role_config_invalid_token_raises(monkeypatch, value):
    monkeypatch.setenv("OIDC_GROUP_ROLE_MAP", value)

    with pytest.raises(ValueError):
        load_group_role_config()


def test_resolve_roles_for_groups(monkeypatch):
    monkeypatch.setenv(
        "OIDC_GROUP_ROLE_MAP",
        "group-a=role-alpha,group-b=role-beta",
    )
    monkeypatch.setenv(
        "OIDC_GROUP_ROLE_DEFAULTS",
        "default-role",
    )

    roles = resolve_roles_for_groups([" group-a ", "unknown", "group-a", "", "group-b"])

    assert roles == frozenset({"default-role", "role-alpha", "role-beta"})


def test_resolve_roles_for_groups_normalizes_case(monkeypatch):
    monkeypatch.setenv(
        "OIDC_GROUP_ROLE_MAP",
        "Team-Admin=role-admin,TEAM-ADMIN=role-operator",
    )
    monkeypatch.setenv("OIDC_GROUP_ROLE_DEFAULTS", "Default-Role")

    roles = resolve_roles_for_groups(["team-admin", "TEAM-ADMIN", "Team-Admin", "unknown"])

    assert roles == frozenset({"Default-Role", "role-admin", "role-operator"})
