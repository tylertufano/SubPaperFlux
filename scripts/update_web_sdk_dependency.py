#!/usr/bin/env python3
"""Sync the web workspace's SDK dependency with the published SDK version.

Reads the SDK package metadata and ensures web/package.json plus the lock file
reference the same semver range (caret-pinned to the SDK version).
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys
from typing import Any, Dict

DEFAULT_SDK_PACKAGE = Path('sdk/ts/package.json')
DEFAULT_WEB_PACKAGE = Path('web/package.json')
DEFAULT_WEB_LOCK = Path('web/package-lock.json')
DEPENDENCY_NAME = '@subpaperflux/sdk'


def load_json(path: Path) -> Dict[str, Any]:
    try:
        return json.loads(path.read_text())
    except FileNotFoundError:
        raise SystemExit(f'Missing file: {path}')


def save_json(path: Path, payload: Dict[str, Any]) -> None:
    path.write_text(json.dumps(payload, indent=2) + '\n')


def ensure_dependency(lock_data: Dict[str, Any], version: str) -> None:
    packages = lock_data.setdefault('packages', {})
    root_pkg = packages.setdefault('', {})
    deps = root_pkg.setdefault('dependencies', {})
    deps[DEPENDENCY_NAME] = f'^{version}'

    # Also update the flattened dependency map when present.
    flat_deps = lock_data.setdefault('dependencies', {})
    dep_entry = flat_deps.setdefault(DEPENDENCY_NAME, {})
    dep_entry['version'] = version


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sdk-package', type=Path, default=DEFAULT_SDK_PACKAGE)
    parser.add_argument('--web-package', type=Path, default=DEFAULT_WEB_PACKAGE)
    parser.add_argument('--web-lock', type=Path, default=DEFAULT_WEB_LOCK)
    args = parser.parse_args()

    sdk_pkg = load_json(args.sdk_package)
    sdk_version = sdk_pkg.get('version')
    if not sdk_version:
        raise SystemExit('SDK package.json is missing a version field')

    web_pkg = load_json(args.web_package)
    dependencies = web_pkg.setdefault('dependencies', {})
    dependencies[DEPENDENCY_NAME] = f'^{sdk_version}'

    save_json(args.web_package, web_pkg)

    if args.web_lock.exists():
        lock_data = load_json(args.web_lock)
        ensure_dependency(lock_data, sdk_version)
        save_json(args.web_lock, lock_data)


if __name__ == '__main__':
    try:
        main()
    except SystemExit as exc:  # pragma: no cover - CLI helper
        if exc.code:
            print(exc, file=sys.stderr)
        raise
