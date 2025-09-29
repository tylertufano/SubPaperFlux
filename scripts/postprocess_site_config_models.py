#!/usr/bin/env python3
"""Normalize generated site-config discriminated union models.

This script post-processes generated TypeScript SDK models so that
site-config discriminated unions consistently import their variants,
cast branches before serialization, and default to returning the
original union value when serialization encounters an unknown
variant. The script is idempotent and safe to run multiple times.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path
from typing import Iterable

SITE_CONFIG_UNION_PATTERN = re.compile(
    r"export type (?P<type>\w+) = \{ loginType: 'api' \} & (?P<api>SiteConfigApi\w*) \| \{ loginType: 'selenium' \} & (?P<selenium>SiteConfigSelenium\w*);",
    re.MULTILINE,
)


def normalize_imports(text: str, api_variant: str, selenium_variant: str) -> str:
    """Ensure deterministic import blocks for site-config unions."""
    # Remove any existing imports for the variants so we can rebuild them.
    for variant in (api_variant, selenium_variant):
        pattern = rf"^import[^\n]*\./{re.escape(variant)}'\n"
        text = re.sub(pattern, "", text, flags=re.MULTILINE)

    type_comment_idx = text.find("/**\n * @type")
    if type_comment_idx == -1:
        # Fallback: insert before the first export type definition if the comment is missing.
        type_comment_idx = text.find("export type")
        if type_comment_idx == -1:
            return text

    header = text[:type_comment_idx].rstrip()
    rest = text[type_comment_idx:].lstrip("\n")

    import_block = "".join(
        [
            f"import type {{ {api_variant} }} from './{api_variant}'\n",
            f"import {{ {api_variant}FromJSONTyped, {api_variant}ToJSON }} from './{api_variant}'\n",
            f"import type {{ {selenium_variant} }} from './{selenium_variant}'\n",
            f"import {{ {selenium_variant}FromJSONTyped, {selenium_variant}ToJSON }} from './{selenium_variant}'\n\n",
        ]
    )

    if header:
        header = f"{header}\n\n"

    return f"{header}{import_block}{rest}"


def normalize_serialization_switch(text: str, api_variant: str, selenium_variant: str) -> str:
    """Normalise the serialization switch for deterministic output."""
    switch_pattern = re.compile(
        r"switch\s*\(\s*value\['loginType'\]\s*\)\s*\{(?P<body>.*?)\n\s*\}",
        re.DOTALL,
    )

    def replace_switch(match: re.Match[str]) -> str:
        body = match.group('body')
        body = re.sub(
            rf"{re.escape(api_variant)}ToJSON\(value(?:\s+as\s+{re.escape(api_variant)})?\)",
            f"{api_variant}ToJSON(value as {api_variant})",
            body,
        )
        body = re.sub(
            rf"{re.escape(selenium_variant)}ToJSON\(value(?:\s+as\s+{re.escape(selenium_variant)})?\)",
            f"{selenium_variant}ToJSON(value as {selenium_variant})",
            body,
        )
        body = re.sub(
            r"(default:\s*\n\s*)return\s+json;",
            r"\1return value;",
            body,
        )
        return f"switch (value['loginType']) {{{body}\n    }}"

    return switch_pattern.sub(replace_switch, text)


def process_models(models_dir: Path) -> Iterable[Path]:
    updated: list[Path] = []
    for path in sorted(models_dir.glob('*.ts')):
        text = path.read_text()
        match = SITE_CONFIG_UNION_PATTERN.search(text)
        if not match:
            continue
        api_variant = match.group('api')
        selenium_variant = match.group('selenium')

        updated_text = normalize_imports(text, api_variant, selenium_variant)
        updated_text = normalize_serialization_switch(updated_text, api_variant, selenium_variant)

        if updated_text != text:
            path.write_text(updated_text)
            updated.append(path)
    return updated


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print('Usage: postprocess_site_config_models.py <sdk-root>', file=sys.stderr)
        return 2

    sdk_root = Path(argv[1]).resolve()
    models_dir = sdk_root / 'src' / 'models'
    if not models_dir.is_dir():
        # Nothing to do when models directory is absent.
        return 0

    updated = process_models(models_dir)
    for path in updated:
        print(f"Normalised {path.relative_to(sdk_root)}")
    return 0


if __name__ == '__main__':
    raise SystemExit(main(sys.argv))
