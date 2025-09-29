#!/usr/bin/env python3
"""Apply deterministic fixes to the generated Body model for the TypeScript SDK.

The upstream OpenAPI generator currently produces an invalid discriminated union for the
`Body` type used in the site configuration endpoints. The generated code is missing
necessary imports when emitted into certain directories and also passes the union type
directly into helper functions, which breaks type-checking under `strict` TypeScript
settings (as used by our Next.js build).

This script normalises the generated file so that both the vendored web SDK and the
standalone SDK share the same, type-safe version. The adjustments are idempotent and
safe to run multiple times; they will only rewrite the file when changes are required.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path
import re

IMPORT_BLOCK = (
    "import type { SiteConfigApi } from './SiteConfigApi'\n"
    "import { SiteConfigApiFromJSONTyped, SiteConfigApiToJSON } from './SiteConfigApi'\n"
    "import type { SiteConfigSelenium } from './SiteConfigSelenium'\n"
    "import { SiteConfigSeleniumFromJSONTyped, SiteConfigSeleniumToJSON } from './SiteConfigSelenium'\n\n"
)


def patch_body_file(body_file: Path) -> bool:
    if not body_file.exists():
        return False

    original_text = body_file.read_text()
    text = original_text
    changed = False

    if "import type { SiteConfigApi } from './SiteConfigApi'" not in text:
        if "import { SiteConfigApiFromJSONTyped" in text:
            text = text.replace(
                "import { SiteConfigApiFromJSONTyped",
                "import type { SiteConfigApi } from './SiteConfigApi'\nimport { SiteConfigApiFromJSONTyped",
                1,
            )
        else:
            marker = "*/\n\n"
            idx = text.find(marker)
            if idx != -1:
                idx += len(marker)
                text = text[:idx] + IMPORT_BLOCK + text[idx:]
            else:
                text = IMPORT_BLOCK + text
        changed = True

    replacements = {
        "import { SiteConfigApiFromJSONTyped } from './SiteConfigApi'":
            "import { SiteConfigApiFromJSONTyped, SiteConfigApiToJSON } from './SiteConfigApi'",
        "import { SiteConfigSeleniumFromJSONTyped } from './SiteConfigSelenium'":
            "import { SiteConfigSeleniumFromJSONTyped, SiteConfigSeleniumToJSON } from './SiteConfigSelenium'",
    }
    for old, new in replacements.items():
        if old in text and new not in text:
            text = text.replace(old, new)
            changed = True

    for old, new in (
        ("SiteConfigApiToJSON(value)", "SiteConfigApiToJSON(value as SiteConfigApi)"),
        (
            "SiteConfigSeleniumToJSON(value)",
            "SiteConfigSeleniumToJSON(value as SiteConfigSelenium)",
        ),
    ):
        if old in text and new not in text:
            text = text.replace(old, new)
            changed = True

    text, count = re.subn(
        r"(switch \(value\['loginType'\]\) \{[\s\S]*?default:\s+)return json;",
        r"\1return value;",
        text,
    )
    if count:
        changed = True

    if changed and text != original_text:
        body_file.write_text(text)

    return changed


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "target",
        type=Path,
        help="SDK output directory (containing src/models/Body.ts) or direct path to Body.ts",
    )
    args = parser.parse_args(argv)

    target = args.target
    body_file = target
    if target.is_dir():
        body_file = target / "src" / "models" / "Body.ts"

    changed = patch_body_file(body_file)
    if not changed:
        return 0
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
