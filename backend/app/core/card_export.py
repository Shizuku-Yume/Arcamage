"""Character card export module.

Exports CharacterCardV3 to PNG with ccv3 tEXt chunk.
Optionally includes chara chunk for V2 compatibility.
"""

import json
import time
from typing import Dict, Optional

from .card_import import import_from_png
from .card_models import CharacterCardV3
from .png_chunks import inject_text_chunk


class CardExportError(Exception):
    """Raised when card export fails."""

    pass


def _prepare_v3_json(card: CharacterCardV3, update_modification_date: bool = True) -> str:
    """Prepare V3 JSON string for embedding.

    Args:
        card: CharacterCardV3 model
        update_modification_date: Whether to set modification_date to current time

    Returns:
        JSON string (no extra whitespace)
    """
    data = card.model_dump(mode="json", exclude_none=False)

    if update_modification_date:
        data["data"]["modification_date"] = int(time.time())

    return json.dumps(data, ensure_ascii=False, separators=(",", ":"))


def _prepare_v2_json(card: CharacterCardV3) -> str:
    """Prepare V2-compatible JSON string for chara chunk.

    Flattens the V3 structure to V2 format (data fields at root level).

    Args:
        card: CharacterCardV3 model

    Returns:
        JSON string (V2 format)
    """
    v3_data = card.model_dump(mode="json", exclude_none=False)

    v2_data: Dict = {}
    if "data" in v3_data:
        v2_data = v3_data["data"].copy()

    v2_data.pop("group_only_greetings", None)
    v2_data.pop("nickname", None)
    v2_data.pop("creator_notes_multilingual", None)
    v2_data.pop("source", None)
    v2_data.pop("creation_date", None)
    v2_data.pop("modification_date", None)

    return json.dumps(v2_data, ensure_ascii=False, separators=(",", ":"))


def export_to_png(
    png_data: bytes,
    card: CharacterCardV3,
    include_v2_compat: bool = True,
    update_modification_date: bool = True,
) -> bytes:
    """Export character card to PNG with ccv3 chunk.

    Args:
        png_data: Base PNG file bytes
        card: CharacterCardV3 to embed
        include_v2_compat: If True, also write chara chunk for V2 compatibility
        update_modification_date: If True, set modification_date to current time

    Returns:
        Modified PNG bytes with embedded card data

    Raises:
        CardExportError: If export fails
    """
    try:
        v3_json = _prepare_v3_json(card, update_modification_date)
        result = inject_text_chunk(png_data, "ccv3", v3_json, replace=True)

        if include_v2_compat:
            v2_json = _prepare_v2_json(card)
            result = inject_text_chunk(result, "chara", v2_json, replace=True)

        return result
    except Exception as e:
        raise CardExportError(f"Failed to export card: {e}")


def verify_export(
    exported_png: bytes,
    original_card: CharacterCardV3,
    strict: bool = False,
) -> tuple[bool, Optional[str]]:
    """Verify exported PNG can be re-imported correctly.

    Args:
        exported_png: PNG bytes after export
        original_card: Original card that was exported
        strict: If True, compare all fields; if False, only compare key fields

    Returns:
        Tuple of (success, error_message)
    """
    try:
        reimported, _, _ = import_from_png(exported_png)
    except Exception as e:
        return False, f"Failed to re-import: {e}"

    orig_data = original_card.data
    reimp_data = reimported.data

    if orig_data.name != reimp_data.name:
        return False, f"Name mismatch: '{orig_data.name}' vs '{reimp_data.name}'"

    if orig_data.first_mes != reimp_data.first_mes:
        return False, "first_mes content mismatch"

    if orig_data.description != reimp_data.description:
        return False, "description content mismatch"

    if strict:
        orig_dict = original_card.model_dump(mode="json", exclude={"data": {"modification_date"}})
        reimp_dict = reimported.model_dump(mode="json", exclude={"data": {"modification_date"}})

        def compare_dicts(d1, d2, path=""):
            if type(d1) != type(d2):
                return False, f"Type mismatch at {path}"
            if isinstance(d1, dict):
                for key in set(d1.keys()) | set(d2.keys()):
                    if key not in d1:
                        return False, f"Missing key in original: {path}.{key}"
                    if key not in d2:
                        return False, f"Missing key in reimported: {path}.{key}"
                    ok, msg = compare_dicts(d1[key], d2[key], f"{path}.{key}")
                    if not ok:
                        return False, msg
            elif isinstance(d1, list):
                if len(d1) != len(d2):
                    return False, f"List length mismatch at {path}"
                for i, (v1, v2) in enumerate(zip(d1, d2)):
                    ok, msg = compare_dicts(v1, v2, f"{path}[{i}]")
                    if not ok:
                        return False, msg
            else:
                if d1 != d2:
                    return False, f"Value mismatch at {path}: {d1} vs {d2}"
            return True, None

        ok, msg = compare_dicts(orig_dict, reimp_dict)
        if not ok:
            return False, msg

    return True, None


def generate_export_filename(card: CharacterCardV3) -> str:
    """Generate smart filename for export.

    Format: {Name}_{Date}_{Time}.png

    Args:
        card: CharacterCardV3

    Returns:
        Filename string
    """
    name = card.data.name or "character"
    safe_name = "".join(c if c.isalnum() or c in "-_ " else "_" for c in name)
    safe_name = safe_name.strip()[:50]

    timestamp = time.strftime("%Y%m%d_%H%M%S")

    return f"{safe_name}_{timestamp}.png"


__all__ = [
    "CardExportError",
    "export_to_png",
    "verify_export",
    "generate_export_filename",
]
