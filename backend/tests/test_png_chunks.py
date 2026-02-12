"""Tests for png_chunks.py - PNG chunk operations.

Tests cover:
- IDAT integrity (red line constraint)
- tEXt/iTXt/zTXt chunk reading
- tEXt chunk injection
- IEND garbage handling
"""

import hashlib
from pathlib import Path

import pytest


class TestPngChunks:
    """Test suite for PNG chunk read/write operations."""

    def test_idat_integrity_after_text_injection(self, golden_files_dir: Path):
        """注入 tEXt chunk 后 IDAT 数据必须保持完全一致"""
        from app.core.png_chunks import extract_idat_chunks, inject_text_chunk

        png_path = golden_files_dir / "v3_card.png"
        original_data = png_path.read_bytes()

        original_idat_chunks = extract_idat_chunks(original_data)
        original_hash = hashlib.md5(b"".join(original_idat_chunks)).hexdigest()

        modified_data = inject_text_chunk(
            original_data,
            keyword="test",
            text="test value",
        )

        modified_idat_chunks = extract_idat_chunks(modified_data)
        modified_hash = hashlib.md5(b"".join(modified_idat_chunks)).hexdigest()

        assert original_hash == modified_hash, "IDAT chunks must remain unchanged"

    def test_read_text_chunk_v3(self, golden_files_dir: Path):
        """能正确读取 ccv3 tEXt chunk"""
        from app.core.png_chunks import read_text_chunks

        png_path = golden_files_dir / "v3_card.png"
        png_data = png_path.read_bytes()

        chunks = read_text_chunks(png_data)

        assert "ccv3" in chunks
        assert isinstance(chunks["ccv3"], str)
        assert len(chunks["ccv3"]) > 0

    def test_read_text_chunk_v2(self, golden_files_dir: Path):
        """能正确读取 chara tEXt chunk"""
        from app.core.png_chunks import read_text_chunks

        png_path = golden_files_dir / "v2_card.png"
        png_data = png_path.read_bytes()

        chunks = read_text_chunks(png_data)

        assert "chara" in chunks
        assert isinstance(chunks["chara"], str)
        assert len(chunks["chara"]) > 0

    def test_read_dual_chunks(self, golden_files_dir: Path):
        """能同时读取 ccv3 和 chara chunk"""
        from app.core.png_chunks import read_text_chunks

        png_path = golden_files_dir / "dual_chunk.png"
        png_data = png_path.read_bytes()

        chunks = read_text_chunks(png_data)

        assert "ccv3" in chunks
        assert "chara" in chunks
        assert len(chunks["ccv3"]) > 0
        assert len(chunks["chara"]) > 0

    def test_inject_text_chunk(self, golden_files_dir: Path):
        """能正确注入 tEXt chunk"""
        from app.core.png_chunks import inject_text_chunk, read_text_chunks

        png_path = golden_files_dir / "plain_image.png"
        original_data = png_path.read_bytes()

        test_keyword = "test_key"
        test_value = "test_value_12345"

        modified_data = inject_text_chunk(
            original_data,
            keyword=test_keyword,
            text=test_value,
        )

        assert modified_data[:8] == b"\x89PNG\r\n\x1a\n", "PNG signature must be valid"

        chunks = read_text_chunks(modified_data)
        assert test_keyword in chunks
        assert chunks[test_keyword] == test_value

    def test_read_itxt_chunk(self, golden_files_dir: Path):
        """能正确读取 iTXt chunk"""
        from app.core.png_chunks import read_text_chunks

        png_path = golden_files_dir / "itxt_sample.png"
        png_data = png_path.read_bytes()

        chunks = read_text_chunks(png_data)

        assert len(chunks) > 0, "Should read at least one iTXt chunk"

    def test_read_ztxt_chunk(self, golden_files_dir: Path):
        """能正确读取 zTXt chunk"""
        from app.core.png_chunks import read_text_chunks

        png_path = golden_files_dir / "ztxt_sample.png"
        png_data = png_path.read_bytes()

        chunks = read_text_chunks(png_data)

        assert len(chunks) > 0, "Should read at least one zTXt chunk"

    def test_garbage_after_iend(self, golden_files_dir: Path):
        """IEND 后的垃圾数据应被忽略"""
        from app.core.png_chunks import read_text_chunks

        png_path = golden_files_dir / "garbage_after_iend.png"
        png_data = png_path.read_bytes()

        chunks = read_text_chunks(png_data)

        assert isinstance(chunks, dict), "Should return valid dict even with garbage after IEND"

    def test_plain_image_no_metadata(self, golden_files_dir: Path):
        """没有元数据的普通 PNG 应返回 None 或空字典"""
        from app.core.png_chunks import read_text_chunks

        png_path = golden_files_dir / "plain_image.png"
        png_data = png_path.read_bytes()

        chunks = read_text_chunks(png_data)

        assert chunks is None or chunks == {}, "Plain image should have no text chunks"
