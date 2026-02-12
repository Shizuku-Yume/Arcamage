"""Remote import API endpoint for Arcaferry integration.

POST /api/import/remote - Import card from Arcaferry (JSON or PNG)
"""

import json
from typing import Optional

from fastapi import APIRouter, File, Header, HTTPException, Request, UploadFile
from pydantic import BaseModel, ValidationError as PydanticValidationError

from ..core import (
    ApiResponse,
    CardImportError,
    CharacterCardV3,
    ErrorCode,
    import_card,
)
from ..settings import get_settings

router = APIRouter(prefix="/import", tags=["import"])

MIN_ARCAFERRY_VERSION = "0.1.0"


class RemoteImportResponse(BaseModel):
    """Response for remote import endpoint."""

    success: bool
    card_id: Optional[str] = None
    message: Optional[str] = None
    error_code: Optional[str] = None


class CardImportRequest(BaseModel):
    """Request body for JSON card import."""

    spec: str
    spec_version: str
    data: dict


def parse_version(version: str) -> tuple[int, int, int]:
    """Parse semver string to tuple."""
    try:
        parts = version.split(".")
        return (int(parts[0]), int(parts[1]), int(parts[2]) if len(parts) > 2 else 0)
    except (ValueError, IndexError):
        return (0, 0, 0)


def check_version_compatibility(client_version: Optional[str]) -> Optional[str]:
    """Check if Arcaferry version is compatible.

    Returns error message if incompatible, None if OK.
    """
    if not client_version:
        return None  # Allow requests without version header (for testing)

    client = parse_version(client_version)
    minimum = parse_version(MIN_ARCAFERRY_VERSION)

    if client < minimum:
        return f"Arcaferry version {client_version} is not compatible. Minimum required: {MIN_ARCAFERRY_VERSION}"

    return None


@router.post(
    "/remote",
    response_model=RemoteImportResponse,
    summary="Import card from Arcaferry",
    description="Receive a character card from Arcaferry (JSON or PNG format).",
)
async def import_remote_card(
    request: Request,
    file: Optional[UploadFile] = File(None, description="PNG file with embedded card data"),
    x_arcaferry_version: Optional[str] = Header(None, alias="X-Arcaferry-Version"),
    authorization: Optional[str] = Header(None),
) -> RemoteImportResponse:
    """Import card from Arcaferry.

    Supports two formats:
    1. JSON body with CCv3 card data
    2. Multipart form with PNG file containing embedded card data
    """
    version_error = check_version_compatibility(x_arcaferry_version)
    if version_error:
        return RemoteImportResponse(
            success=False,
            error_code="VERSION_MISMATCH",
            message=version_error,
        )

    settings = get_settings()

    content_type = request.headers.get("content-type", "")

    try:
        if file is not None:
            content = await file.read()

            if len(content) > settings.max_upload_bytes:
                return RemoteImportResponse(
                    success=False,
                    error_code="VALIDATION_ERROR",
                    message=f"File too large. Maximum size is {settings.max_upload_mb}MB",
                )

            try:
                card, source_format, has_image = import_card(content)
            except CardImportError as e:
                return RemoteImportResponse(
                    success=False,
                    error_code="VALIDATION_ERROR",
                    message=str(e),
                )

        elif "application/json" in content_type:
            try:
                body = await request.json()
            except json.JSONDecodeError as e:
                return RemoteImportResponse(
                    success=False,
                    error_code="VALIDATION_ERROR",
                    message=f"Invalid JSON: {e}",
                )

            try:
                card = CharacterCardV3.model_validate(body)
            except PydanticValidationError as e:
                return RemoteImportResponse(
                    success=False,
                    error_code="VALIDATION_ERROR",
                    message=f"Invalid card format: {e.error_count()} validation errors",
                )

        else:
            return RemoteImportResponse(
                success=False,
                error_code="VALIDATION_ERROR",
                message="Unsupported content type. Use application/json or multipart/form-data with PNG file.",
            )

        import uuid

        card_id = str(uuid.uuid4())[:8]

        if not hasattr(request.app.state, "pending_imports"):
            request.app.state.pending_imports = {}

        request.app.state.pending_imports[card_id] = {
            "card": card.model_dump(),
            "name": card.data.name,
        }

        return RemoteImportResponse(
            success=True,
            card_id=card_id,
            message=f"Card '{card.data.name}' imported successfully",
        )

    except Exception as e:
        return RemoteImportResponse(
            success=False,
            error_code="INTERNAL_ERROR",
            message=str(e),
        )


@router.get(
    "/remote/pending",
    summary="Get pending imported cards",
    description="Get list of cards imported via Arcaferry that are waiting to be loaded.",
)
async def get_pending_imports(request: Request) -> dict:
    """Get pending imported cards."""
    pending = getattr(request.app.state, "pending_imports", {})
    return {
        "count": len(pending),
        "cards": [{"id": k, "name": v.get("name", "Unknown")} for k, v in pending.items()],
    }


@router.get(
    "/remote/pending/{card_id}",
    summary="Get a pending imported card",
    description="Get a specific card that was imported via Arcaferry.",
)
async def get_pending_card(request: Request, card_id: str) -> dict:
    """Get a specific pending card and remove it from pending list."""
    pending = getattr(request.app.state, "pending_imports", {})

    if card_id not in pending:
        raise HTTPException(status_code=404, detail="Card not found")

    card_data = pending.pop(card_id)
    return {
        "success": True,
        "card": card_data["card"],
    }
