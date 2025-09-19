from __future__ import annotations

import importlib
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

for name in [
    "app.security",
    "app.auth.oidc",
    "app.jobs",
    "app.routers.credentials",
    "app.organization_defaults",
    "app.worker",
    "app.main",
]:
    importlib.import_module(name)
