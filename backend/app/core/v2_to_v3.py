"""V2 to V3 character card migration.

Converts V2 character card format to V3 format while preserving all data.
"""

from typing import Any, Dict, List, Optional

from .card_models import (
    Asset,
    CharacterCardData,
    CharacterCardV3,
    Lorebook,
    LorebookEntry,
)


def migrate_lorebook(v2_book: Optional[Dict[str, Any]]) -> Optional[Lorebook]:
    """Migrate V2 character_book to V3 Lorebook format.

    Args:
        v2_book: V2 character_book dict or None

    Returns:
        Lorebook model or None
    """
    if not v2_book:
        return None

    entries: List[LorebookEntry] = []
    v2_entries = v2_book.get("entries", [])

    # Handle legacy object format: {"0": {...}, "1": {...}}
    # Some older implementations used objects instead of arrays
    if isinstance(v2_entries, dict):
        v2_entries = list(v2_entries.values())

    for entry in v2_entries:
        if isinstance(entry, dict):
            lore_entry = LorebookEntry(
                keys=entry.get("keys", []),
                content=entry.get("content", ""),
                extensions=entry.get("extensions", {}),
                enabled=entry.get("enabled", True),
                insertion_order=entry.get("insertion_order", 0),
                case_sensitive=entry.get("case_sensitive"),
                use_regex=entry.get("use_regex", False),
                constant=entry.get("constant"),
                name=entry.get("name"),
                priority=entry.get("priority"),
                id=entry.get("id"),
                comment=entry.get("comment"),
                selective=entry.get("selective"),
                secondary_keys=entry.get("secondary_keys", []),
                position=entry.get("position"),
            )
            for k, v in entry.items():
                if k not in LorebookEntry.model_fields:
                    setattr(lore_entry, k, v)
            entries.append(lore_entry)

    lorebook = Lorebook(
        name=v2_book.get("name", ""),
        description=v2_book.get("description", ""),
        scan_depth=v2_book.get("scan_depth"),
        token_budget=v2_book.get("token_budget"),
        recursive_scanning=v2_book.get("recursive_scanning"),
        extensions=v2_book.get("extensions", {}),
        entries=entries,
    )

    for k, v in v2_book.items():
        if k not in Lorebook.model_fields and k != "entries":
            setattr(lorebook, k, v)

    return lorebook


def migrate_v2_to_v3(v2_data: Dict[str, Any]) -> CharacterCardV3:
    """Migrate V2 character card data to V3 format.

    Performs direct field mapping where possible, with V3 defaults for new fields.
    Unknown fields are preserved via extra='allow'.

    Args:
        v2_data: V2 format character card dict (flat structure or with 'data' wrapper)

    Returns:
        CharacterCardV3 model
    """
    if "data" in v2_data and isinstance(v2_data["data"], dict):
        source = v2_data["data"]
    else:
        source = v2_data

    character_book = migrate_lorebook(source.get("character_book"))

    assets: Optional[List[Asset]] = None
    if "assets" in source and source["assets"]:
        assets = [
            Asset(
                type=a.get("type", "icon"),
                uri=a.get("uri", "ccdefault:"),
                name=a.get("name", "main"),
                ext=a.get("ext", "png"),
            )
            for a in source["assets"]
            if isinstance(a, dict)
        ]

    data = CharacterCardData(
        name=source.get("name", ""),
        description=source.get("description", ""),
        tags=source.get("tags", []),
        creator=source.get("creator", ""),
        character_version=source.get("character_version", ""),
        mes_example=source.get("mes_example", ""),
        extensions=source.get("extensions", {}),
        system_prompt=source.get("system_prompt", ""),
        post_history_instructions=source.get("post_history_instructions", ""),
        first_mes=source.get("first_mes", ""),
        alternate_greetings=source.get("alternate_greetings", []),
        personality=source.get("personality", ""),
        scenario=source.get("scenario", ""),
        creator_notes=source.get("creator_notes", ""),
        character_book=character_book,
        assets=assets,
        nickname=source.get("nickname"),
        creator_notes_multilingual=source.get("creator_notes_multilingual"),
        source=source.get("source"),
        group_only_greetings=source.get("group_only_greetings", []),
        creation_date=source.get("creation_date"),
        modification_date=source.get("modification_date"),
    )

    known_fields = set(CharacterCardData.model_fields.keys()) | {"character_book", "assets"}
    for k, v in source.items():
        if k not in known_fields:
            setattr(data, k, v)

    return CharacterCardV3(
        spec="chara_card_v3",
        spec_version="3.0",
        data=data,
    )


def is_v2_format(data: Dict[str, Any]) -> bool:
    """Check if the data is in V2 format (not V3).

    Args:
        data: Character card data dict

    Returns:
        True if V2 format, False if V3 or unknown
    """
    if data.get("spec") == "chara_card_v3":
        return False
    if data.get("spec_version") == "3.0":
        return False
    if "data" in data and isinstance(data["data"], dict):
        nested = data["data"]
        if nested.get("spec") == "chara_card_v3":
            return False

    if "name" in data or ("data" in data and "name" in data.get("data", {})):
        return True

    return False


__all__ = ["migrate_v2_to_v3", "migrate_lorebook", "is_v2_format"]
