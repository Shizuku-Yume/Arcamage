"""Card parsing, injection, and validation API endpoints.

POST /api/cards/parse - Parse PNG/JSON to V3 card
POST /api/cards/inject - Inject V3 card into PNG
POST /api/cards/validate - Validate V3 card JSON
"""

import json
from typing import Literal

from urllib.parse import quote

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import Response
from pydantic import ValidationError as PydanticValidationError

from ..core import (
    ApiResponse,
    CardExportError,
    CardImportError,
    CharacterCardV3,
    ErrorCode,
    ParseResult,
    ValidateResult,
    estimate_card_tokens,
    export_to_png,
    generate_export_filename,
    import_card,
    verify_export,
)
from ..settings import get_settings

router = APIRouter(prefix="/cards", tags=["cards"])


async def _check_file_size(file: UploadFile, request: Request) -> bytes:
    """Read and validate file size.

    Args:
        file: Uploaded file
        request: FastAPI request object

    Returns:
        File contents as bytes

    Raises:
        HTTPException: If file is too large
    """
    settings = get_settings()
    max_size = settings.max_upload_bytes

    content = await file.read()

    if len(content) > max_size:
        raise HTTPException(
            status_code=413,
            detail={
                "error": f"File too large. Maximum size is {settings.max_upload_mb}MB",
                "error_code": ErrorCode.FILE_TOO_LARGE,
            },
        )

    return content


@router.post(
    "/parse",
    response_model=ApiResponse[ParseResult],
    summary="Parse PNG/JSON to V3 card",
    description="Parse a PNG image with embedded card data or JSON file into V3 format.",
)
async def parse_card(
    request: Request,
    file: UploadFile = File(..., description="PNG image or JSON file"),
) -> ApiResponse[ParseResult]:
    """Parse uploaded file to CharacterCardV3.

    Supports:
    - PNG with ccv3 or chara chunk
    - JSON (V2 or V3 format)
    - Other image formats (JPG, WebP, GIF) - converted to PNG first
    """
    content = await _check_file_size(file, request)

    try:
        card, source_format, has_image = import_card(content)
    except CardImportError as e:
        raise HTTPException(
            status_code=400,
            detail={
                "error": str(e),
                "error_code": ErrorCode.PARSE_ERROR,
            },
        )

    warnings = []
    if source_format == "v2":
        warnings.append("Card was in V2 format and has been migrated to V3")

    token_breakdown = estimate_card_tokens(card)
    if token_breakdown.get("total", 0) > 8000:
        warnings.append(
            f"Card has {token_breakdown['total']} estimated tokens, which may exceed context limits"
        )

    result = ParseResult(
        card=card,
        source_format=source_format,  # type: ignore
        has_image=has_image,
        warnings=warnings,
    )

    return ApiResponse(success=True, data=result)


@router.post(
    "/inject",
    summary="Inject V3 card into PNG",
    description="Inject character card data into a PNG image, returning the modified PNG.",
    responses={
        200: {
            "content": {"image/png": {}},
            "description": "PNG image with embedded card data",
        }
    },
)
async def inject_card(
    request: Request,
    file: UploadFile = File(..., description="Base PNG image"),
    card_v3_json: str = Form(..., description="V3 card JSON string"),
    include_v2_compat: bool = Form(True, description="Include V2-compatible chara chunk"),
    verify: bool = Form(True, description="Verify export by re-importing"),
) -> Response:
    """Inject card data into PNG and return the modified image."""
    content = await _check_file_size(file, request)

    try:
        card_data = json.loads(card_v3_json)
        card = CharacterCardV3.model_validate(card_data)
    except json.JSONDecodeError as e:
        raise HTTPException(
            status_code=400,
            detail={
                "error": f"Invalid JSON: {e}",
                "error_code": ErrorCode.VALIDATION_ERROR,
            },
        )
    except PydanticValidationError as e:
        raise HTTPException(
            status_code=422,
            detail={
                "error": f"Invalid card structure: {e}",
                "error_code": ErrorCode.VALIDATION_ERROR,
            },
        )

    try:
        result_png = export_to_png(
            content,
            card,
            include_v2_compat=include_v2_compat,
        )
    except CardExportError as e:
        raise HTTPException(
            status_code=400,
            detail={
                "error": str(e),
                "error_code": ErrorCode.INVALID_FORMAT,
            },
        )

    if verify:
        ok, error_msg = verify_export(result_png, card)
        if not ok:
            raise HTTPException(
                status_code=500,
                detail={
                    "error": f"Export verification failed: {error_msg}",
                    "error_code": ErrorCode.INTERNAL_ERROR,
                },
            )

    filename = generate_export_filename(card)
    # RFC 5987: Use filename* with UTF-8 encoding for non-ASCII characters
    filename_encoded = quote(filename, safe="")

    return Response(
        content=result_png,
        media_type="image/png",
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{filename_encoded}",
        },
    )


@router.post(
    "/validate",
    response_model=ApiResponse[ValidateResult],
    summary="Validate V3 card JSON",
    description="Validate a V3 card JSON structure without processing an image.",
)
async def validate_card(
    card: CharacterCardV3,
) -> ApiResponse[ValidateResult]:
    """Validate V3 card structure.

    Returns validation result with any errors or warnings.
    """
    errors = []
    warnings = []

    if not card.data.name or not card.data.name.strip():
        errors.append("Character name is required")

    if not card.data.first_mes and not card.data.alternate_greetings:
        warnings.append("Card has no greeting messages (first_mes or alternate_greetings)")

    if not card.data.description:
        warnings.append("Card has no description")

    token_breakdown = estimate_card_tokens(card)
    total_tokens = token_breakdown.get("total", 0)
    if total_tokens > 8000:
        warnings.append(
            f"Card has {total_tokens} estimated tokens, which may exceed context limits"
        )

    if card.data.character_book:
        book = card.data.character_book
        for i, entry in enumerate(book.entries):
            if not entry.constant and not entry.keys:
                warnings.append(f"Lorebook entry {i} has no keys and is not constant")
            if not entry.content:
                warnings.append(f"Lorebook entry {i} has empty content")

    result = ValidateResult(
        valid=len(errors) == 0,
        errors=errors,
        warnings=warnings,
    )

    return ApiResponse(success=True, data=result)
