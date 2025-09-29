#!/usr/bin/env python3
"""Apply deterministic fixes to generated site-config union models for the TypeScript SDK.

The upstream OpenAPI generator currently emits invalid discriminated unions for the
site configuration models. The generated code is missing the required type imports and
invokes the `ToJSON` helpers with the raw union value, which breaks type-checking under
`strict` TypeScript settings (as used by our Next.js build).

This script normalises every affected model so that both the vendored web SDK and the
standalone SDK share the same, type-safe versions. The adjustments are idempotent and
safe to run multiple times; they will only rewrite a file when changes are required.
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

UNION_PATTERN = re.compile(
    r"export type (?P<alias>\w+) = { loginType: 'api' } & (?P<api>\w+) \| { loginType: 'selenium' } & (?P<selenium>\w+);"
)

def _import_lines(model: str) -> tuple[str, str]:
    path = f"./{model}"
    type_line = f"import type {{ {model} }} from '{path}'\n"
    func_line = (
        f"import {{ {model}FromJSONTyped, {model}ToJSON }} from '{path}'\n"
    )
    return type_line, func_line


def _insert_lines(text: str, lines: list[str]) -> str:
    splitted = text.splitlines(keepends=True)
    insert_idx = 0
    for i, line in enumerate(splitted):
        if "Do not edit the class manually." in line:
            for j in range(i, len(splitted)):
                if splitted[j].strip() == "*/":
                    insert_idx = j + 1
                    break
            else:
                insert_idx = i + 1
            break
    else:
        insert_idx = 0

    end_idx = insert_idx
    while end_idx < len(splitted) and splitted[end_idx].strip() == "":
        end_idx += 1

    return "".join(splitted[:insert_idx] + lines + ["\n"] + splitted[end_idx:])


def patch_union_file(model_file: Path) -> bool:
    if not model_file.exists():
        return False

    original_text = model_file.read_text()
    text = original_text
    changed = False

    match = UNION_PATTERN.search(text)
    if not match:
        return False

    api_model = match.group('api')
    selenium_model = match.group('selenium')

    import_block: list[str] = []
    for model in (api_model, selenium_model):
        type_line, func_line = _import_lines(model)

        for candidate in (
            type_line,
            type_line.replace("import type ", "import "),
            func_line,
            f"import {{ {model}FromJSONTyped }} from './{model}'\n",
        ):
            if candidate in text:
                text = text.replace(candidate, "")
                changed = True

        if type_line not in import_block:
            import_block.append(type_line)
        if func_line not in import_block:
            import_block.append(func_line)

        bare_call = f"{model}ToJSON(value)"
        cast_call = f"{model}ToJSON(value as {model})"
        if bare_call in text and cast_call not in text:
            text = text.replace(bare_call, cast_call)
            changed = True

    if import_block:
        text = _insert_lines(text, import_block)
        changed = True

    text, count = re.subn(
        r"(switch \(value\['loginType'\]\) \{[\s\S]*?default:\s+)return json;",
        r"\1return value;",
        text,
    )
    if count:
        changed = True

    if changed and text != original_text:
        model_file.write_text(text)

    return changed


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "target",
        type=Path,
        help="SDK output directory (containing src/models/*.ts) or direct path to a model file",
    )
    args = parser.parse_args(argv)

    target = args.target
    files: list[Path]
    if target.is_dir():
        files = sorted((target / "src" / "models").glob("*.ts"))
    else:
        files = [target]

    any_changed = False
    for file in files:
        if patch_union_file(file):
            any_changed = True

    return 0 if any_changed or not files else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
