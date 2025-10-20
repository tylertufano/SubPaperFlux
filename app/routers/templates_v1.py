from __future__ import annotations

from pathlib import Path
from typing import List

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field


router = APIRouter(prefix="/v1/templates", tags=["v1", "templates"])


class TemplateCategory(BaseModel):
    id: str = Field(..., description="Stable identifier for the category")
    label: str = Field(..., description="Human-friendly label for the category")


class TemplateMetadata(BaseModel):
    id: str = Field(..., description="Stable template identifier")
    filename: str = Field(..., description="Source filename within the templates directory")
    title: str = Field(..., description="Display title for the template")
    description: str = Field(..., description="Short description of the template contents")
    format: str = Field(..., description="Primary file format (derived from the extension)")
    size_bytes: int = Field(..., description="File size in bytes")
    categories: List[str] = Field(
        default_factory=list,
        description="List of category identifiers that apply to the template",
    )
    download_url: str = Field(..., description="Relative URL to download the template asset")


class TemplateListResponse(BaseModel):
    templates: List[TemplateMetadata] = Field(
        default_factory=list, description="Available template definitions"
    )
    categories: List[TemplateCategory] = Field(
        default_factory=list, description="Filter categories for the templates"
    )


BASE_DIR = Path(__file__).resolve().parents[2]
TEMPLATES_DIR = BASE_DIR / "templates"

CATEGORY_LABELS = {
    "configuration": "Configuration",
    "credentials": "Credentials",
    "docker": "Docker",
    "integrations": "Integrations",
}


class TemplateDefinition(BaseModel):
    id: str
    filename: str
    title: str
    description: str
    categories: List[str] = Field(default_factory=list)

    @property
    def path(self) -> Path:
        return TEMPLATES_DIR / self.filename

    def to_metadata(self) -> TemplateMetadata:
        path = self.path
        if not path.is_file():
            raise FileNotFoundError(path)
        size = path.stat().st_size
        suffix = path.suffix.lstrip(".") or "txt"
        return TemplateMetadata(
            id=self.id,
            filename=self.filename,
            title=self.title,
            description=self.description,
            format=suffix,
            size_bytes=size,
            categories=list(self.categories),
            download_url=f"/v1/templates/{self.id}/download",
        )


TEMPLATE_DEFINITIONS: List[TemplateDefinition] = [
    TemplateDefinition(
        id="env-dev-profile",
        filename="env.dev.example",
        title="Docker Compose profile (dev)",
        description="Sample development profile for Docker Compose deployments.",
        categories=["configuration"],
    ),
    TemplateDefinition(
        id="env-stage-profile",
        filename="env.stage.example",
        title="Docker Compose profile (stage)",
        description="Sample staging profile for Docker Compose deployments.",
        categories=["configuration"],
    ),
    TemplateDefinition(
        id="env-prod-profile",
        filename="env.prod.example",
        title="Docker Compose profile (prod)",
        description="Sample production profile for Docker Compose deployments.",
        categories=["configuration"],
    ),
    TemplateDefinition(
        id="docker-compose-api",
        filename="docker-compose.api.example.yml",
        title="Docker Compose (API)",
        description="Compose stack for running the API and dependencies locally.",
        categories=["docker"],
    ),
    TemplateDefinition(
        id="docker-compose-worker",
        filename="docker-compose.example.yml",
        title="Docker Compose (API + worker)",
        description="Compose stack for running the API, worker, and optional web UI.",
        categories=["docker"],
    ),
    TemplateDefinition(
        id="docker-compose-prod",
        filename="docker-compose.prod.yml",
        title="Docker Compose (prod)",
        description="Production-ready Compose stack for the API, worker, and web UI.",
        categories=["docker"],
    ),
]


@router.get("", response_model=TemplateListResponse, summary="List available templates")
@router.get("/", response_model=TemplateListResponse, include_in_schema=False)
def list_templates() -> TemplateListResponse:
    templates: List[TemplateMetadata] = []
    missing: list[str] = []

    for definition in TEMPLATE_DEFINITIONS:
        try:
            templates.append(definition.to_metadata())
        except FileNotFoundError:
            missing.append(definition.filename)

    categories_used = {cat for template in templates for cat in template.categories}
    categories = [
        TemplateCategory(id=cat, label=CATEGORY_LABELS.get(cat, cat.replace("_", " ").title()))
        for cat in sorted(categories_used)
    ]

    response = TemplateListResponse(templates=templates, categories=categories)

    if missing:
        # Surface missing templates via logs for operators without failing the endpoint.
        import logging

        logger = logging.getLogger(__name__)
        logger.warning("Template files missing: %s", ", ".join(sorted(set(missing))))

    return response


@router.get("/{template_id}/download", response_class=FileResponse, summary="Download template asset")
def download_template(template_id: str) -> FileResponse:
    definition = next((d for d in TEMPLATE_DEFINITIONS if d.id == template_id), None)
    if not definition:
        raise HTTPException(status_code=404, detail="Template not found")
    path = definition.path
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Template asset is unavailable")
    return FileResponse(path, filename=definition.filename, media_type="application/octet-stream")
