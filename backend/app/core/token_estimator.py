"""Token estimation module.

Estimates token count for character card content.
Formula: Chinese characters / 0.7 + Non-Chinese characters / 4
"""

import re
from typing import Any, Dict, List, Optional

from .card_models import CharacterCardV3, Lorebook


CJK_PATTERN = re.compile(
    r"[\u4e00-\u9fff"  # CJK Unified Ideographs
    r"\u3400-\u4dbf"  # CJK Unified Ideographs Extension A
    r"\uf900-\ufaff"  # CJK Compatibility Ideographs
    r"\u3000-\u303f"  # CJK Symbols and Punctuation
    r"\u3040-\u309f"  # Hiragana
    r"\u30a0-\u30ff"  # Katakana
    r"\uac00-\ud7af"  # Korean Hangul
    r"\uff00-\uffef"  # Fullwidth Forms
    r"]"
)


def estimate_tokens(text: str) -> int:
    """Estimate token count for a text string.

    Formula:
    - CJK characters (Chinese/Japanese/Korean): count / 0.7
    - Other characters: count / 4

    Args:
        text: Input text

    Returns:
        Estimated token count
    """
    if not text:
        return 0

    cjk_chars = CJK_PATTERN.findall(text)
    cjk_count = len(cjk_chars)

    non_cjk_count = len(text) - cjk_count

    cjk_tokens = cjk_count / 0.7
    non_cjk_tokens = non_cjk_count / 4

    return int(cjk_tokens + non_cjk_tokens)


def estimate_lorebook_tokens(lorebook: Optional[Lorebook]) -> Dict[str, int]:
    """Estimate tokens for lorebook/world book.

    Args:
        lorebook: Lorebook model or None

    Returns:
        Dict with 'total' and per-entry breakdown by id/index
    """
    if not lorebook or not lorebook.entries:
        return {"total": 0, "entries": {}}

    entries_breakdown: Dict[str, int] = {}
    total = 0

    for i, entry in enumerate(lorebook.entries):
        if not entry.enabled:
            continue

        entry_tokens = estimate_tokens(entry.content)
        if entry.keys:
            entry_tokens += estimate_tokens(" ".join(entry.keys))
        if entry.secondary_keys:
            entry_tokens += estimate_tokens(" ".join(entry.secondary_keys))

        entry_id = str(entry.id) if entry.id is not None else f"entry_{i}"
        entries_breakdown[entry_id] = entry_tokens
        total += entry_tokens

    return {"total": total, "entries": entries_breakdown}


def estimate_card_tokens(card: CharacterCardV3) -> Dict[str, int]:
    """Estimate tokens for all fields in a character card.

    Args:
        card: CharacterCardV3 model

    Returns:
        Dict with field-level token breakdown and total
    """
    data = card.data
    breakdown: Dict[str, int] = {}

    text_fields = [
        ("name", data.name),
        ("description", data.description),
        ("first_mes", data.first_mes),
        ("personality", data.personality),
        ("scenario", data.scenario),
        ("mes_example", data.mes_example),
        ("system_prompt", data.system_prompt),
        ("post_history_instructions", data.post_history_instructions),
        ("creator_notes", data.creator_notes),
    ]

    for field_name, value in text_fields:
        if value:
            breakdown[field_name] = estimate_tokens(value)

    if data.alternate_greetings:
        alt_total = sum(estimate_tokens(g) for g in data.alternate_greetings)
        breakdown["alternate_greetings"] = alt_total

    if data.group_only_greetings:
        group_total = sum(estimate_tokens(g) for g in data.group_only_greetings)
        breakdown["group_only_greetings"] = group_total

    if data.character_book:
        lorebook_result = estimate_lorebook_tokens(data.character_book)
        breakdown["character_book"] = lorebook_result["total"]

    breakdown["total"] = sum(breakdown.values())

    return breakdown


def get_token_warning_level(
    current_tokens: int,
    budget: int = 8000,
) -> Optional[str]:
    """Get warning level based on token count.

    Args:
        current_tokens: Current token count
        budget: Token budget (default 8000)

    Returns:
        None if under 70%, 'warning' if 70-90%, 'danger' if over 90%
    """
    if budget <= 0:
        return None

    percentage = (current_tokens / budget) * 100

    if percentage >= 90:
        return "danger"
    elif percentage >= 70:
        return "warning"
    return None


__all__ = [
    "estimate_tokens",
    "estimate_lorebook_tokens",
    "estimate_card_tokens",
    "get_token_warning_level",
]
