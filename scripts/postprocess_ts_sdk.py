#!/usr/bin/env python3
#!/usr/bin/env python3
"""Normalize generated TypeScript SDK models for site-config unions."""

from __future__ import annotations

import re
import sys
from pathlib import Path
from typing import Iterable

UNION_PATTERN = re.compile(
    r"export\s+type\s+(?P<alias>\w+)\s*=\s*{\s*loginType:\s*'api'\s*}\s*&\s*(?P<api>SiteConfig\w+)\s*\|\s*{\s*loginType:\s*'selenium'\s*}\s*&\s*(?P<selenium>SiteConfig\w+);",
    re.MULTILINE,
)

DEFAULT_RETURN_PATTERN = re.compile(r"(default:\s*\n\s*)return json;", re.MULTILINE)
SERIALIZER_DEFAULT_PATTERN = re.compile(
    r"(switch\s*\(\s*value\['loginType'\]\s*\)\s*\{[\s\S]*?default:\s*\n\s*)return json;",
    re.MULTILINE,
)
PARSER_DEFAULT_PATTERN = re.compile(
    r"(switch\s*\(\s*json\['login_type'\]\s*\)\s*\{[\s\S]*?default:\s*\n\s*)return value;",
    re.MULTILINE,
)

SPLIT_IDENTIFIER_PATTERN = re.compile(r"(SiteConfig(?:Api|Selenium))\s*\n(Out)")

REMOVE_MANUAL_FILES = (
    Path("src/models/SiteConfig.ts"),
    Path("src/models/SiteConfigOut.ts"),
    Path("dist/models/SiteConfig.js"),
    Path("dist/models/SiteConfig.d.ts"),
    Path("dist/models/SiteConfigOut.js"),
    Path("dist/models/SiteConfigOut.d.ts"),
    Path("dist/esm/models/SiteConfig.js"),
    Path("dist/esm/models/SiteConfig.d.ts"),
    Path("dist/esm/models/SiteConfigOut.js"),
    Path("dist/esm/models/SiteConfigOut.d.ts"),
)


def _normalize_split_identifiers(text: str) -> str:
    return SPLIT_IDENTIFIER_PATTERN.sub(r"\1\2", text)


def _build_import_block(variants: Iterable[str]) -> str:
    type_lines = []
    value_lines = []
    for variant in sorted(set(variants)):
        type_lines.append(f"import type {{ {variant} }} from './{variant}';")
        value_lines.append(
            "import { "
            f"{variant}FromJSONTyped, {variant}ToJSON "
            f"}} from './{variant}';"
        )
    return "\n".join(type_lines + value_lines) + ("\n" if type_lines or value_lines else "")


def _inject_imports(text: str, import_block: str) -> str:
    lines = text.splitlines()
    try:
        header_end = next(i for i, line in enumerate(lines) if line.strip() == "*/")
    except StopIteration:
        return text
    insert_at = header_end + 1
    while insert_at < len(lines) and lines[insert_at].strip() == "":
        insert_at += 1
    import_end = insert_at
    while import_end < len(lines) and lines[import_end].strip().startswith('import '):
        import_end += 1
    prefix = lines[:insert_at]
    while prefix and prefix[-1].strip() == "":
        prefix.pop()
    new_lines = prefix + ['']
    if import_block:
        new_lines.extend(import_block.rstrip().splitlines())
        new_lines.append('')
    suffix = lines[import_end:]
    while suffix and suffix[0].strip() == "":
        suffix = suffix[1:]
    cleaned_suffix = []
    purge_extra_imports = True
    for line in suffix:
        stripped = line.strip()
        if purge_extra_imports and stripped.startswith('import '):
            continue
        if stripped.startswith('export type'):
            purge_extra_imports = False
        cleaned_suffix.append(line)
    new_lines.extend(cleaned_suffix)
    return "\n".join(new_lines) + ("\n" if text.endswith("\n") else "")


def _ensure_casts(text: str, api_variant: str, selenium_variant: str) -> str:
    text = re.sub(
        rf"{re.escape(api_variant)}ToJSON\(value\)",
        f"{api_variant}ToJSON(value as {api_variant})",
        text,
    )
    text = re.sub(
        rf"{re.escape(selenium_variant)}ToJSON\(value\)",
        f"{selenium_variant}ToJSON(value as {selenium_variant})",
        text,
    )
    return text


def _patch_union_file(path: Path) -> bool:
    if not path.exists():
        return False
    text = path.read_text()
    original = text
    text = _normalize_split_identifiers(text)
    match = UNION_PATTERN.search(text)
    if not match:
        if text != original:
            path.write_text(text)
            return True
        return False
    api_variant = match.group('api')
    selenium_variant = match.group('selenium')
    import_block = _build_import_block((api_variant, selenium_variant))
    text = _inject_imports(text, import_block)
    text = _ensure_casts(text, api_variant, selenium_variant)
    text = _fix_parser_default(text)
    text = _fix_serializer_default(text)
    if text != original:
        path.write_text(text)
        return True
    return False


def _remove_manual_models(out_dir: Path) -> bool:
    changed = False
    for rel_path in REMOVE_MANUAL_FILES:
        candidate = out_dir / rel_path
        if candidate.exists():
            candidate.unlink()
            changed = True
    return changed


def _find_union_files(models_dir: Path) -> Iterable[Path]:
    for path in models_dir.glob('*.ts'):
        if not path.name.endswith('.ts'):
            continue
        try:
            text = path.read_text()
        except UnicodeDecodeError:
            continue
        if "loginType" in text and "SiteConfig" in text:
            yield path


def normalize_sdk(out_dir: Path) -> bool:
    changed = False
    models_dir = out_dir / 'src' / 'models'
    if models_dir.is_dir():
        for path in _find_union_files(models_dir):
            if _patch_union_file(path):
                changed = True
    if _remove_manual_models(out_dir):
        changed = True
    return changed


def _fix_parser_default(text: str) -> str:
    return PARSER_DEFAULT_PATTERN.sub(r"\1return json;", text)


def _fix_serializer_default(text: str) -> str:
    return SERIALIZER_DEFAULT_PATTERN.sub(r"\1return value;", text)


def main(argv: Iterable[str]) -> int:
    args = list(argv)
    if args:
        targets = [Path(arg).resolve() for arg in args]
    else:
        targets = [Path('sdk/ts').resolve()]
    exit_code = 0
    for target in targets:
        if not target.exists():
            continue
        if normalize_sdk(target):
            exit_code = 0
    return exit_code


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
