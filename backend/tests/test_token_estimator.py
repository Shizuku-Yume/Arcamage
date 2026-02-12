"""Tests for token_estimator module."""

import pytest

from app.core.token_estimator import (
    estimate_tokens,
    estimate_card_tokens,
    estimate_lorebook_tokens,
    get_token_warning_level,
)
from app.core.card_models import (
    CharacterCardData,
    CharacterCardV3,
    Lorebook,
    LorebookEntry,
)


class TestEstimateTokens:
    """Tests for basic token estimation."""

    def test_empty_string(self):
        """Empty string returns 0."""
        assert estimate_tokens("") == 0

    def test_english_text(self):
        """English text: ~4 chars per token."""
        text = "Hello world"
        tokens = estimate_tokens(text)
        assert tokens > 0
        expected = int(len(text) / 4)
        assert abs(tokens - expected) <= 3

    def test_chinese_text(self):
        """Chinese text: ~0.7 chars per token."""
        text = "你好世界"
        tokens = estimate_tokens(text)
        expected = int(len(text) / 0.7)
        assert tokens == expected

    def test_mixed_text(self):
        """Mixed CJK and Latin text."""
        text = "Hello 你好 World 世界"
        tokens = estimate_tokens(text)
        assert tokens > 0

    def test_japanese_hiragana(self):
        """Japanese hiragana is counted as CJK."""
        text = "こんにちは"
        tokens = estimate_tokens(text)
        expected = int(len(text) / 0.7)
        assert tokens == expected

    def test_korean_hangul(self):
        """Korean hangul is counted as CJK."""
        text = "안녕하세요"
        tokens = estimate_tokens(text)
        expected = int(len(text) / 0.7)
        assert tokens == expected


class TestEstimateLorebookTokens:
    """Tests for lorebook token estimation."""

    def test_empty_lorebook(self):
        """Empty lorebook returns 0."""
        lorebook = Lorebook(entries=[])
        result = estimate_lorebook_tokens(lorebook)
        assert result["total"] == 0

    def test_none_lorebook(self):
        """None lorebook returns 0."""
        result = estimate_lorebook_tokens(None)
        assert result["total"] == 0

    def test_counts_enabled_entries_only(self):
        """Only enabled entries are counted."""
        lorebook = Lorebook(
            entries=[
                LorebookEntry(
                    keys=["test"],
                    content="This is content",
                    enabled=True,
                ),
                LorebookEntry(
                    keys=["disabled"],
                    content="This should not count",
                    enabled=False,
                ),
            ]
        )
        result = estimate_lorebook_tokens(lorebook)

        assert result["total"] > 0
        assert len(result["entries"]) == 1

    def test_includes_keys_in_count(self):
        """Keys are included in token count."""
        lorebook = Lorebook(
            entries=[
                LorebookEntry(
                    keys=["keyword1", "keyword2"],
                    content="content",
                    enabled=True,
                ),
            ]
        )
        result1 = estimate_lorebook_tokens(lorebook)

        lorebook_no_keys = Lorebook(
            entries=[
                LorebookEntry(
                    keys=[],
                    content="content",
                    enabled=True,
                    constant=True,
                ),
            ]
        )
        result2 = estimate_lorebook_tokens(lorebook_no_keys)

        assert result1["total"] > result2["total"]


class TestEstimateCardTokens:
    """Tests for full card token estimation."""

    def test_basic_card(self):
        """Basic card estimation works."""
        card = CharacterCardV3(
            data=CharacterCardData(
                name="Test",
                description="A test character",
                first_mes="Hello!",
            )
        )
        result = estimate_card_tokens(card)

        assert "total" in result
        assert "name" in result
        assert "description" in result
        assert "first_mes" in result
        assert result["total"] > 0

    def test_includes_all_text_fields(self):
        """All relevant text fields are counted."""
        card = CharacterCardV3(
            data=CharacterCardData(
                name="Test",
                description="desc",
                first_mes="greeting",
                personality="personality",
                scenario="scenario",
                mes_example="example",
                system_prompt="system",
                post_history_instructions="post",
                creator_notes="notes",
            )
        )
        result = estimate_card_tokens(card)

        assert "personality" in result
        assert "scenario" in result
        assert result["total"] == sum(v for k, v in result.items() if k != "total")

    def test_includes_alternate_greetings(self):
        """Alternate greetings are counted."""
        card = CharacterCardV3(
            data=CharacterCardData(
                name="Test",
                alternate_greetings=["greeting 1", "greeting 2", "greeting 3"],
            )
        )
        result = estimate_card_tokens(card)

        assert "alternate_greetings" in result
        assert result["alternate_greetings"] > 0

    def test_includes_lorebook(self):
        """Lorebook tokens are included."""
        card = CharacterCardV3(
            data=CharacterCardData(
                name="Test",
                character_book=Lorebook(
                    entries=[
                        LorebookEntry(
                            keys=["test"],
                            content="Lorebook content here",
                            enabled=True,
                        )
                    ]
                ),
            )
        )
        result = estimate_card_tokens(card)

        assert "character_book" in result
        assert result["character_book"] > 0


class TestGetTokenWarningLevel:
    """Tests for token warning level detection."""

    def test_no_warning_under_70(self):
        """No warning under 70% of budget."""
        assert get_token_warning_level(5000, 8000) is None

    def test_warning_at_70(self):
        """Warning at 70% of budget."""
        assert get_token_warning_level(5600, 8000) == "warning"

    def test_warning_between_70_90(self):
        """Warning between 70-90%."""
        assert get_token_warning_level(6400, 8000) == "warning"

    def test_danger_at_90(self):
        """Danger at 90% of budget."""
        assert get_token_warning_level(7200, 8000) == "danger"

    def test_danger_over_100(self):
        """Danger when over budget."""
        assert get_token_warning_level(10000, 8000) == "danger"

    def test_handles_zero_budget(self):
        """Zero budget returns None."""
        assert get_token_warning_level(1000, 0) is None
