"""Lorebook (World Book) API endpoints.

POST /api/lorebook/export - Extract lorebook from card
POST /api/lorebook/import - Import lorebook into card
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..core import (
    ApiResponse,
    CharacterCardV3,
    ErrorCode,
    Lorebook,
    LorebookExportResult,
    LorebookImportResult,
)

router = APIRouter(prefix="/lorebook", tags=["lorebook"])


class LorebookExportRequest(BaseModel):
    """Request body for lorebook export."""

    card: CharacterCardV3 = Field(..., description="Source card to extract lorebook from")


class LorebookImportRequest(BaseModel):
    """Request body for lorebook import."""

    card: CharacterCardV3 = Field(..., description="Target card to import lorebook into")
    lorebook: Lorebook = Field(..., description="Lorebook to import")
    merge_mode: str = Field(
        default="replace",
        description="How to handle existing lorebook: 'replace' (overwrite), 'merge' (append entries), 'skip' (keep existing if present)",
    )


@router.post(
    "/export",
    response_model=ApiResponse[LorebookExportResult],
    summary="Export lorebook from card",
    description="Extract the character_book (lorebook/world book) from a card.",
)
async def export_lorebook(
    request: LorebookExportRequest,
) -> ApiResponse[LorebookExportResult]:
    """Extract lorebook from a card.

    Returns the lorebook and entry count.
    If card has no lorebook, returns an empty lorebook.
    """
    card = request.card
    book = card.data.character_book

    if book is None:
        book = Lorebook()

    result = LorebookExportResult(
        lorebook=book,
        entry_count=len(book.entries),
    )

    return ApiResponse(success=True, data=result)


@router.post(
    "/import",
    response_model=ApiResponse[LorebookImportResult],
    summary="Import lorebook into card",
    description="Import a lorebook into a card's character_book field.",
)
async def import_lorebook(
    request: LorebookImportRequest,
) -> ApiResponse[LorebookImportResult]:
    """Import lorebook into a card.

    Merge modes:
    - replace: Overwrite existing lorebook entirely
    - merge: Append new entries to existing lorebook
    - skip: Keep existing lorebook if present, only import if empty

    Returns the updated card and count of entries added.
    """
    card = request.card
    new_lorebook = request.lorebook
    merge_mode = request.merge_mode.lower()

    if merge_mode not in ("replace", "merge", "skip"):
        raise HTTPException(
            status_code=400,
            detail={
                "error": f"Invalid merge_mode: {merge_mode}. Must be 'replace', 'merge', or 'skip'.",
                "error_code": ErrorCode.VALIDATION_ERROR,
            },
        )

    existing_book = card.data.character_book
    entries_added = 0

    if merge_mode == "replace":
        card.data.character_book = new_lorebook
        entries_added = len(new_lorebook.entries)

    elif merge_mode == "merge":
        if existing_book is None:
            card.data.character_book = new_lorebook
            entries_added = len(new_lorebook.entries)
        else:
            existing_ids = set()
            for entry in existing_book.entries:
                if entry.id is not None:
                    existing_ids.add(entry.id)

            for entry in new_lorebook.entries:
                if entry.id is None or entry.id not in existing_ids:
                    existing_book.entries.append(entry)
                    entries_added += 1

    elif merge_mode == "skip":
        if existing_book is None or len(existing_book.entries) == 0:
            card.data.character_book = new_lorebook
            entries_added = len(new_lorebook.entries)

    result = LorebookImportResult(
        card=card,
        entries_added=entries_added,
    )

    return ApiResponse(success=True, data=result)
