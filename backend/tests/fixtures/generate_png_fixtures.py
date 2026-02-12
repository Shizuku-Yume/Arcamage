#!/usr/bin/env python3
"""Generate PNG test fixtures for Arcamage.

Run this script to create PNG test files with embedded character data.
Requires: Pillow (pip install Pillow)
"""

import base64
import json
import struct
import zlib
from pathlib import Path

# Output directory
OUTPUT_DIR = Path(__file__).parent / "golden_files"


def calculate_crc(chunk_type: bytes, data: bytes) -> int:
    """Calculate CRC32 for a PNG chunk."""
    return zlib.crc32(chunk_type + data) & 0xFFFFFFFF


def make_text_chunk(keyword: str, text: str) -> bytes:
    """Create a tEXt chunk."""
    chunk_type = b"tEXt"
    data = keyword.encode("latin-1") + b"\x00" + text.encode("latin-1")
    length = struct.pack(">I", len(data))
    crc = struct.pack(">I", calculate_crc(chunk_type, data))
    return length + chunk_type + data + crc


def make_itxt_chunk(keyword: str, text: str, language: str = "", translated_keyword: str = "") -> bytes:
    """Create an iTXt chunk (international text)."""
    chunk_type = b"iTXt"
    # iTXt format: keyword, null, compression flag (0), compression method (0),
    # language tag, null, translated keyword, null, text
    data = (
        keyword.encode("latin-1") + b"\x00" +  # keyword
        b"\x00" +  # compression flag (0 = not compressed)
        b"\x00" +  # compression method
        language.encode("latin-1") + b"\x00" +  # language tag
        translated_keyword.encode("utf-8") + b"\x00" +  # translated keyword
        text.encode("utf-8")  # text
    )
    length = struct.pack(">I", len(data))
    crc = struct.pack(">I", calculate_crc(chunk_type, data))
    return length + chunk_type + data + crc


def make_ztxt_chunk(keyword: str, text: str) -> bytes:
    """Create a zTXt chunk (compressed text)."""
    chunk_type = b"zTXt"
    compressed_text = zlib.compress(text.encode("latin-1"), 9)
    # zTXt format: keyword, null, compression method (0 = deflate), compressed text
    data = keyword.encode("latin-1") + b"\x00" + b"\x00" + compressed_text
    length = struct.pack(">I", len(data))
    crc = struct.pack(">I", calculate_crc(chunk_type, data))
    return length + chunk_type + data + crc


def create_minimal_png() -> bytes:
    """Create a minimal valid 1x1 red pixel PNG."""
    # PNG signature
    signature = b"\x89PNG\r\n\x1a\n"
    
    # IHDR chunk
    ihdr_data = struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)
    ihdr_type = b"IHDR"
    ihdr_crc = struct.pack(">I", calculate_crc(ihdr_type, ihdr_data))
    ihdr = struct.pack(">I", len(ihdr_data)) + ihdr_type + ihdr_data + ihdr_crc
    
    # IDAT chunk (1x1 red pixel, RGB)
    raw_data = b"\x00\xff\x00\x00"  # filter byte + R G B
    compressed = zlib.compress(raw_data, 9)
    idat_type = b"IDAT"
    idat_crc = struct.pack(">I", calculate_crc(idat_type, compressed))
    idat = struct.pack(">I", len(compressed)) + idat_type + compressed + idat_crc
    
    # IEND chunk
    iend_type = b"IEND"
    iend_crc = struct.pack(">I", calculate_crc(iend_type, b""))
    iend = struct.pack(">I", 0) + iend_type + iend_crc
    
    return signature + ihdr + idat + iend


def insert_text_chunk_before_iend(png_data: bytes, chunk: bytes) -> bytes:
    """Insert a chunk before IEND."""
    # Find IEND position (last 12 bytes: length(4) + type(4) + crc(4))
    iend_pos = png_data.rfind(b"IEND") - 4
    return png_data[:iend_pos] + chunk + png_data[iend_pos:]


def main():
    """Generate all PNG test fixtures."""
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    
    # Load JSON samples
    with open(OUTPUT_DIR / "v3_standard.json", encoding="utf-8") as f:
        v3_data = json.load(f)
    
    with open(OUTPUT_DIR / "v2_standard.json", encoding="utf-8") as f:
        v2_data = json.load(f)
    
    # Create base PNG
    base_png = create_minimal_png()
    print(f"Created base PNG: {len(base_png)} bytes")
    
    # V3 PNG (ccv3 chunk only)
    v3_json = json.dumps(v3_data, ensure_ascii=False, separators=(",", ":"))
    v3_b64 = base64.b64encode(v3_json.encode("utf-8")).decode("ascii")
    ccv3_chunk = make_text_chunk("ccv3", v3_b64)
    v3_png = insert_text_chunk_before_iend(base_png, ccv3_chunk)
    with open(OUTPUT_DIR / "v3_card.png", "wb") as f:
        f.write(v3_png)
    print(f"Created v3_card.png: {len(v3_png)} bytes")
    
    # V2 PNG (chara chunk only)
    v2_json = json.dumps(v2_data, ensure_ascii=False, separators=(",", ":"))
    v2_b64 = base64.b64encode(v2_json.encode("utf-8")).decode("ascii")
    chara_chunk = make_text_chunk("chara", v2_b64)
    v2_png = insert_text_chunk_before_iend(base_png, chara_chunk)
    with open(OUTPUT_DIR / "v2_card.png", "wb") as f:
        f.write(v2_png)
    print(f"Created v2_card.png: {len(v2_png)} bytes")
    
    # Dual chunk PNG (ccv3 + chara)
    dual_png = insert_text_chunk_before_iend(base_png, ccv3_chunk)
    dual_png = insert_text_chunk_before_iend(dual_png, chara_chunk)
    with open(OUTPUT_DIR / "dual_chunk.png", "wb") as f:
        f.write(dual_png)
    print(f"Created dual_chunk.png: {len(dual_png)} bytes")
    
    # PNG with garbage after IEND
    garbage = b"\x00\x01\x02\x03GARBAGE_DATA_AFTER_IEND\xff\xfe\xfd"
    garbage_png = v3_png + garbage
    with open(OUTPUT_DIR / "garbage_after_iend.png", "wb") as f:
        f.write(garbage_png)
    print(f"Created garbage_after_iend.png: {len(garbage_png)} bytes")
    
    # Plain PNG (no character data)
    with open(OUTPUT_DIR / "plain_image.png", "wb") as f:
        f.write(base_png)
    print(f"Created plain_image.png: {len(base_png)} bytes")
    
    # iTXt sample (international text chunk with UTF-8 support)
    itxt_text = '{"test": "iTXt chunk sample", "unicode": "中文测试 🎉"}'
    itxt_chunk = make_itxt_chunk("ccv3", itxt_text, language="en", translated_keyword="Character Card")
    itxt_png = insert_text_chunk_before_iend(base_png, itxt_chunk)
    with open(OUTPUT_DIR / "itxt_sample.png", "wb") as f:
        f.write(itxt_png)
    print(f"Created itxt_sample.png: {len(itxt_png)} bytes")
    
    # zTXt sample (compressed text chunk)
    ztxt_text = '{"test": "zTXt compressed chunk sample", "description": "This is a test of zTXt compression"}'
    ztxt_chunk = make_ztxt_chunk("ccv3", ztxt_text)
    ztxt_png = insert_text_chunk_before_iend(base_png, ztxt_chunk)
    with open(OUTPUT_DIR / "ztxt_sample.png", "wb") as f:
        f.write(ztxt_png)
    print(f"Created ztxt_sample.png: {len(ztxt_png)} bytes")
    
    print("\nAll PNG test fixtures generated successfully!")


if __name__ == "__main__":
    main()
