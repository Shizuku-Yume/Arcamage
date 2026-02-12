"""pytest configuration and fixtures."""

import json
from pathlib import Path

import pytest

# Fixtures directory
FIXTURES_DIR = Path(__file__).parent / "fixtures"
GOLDEN_FILES_DIR = FIXTURES_DIR / "golden_files"


@pytest.fixture
def fixtures_dir() -> Path:
    """Return the fixtures directory path."""
    return FIXTURES_DIR


@pytest.fixture
def golden_files_dir() -> Path:
    """Return the golden files directory path."""
    return GOLDEN_FILES_DIR


@pytest.fixture
def v3_standard_json() -> dict:
    """Load standard V3 JSON sample."""
    with open(GOLDEN_FILES_DIR / "v3_standard.json", encoding="utf-8") as f:
        return json.load(f)


@pytest.fixture
def v2_standard_json() -> dict:
    """Load standard V2 JSON sample."""
    with open(GOLDEN_FILES_DIR / "v2_standard.json", encoding="utf-8") as f:
        return json.load(f)


@pytest.fixture
def xss_attack_json() -> dict:
    """Load XSS attack sample JSON."""
    with open(GOLDEN_FILES_DIR / "xss_attack_sample.json", encoding="utf-8") as f:
        return json.load(f)


@pytest.fixture
def minimal_png_bytes() -> bytes:
    """Generate minimal valid PNG bytes (1x1 white pixel)."""
    # Minimal valid PNG: 1x1 white pixel
    # This is a complete valid PNG file
    return bytes(
        [
            # PNG signature
            0x89,
            0x50,
            0x4E,
            0x47,
            0x0D,
            0x0A,
            0x1A,
            0x0A,
            # IHDR chunk (13 bytes data)
            0x00,
            0x00,
            0x00,
            0x0D,  # length
            0x49,
            0x48,
            0x44,
            0x52,  # "IHDR"
            0x00,
            0x00,
            0x00,
            0x01,  # width = 1
            0x00,
            0x00,
            0x00,
            0x01,  # height = 1
            0x08,  # bit depth = 8
            0x02,  # color type = RGB
            0x00,  # compression = deflate
            0x00,  # filter = adaptive
            0x00,  # interlace = none
            0x90,
            0x77,
            0x53,
            0xDE,  # CRC
            # IDAT chunk (compressed pixel data)
            0x00,
            0x00,
            0x00,
            0x0C,  # length = 12
            0x49,
            0x44,
            0x41,
            0x54,  # "IDAT"
            0x08,
            0xD7,
            0x63,
            0xF8,
            0xFF,
            0xFF,
            0xFF,
            0x00,
            0x05,
            0xFE,
            0x02,
            0xFE,  # compressed data
            0xA2,
            0x71,
            0x90,
            0x56,  # CRC
            # IEND chunk
            0x00,
            0x00,
            0x00,
            0x00,  # length = 0
            0x49,
            0x45,
            0x4E,
            0x44,  # "IEND"
            0xAE,
            0x42,
            0x60,
            0x82,  # CRC
        ]
    )
