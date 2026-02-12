"""Character card import module.

Handles PNG and JSON import, normalizing to CharacterCardV3 format.
Import priority: ccv3 > chara for PNG files.
"""

import json
from io import BytesIO
from typing import Literal, Tuple, Union

from PIL import Image

from .card_models import CharacterCardV3
from .png_chunks import InvalidPngError, get_card_data
from .v2_to_v3 import is_v2_format, migrate_v2_to_v3


class CardImportError(Exception):
    """Raised when card import fails."""

    pass


def import_from_json(
    json_data: Union[str, bytes, dict],
) -> Tuple[CharacterCardV3, Literal["v2", "v3"]]:
    """Import character card from JSON data.

    Args:
        json_data: JSON string, bytes, or already parsed dict

    Returns:
        Tuple of (CharacterCardV3, source_format)

    Raises:
        CardImportError: If JSON is invalid or missing required fields
    """
    if isinstance(json_data, bytes):
        json_data = json_data.decode("utf-8")

    if isinstance(json_data, str):
        try:
            data = json.loads(json_data)
        except json.JSONDecodeError as e:
            raise CardImportError(f"Invalid JSON: {e}")
    else:
        data = json_data

    if not isinstance(data, dict):
        raise CardImportError("JSON must be an object")

    if data.get("spec") == "chara_card_v3":
        if "data" not in data:
            raise CardImportError("V3 card missing 'data' field")
        try:
            card = CharacterCardV3.model_validate(data)
            return card, "v3"
        except Exception as e:
            raise CardImportError(f"Invalid V3 card structure: {e}")

    if is_v2_format(data):
        try:
            card = migrate_v2_to_v3(data)
            return card, "v2"
        except Exception as e:
            raise CardImportError(f"Failed to migrate V2 card: {e}")

    if "name" in data:
        try:
            card = migrate_v2_to_v3(data)
            return card, "v2"
        except Exception as e:
            raise CardImportError(f"Failed to import card: {e}")

    raise CardImportError("Unrecognized card format: missing 'spec' or 'name' field")


def import_from_png(
    png_data: bytes,
) -> Tuple[CharacterCardV3, Literal["v2", "v3"], bool]:
    """Import character card from PNG file.

    Priority: ccv3 chunk > chara chunk

    Args:
        png_data: Raw PNG file bytes

    Returns:
        Tuple of (CharacterCardV3, source_format, has_image=True)

    Raises:
        CardImportError: If PNG is invalid or has no card data
    """
    try:
        result = get_card_data(png_data)
    except InvalidPngError as e:
        raise CardImportError(f"Invalid PNG file: {e}")

    if result is None:
        raise CardImportError("PNG contains no character card data (no ccv3 or chara chunk)")

    chunk_type, json_string = result

    card, source_format = import_from_json(json_string)

    if chunk_type == "ccv3" and source_format == "v2":
        source_format = "v3"

    return card, source_format, True


def import_from_image(image_data: bytes) -> bytes:
    """Convert non-PNG image to PNG format.

    Supports JPG, WebP, GIF and other Pillow-supported formats.

    Args:
        image_data: Raw image bytes

    Returns:
        PNG bytes

    Raises:
        CardImportError: If image cannot be converted
    """
    try:
        img = Image.open(BytesIO(image_data))

        if img.mode in ("RGBA", "LA", "PA"):
            pass
        elif img.mode == "P":
            img = img.convert("RGBA")
        else:
            img = img.convert("RGB")

        output = BytesIO()
        img.save(output, format="PNG")
        return output.getvalue()
    except Exception as e:
        raise CardImportError(f"Failed to convert image to PNG: {e}")


def detect_file_type(data: bytes) -> Literal["png", "json", "image"]:
    """Detect file type from bytes.

    Args:
        data: Raw file bytes

    Returns:
        File type: 'png', 'json', or 'image' (other image formats)
    """
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"

    if data[:3] == b"\xff\xd8\xff":
        return "image"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image"
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return "image"
    if data[:2] == b"BM":
        return "image"

    stripped = data.lstrip()
    if stripped and stripped[0:1] in (b"{", b"["):
        return "json"

    return "image"


def import_card(
    data: bytes,
) -> Tuple[CharacterCardV3, Literal["v2", "v3", "json"], bool]:
    """Import character card from any supported format.

    Automatically detects file type and processes accordingly.

    Args:
        data: Raw file bytes (PNG, JSON, or other image format)

    Returns:
        Tuple of (CharacterCardV3, source_format, has_image)
        - source_format: 'v2', 'v3', or 'json'
        - has_image: True if input was an image file

    Raises:
        CardImportError: If import fails
    """
    file_type = detect_file_type(data)

    if file_type == "json":
        card, fmt = import_from_json(data)
        return card, fmt, False

    if file_type == "image":
        png_data = import_from_image(data)
        try:
            card, fmt, _ = import_from_png(png_data)
            return card, fmt, True
        except CardImportError:
            raise CardImportError("Image converted to PNG but contains no card data")

    card, fmt, _ = import_from_png(data)
    return card, fmt, True


__all__ = [
    "CardImportError",
    "import_from_json",
    "import_from_png",
    "import_from_image",
    "import_card",
    "detect_file_type",
]
