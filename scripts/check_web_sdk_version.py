#!/usr/bin/env python3
"""Validate the web workspace SDK dependency matches an expected release version."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys
from typing import Any, Dict

DEPENDENCY_NAME = '@subpaperflux/sdk'


def load_json(path: Path) -> Dict[str, Any]:
    try:
        return json.loads(path.read_text())
    except FileNotFoundError:
        raise SystemExit(f'Missing file: {path}')


def normalize(version: str) -> str:
    for prefix in ('^', '~', '='):
        if version.startswith(prefix):
            return version[len(prefix):]
    if version.startswith('v'):
        return version[1:]
    return version


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('expected_version', help='Release version without leading v')
    parser.add_argument('--web-package', type=Path, default=Path('web/package.json'))
    parser.add_argument('--web-lock', type=Path, default=Path('web/package-lock.json'))
    args = parser.parse_args()

    expected = normalize(args.expected_version)

    web_pkg = load_json(args.web_package)
    deps = web_pkg.get('dependencies', {})
    actual = deps.get(DEPENDENCY_NAME)
    if not actual:
        raise SystemExit(f'{DEPENDENCY_NAME} is not declared in {args.web_package}')

    actual_normalized = normalize(actual)
    if actual_normalized != expected:
        raise SystemExit(
            f'{DEPENDENCY_NAME} in {args.web_package} is {actual}, expected ^{expected}'
        )

    if args.web_lock.exists():
        lock_data = load_json(args.web_lock)
        root_deps = (
            lock_data
            .get('packages', {})
            .get('', {})
            .get('dependencies', {})
        )
        lock_declared = root_deps.get(DEPENDENCY_NAME)
        if lock_declared and normalize(lock_declared) != expected:
            raise SystemExit(
                f'{DEPENDENCY_NAME} in {args.web_lock} root dependencies is {lock_declared}, expected ^{expected}'
            )

        flat_entry = lock_data.get('dependencies', {}).get(DEPENDENCY_NAME)
        if flat_entry:
            version = flat_entry.get('version')
            if version and normalize(version) != expected:
                raise SystemExit(
                    f'{DEPENDENCY_NAME} in {args.web_lock} flattened dependencies is {version}, expected {expected}'
                )


if __name__ == '__main__':
    try:
        main()
    except SystemExit as exc:  # pragma: no cover - CLI helper
        if exc.code:
            print(exc, file=sys.stderr)
        raise
