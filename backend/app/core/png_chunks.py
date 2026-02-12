"""PNG chunk operations for reading and writing tEXt/iTXt/zTXt chunks.

This module handles PNG metadata manipulation while preserving IDAT integrity.

🚨 CRITICAL CONSTRAINT: IDAT chunks must NEVER be decompressed, resampled,
or re-encoded. All operations are binary append/replace on text chunks only.
"""

import base64
import struct
import zlib
from typing import Optional

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


class PngChunkError(Exception):
    """Base exception for PNG chunk operations."""

    pass


class InvalidPngError(PngChunkError):
    """Raised when the input is not a valid PNG file."""

    pass


def read_png_chunks(data: bytes) -> list[tuple[str, bytes]]:
    """Read all PNG chunks from binary data.

    Stops parsing at IEND chunk, ignoring any garbage data after it.

    Args:
        data: Raw PNG file bytes

    Returns:
        List of (chunk_type, chunk_data) tuples

    Raises:
        InvalidPngError: If data doesn't start with PNG signature
    """
    if len(data) < 8 or data[:8] != PNG_SIGNATURE:
        raise InvalidPngError("Not a valid PNG file: invalid signature")

    chunks: list[tuple[str, bytes]] = []
    pos = 8

    while pos < len(data):
        if pos + 8 > len(data):
            break

        length = struct.unpack(">I", data[pos : pos + 4])[0]
        chunk_type = data[pos + 4 : pos + 8].decode("latin-1")

        if pos + 12 + length > len(data):
            break

        chunk_data = data[pos + 8 : pos + 8 + length]
        chunks.append((chunk_type, chunk_data))
        pos += 12 + length

        if chunk_type == "IEND":
            break

    return chunks


def extract_idat_chunks(data: bytes) -> list[bytes]:
    """Extract all IDAT chunk data from a PNG file.

    Used for verifying IDAT integrity before/after operations.

    Args:
        data: Raw PNG file bytes

    Returns:
        List of raw IDAT chunk data (compressed pixel data)
    """
    chunks = read_png_chunks(data)
    return [chunk_data for chunk_type, chunk_data in chunks if chunk_type == "IDAT"]


def _decode_text_chunk(chunk_data: bytes) -> tuple[str, str] | None:
    """Decode a tEXt chunk.

    Format: keyword\0text

    Args:
        chunk_data: Raw chunk data

    Returns:
        Tuple of (keyword, text) or None if invalid
    """
    null_pos = chunk_data.find(b"\x00")
    if null_pos == -1:
        return None

    keyword = chunk_data[:null_pos].decode("latin-1")
    text_data = chunk_data[null_pos + 1 :]

    try:
        text = base64.b64decode(text_data).decode("utf-8")
    except Exception:
        text = text_data.decode("utf-8", errors="replace")

    return keyword, text


def _decode_itxt_chunk(chunk_data: bytes) -> tuple[str, str] | None:
    """Decode an iTXt (international text) chunk.

    Format: keyword\0compression_flag\0compression_method\0language_tag\0translated_keyword\0text

    Args:
        chunk_data: Raw chunk data

    Returns:
        Tuple of (keyword, text) or None if invalid
    """
    null_pos = chunk_data.find(b"\x00")
    if null_pos == -1:
        return None

    keyword = chunk_data[:null_pos].decode("latin-1")
    rest = chunk_data[null_pos + 1 :]

    if len(rest) < 2:
        return None

    compression_flag = rest[0]
    rest = rest[2:]

    lang_null = rest.find(b"\x00")
    if lang_null == -1:
        return None
    rest = rest[lang_null + 1 :]

    trans_null = rest.find(b"\x00")
    if trans_null == -1:
        return None
    text_data = rest[trans_null + 1 :]

    if compression_flag == 1:
        try:
            text_data = zlib.decompress(text_data)
        except zlib.error:
            return None

    try:
        text = text_data.decode("utf-8")
    except UnicodeDecodeError:
        text = text_data.decode("utf-8", errors="replace")

    return keyword, text


def _decode_ztxt_chunk(chunk_data: bytes) -> tuple[str, str] | None:
    """Decode a zTXt (compressed text) chunk.

    Format: keyword\0compression_method\0compressed_text

    Args:
        chunk_data: Raw chunk data

    Returns:
        Tuple of (keyword, text) or None if invalid
    """
    null_pos = chunk_data.find(b"\x00")
    if null_pos == -1:
        return None

    keyword = chunk_data[:null_pos].decode("latin-1")

    if null_pos + 1 >= len(chunk_data):
        return None

    compressed_data = chunk_data[null_pos + 2 :]

    try:
        decompressed = zlib.decompress(compressed_data)
        text = decompressed.decode("utf-8")
    except (zlib.error, UnicodeDecodeError):
        return None

    return keyword, text


def read_text_chunks(data: bytes) -> dict[str, str] | None:
    """Read all text chunks (tEXt, iTXt, zTXt) from a PNG file.

    Args:
        data: Raw PNG file bytes

    Returns:
        Dictionary mapping keywords to text content, or None/empty dict if no text chunks
    """
    try:
        chunks = read_png_chunks(data)
    except InvalidPngError:
        return None

    result: dict[str, str] = {}

    for chunk_type, chunk_data in chunks:
        decoded: tuple[str, str] | None = None

        if chunk_type == "tEXt":
            decoded = _decode_text_chunk(chunk_data)
        elif chunk_type == "iTXt":
            decoded = _decode_itxt_chunk(chunk_data)
        elif chunk_type == "zTXt":
            decoded = _decode_ztxt_chunk(chunk_data)

        if decoded:
            keyword, text = decoded
            result[keyword] = text

    return result if result else None


def build_png(chunks: list[tuple[str, bytes]]) -> bytes:
    """Rebuild a PNG file from chunks.

    Args:
        chunks: List of (chunk_type, chunk_data) tuples

    Returns:
        Complete PNG file as bytes
    """
    result = bytearray(PNG_SIGNATURE)

    for chunk_type, chunk_data in chunks:
        length = struct.pack(">I", len(chunk_data))
        type_bytes = chunk_type.encode("latin-1")
        crc = zlib.crc32(type_bytes + chunk_data) & 0xFFFFFFFF
        crc_bytes = struct.pack(">I", crc)
        result.extend(length + type_bytes + chunk_data + crc_bytes)

    return bytes(result)


def _build_text_chunk_data(keyword: str, text: str) -> bytes:
    """Build tEXt chunk data.

    Uses Base64 encoding for the text content (no newlines).

    Args:
        keyword: Chunk keyword (e.g., 'ccv3', 'chara')
        text: Text content to encode

    Returns:
        Raw chunk data bytes
    """
    encoded = base64.b64encode(text.encode("utf-8"))
    return keyword.encode("latin-1") + b"\x00" + encoded


def inject_text_chunk(
    data: bytes,
    keyword: str,
    text: str,
    replace: bool = True,
) -> bytes:
    """Inject or replace a tEXt chunk in a PNG file.

    🚨 IDAT PROTECTION: This function only modifies text chunks.
    All other chunks (IHDR, IDAT, IEND, etc.) are preserved exactly.

    Args:
        data: Raw PNG file bytes
        keyword: Chunk keyword (e.g., 'ccv3', 'chara')
        text: Text content to inject
        replace: If True, replace existing chunk with same keyword

    Returns:
        Modified PNG file as bytes

    Raises:
        InvalidPngError: If input is not a valid PNG
    """
    chunks = read_png_chunks(data)

    new_chunk_data = _build_text_chunk_data(keyword, text)

    new_chunks: list[tuple[str, bytes]] = []
    replaced = False

    for chunk_type, chunk_data in chunks:
        if replace and chunk_type == "tEXt":
            decoded = _decode_text_chunk(chunk_data)
            if decoded and decoded[0] == keyword:
                new_chunks.append(("tEXt", new_chunk_data))
                replaced = True
                continue

        new_chunks.append((chunk_type, chunk_data))

    if not replaced:
        iend_index = None
        for i, (chunk_type, _) in enumerate(new_chunks):
            if chunk_type == "IEND":
                iend_index = i
                break

        if iend_index is not None:
            new_chunks.insert(iend_index, ("tEXt", new_chunk_data))
        else:
            new_chunks.append(("tEXt", new_chunk_data))

    return build_png(new_chunks)


def remove_text_chunk(data: bytes, keyword: str) -> bytes:
    """Remove a text chunk with the specified keyword.

    Args:
        data: Raw PNG file bytes
        keyword: Keyword of chunk to remove

    Returns:
        Modified PNG file as bytes
    """
    chunks = read_png_chunks(data)
    new_chunks: list[tuple[str, bytes]] = []

    for chunk_type, chunk_data in chunks:
        if chunk_type in ("tEXt", "iTXt", "zTXt"):
            decoded: tuple[str, str] | None = None
            if chunk_type == "tEXt":
                decoded = _decode_text_chunk(chunk_data)
            elif chunk_type == "iTXt":
                decoded = _decode_itxt_chunk(chunk_data)
            elif chunk_type == "zTXt":
                decoded = _decode_ztxt_chunk(chunk_data)

            if decoded and decoded[0] == keyword:
                continue

        new_chunks.append((chunk_type, chunk_data))

    return build_png(new_chunks)


def get_card_data(data: bytes) -> tuple[str, str] | None:
    """Extract character card data from PNG, preferring ccv3 over chara.

    Args:
        data: Raw PNG file bytes

    Returns:
        Tuple of (format_type, json_string) where format_type is 'ccv3' or 'chara',
        or None if no card data found
    """
    chunks = read_text_chunks(data)
    if not chunks:
        return None

    if "ccv3" in chunks:
        return ("ccv3", chunks["ccv3"])

    if "chara" in chunks:
        return ("chara", chunks["chara"])

    return None
