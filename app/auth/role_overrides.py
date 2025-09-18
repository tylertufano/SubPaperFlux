"""Helpers for persisting manual role override choices on ``User`` records."""

from __future__ import annotations

from collections.abc import Iterable, Mapping, MutableMapping
from dataclasses import dataclass
from typing import Any

from ..models import User

ROLE_OVERRIDES_CLAIM = "role_overrides"
ROLE_OVERRIDE_PRESERVE = "preserve"
ROLE_OVERRIDE_SUPPRESS = "suppress"


def _normalize_role_names(values: Iterable[str] | None) -> frozenset[str]:
    if not values:
        return frozenset()
    if isinstance(values, str):
        values = [values]
    normalized = {str(value).strip() for value in values if value is not None}
    normalized.discard("")
    return frozenset(normalized)


@dataclass(frozen=True)
class RoleOverrides:
    """Value object representing stored role override preferences."""

    preserve: frozenset[str] = frozenset()
    suppress: frozenset[str] = frozenset()

    @classmethod
    def from_iterables(
        cls,
        *,
        preserve: Iterable[str] | None = None,
        suppress: Iterable[str] | None = None,
    ) -> RoleOverrides:
        return cls(
            preserve=_normalize_role_names(preserve),
            suppress=_normalize_role_names(suppress),
        )

    def is_empty(self) -> bool:
        return not self.preserve and not self.suppress

    def to_jsonable(self) -> MutableMapping[str, list[str]]:
        data: MutableMapping[str, list[str]] = {}
        if self.preserve:
            data[ROLE_OVERRIDE_PRESERVE] = sorted(self.preserve)
        if self.suppress:
            data[ROLE_OVERRIDE_SUPPRESS] = sorted(self.suppress)
        return data


def _claims_mapping(claims: Any) -> Mapping[str, Any]:
    if isinstance(claims, Mapping):
        return claims
    return {}


def _parse_role_overrides(raw: Any) -> RoleOverrides:
    if not isinstance(raw, Mapping):
        return RoleOverrides()
    preserve = raw.get(ROLE_OVERRIDE_PRESERVE)
    suppress = raw.get(ROLE_OVERRIDE_SUPPRESS)
    preserve_values: Iterable[str] | None
    suppress_values: Iterable[str] | None
    if isinstance(preserve, str):
        preserve_values = [preserve]
    elif isinstance(preserve, Iterable):
        preserve_values = preserve
    else:
        preserve_values = None
    if isinstance(suppress, str):
        suppress_values = [suppress]
    elif isinstance(suppress, Iterable):
        suppress_values = suppress
    else:
        suppress_values = None
    return RoleOverrides.from_iterables(
        preserve=preserve_values,
        suppress=suppress_values,
    )


def get_user_role_overrides(user: User) -> RoleOverrides:
    """Return the override metadata stored on ``user`` if any."""

    claims = _claims_mapping(user.claims)
    return _parse_role_overrides(claims.get(ROLE_OVERRIDES_CLAIM))


def set_user_role_overrides(
    user: User,
    overrides: RoleOverrides | None = None,
    *,
    preserve: Iterable[str] | None = None,
    suppress: Iterable[str] | None = None,
) -> RoleOverrides:
    """Persist ``overrides`` onto ``user.claims``.

    Either ``overrides`` must be provided or ``preserve``/``suppress`` iterables
    describing the desired state.
    """

    if overrides is not None and (preserve is not None or suppress is not None):
        raise ValueError("Provide either overrides or preserve/suppress values, not both")
    if overrides is None:
        overrides = RoleOverrides.from_iterables(preserve=preserve, suppress=suppress)

    claims = dict(_claims_mapping(user.claims))
    data = overrides.to_jsonable()
    if data:
        claims[ROLE_OVERRIDES_CLAIM] = data
    else:
        claims.pop(ROLE_OVERRIDES_CLAIM, None)
    user.claims = claims
    return overrides


def merge_claims_with_overrides(
    new_claims: Mapping[str, Any] | None,
    existing_claims: Mapping[str, Any] | None,
) -> MutableMapping[str, Any]:
    """Merge ``existing_claims`` overrides into ``new_claims`` when absent."""

    merged: MutableMapping[str, Any] = dict(_claims_mapping(new_claims))
    if ROLE_OVERRIDES_CLAIM in merged and isinstance(merged[ROLE_OVERRIDES_CLAIM], Mapping):
        return merged

    overrides = RoleOverrides()
    if existing_claims is not None:
        overrides = _parse_role_overrides(_claims_mapping(existing_claims).get(ROLE_OVERRIDES_CLAIM))
    if overrides.is_empty():
        return merged

    merged[ROLE_OVERRIDES_CLAIM] = overrides.to_jsonable()
    return merged
