"""
CCv3 and Lorebook Pydantic models.

Based on Character Card V3 Specification.
All models use extra='allow' to ensure unknown fields are passed through.
"""

from typing import Any, Dict, List, Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field


class LorebookEntry(BaseModel):
    """World book entry model."""

    model_config = ConfigDict(extra="allow")

    keys: List[str]
    content: str
    extensions: Dict[str, Any] = Field(default_factory=dict)
    enabled: bool = True
    insertion_order: int = 0
    case_sensitive: Optional[bool] = None
    use_regex: bool = False
    constant: Optional[bool] = None
    name: Optional[str] = None
    priority: Optional[int] = None
    id: Optional[Union[int, str]] = None
    comment: Optional[str] = None
    selective: Optional[bool] = None
    secondary_keys: List[str] = Field(default_factory=list)
    position: Optional[Literal["before_char", "after_char"]] = None


class Lorebook(BaseModel):
    """World book model."""

    model_config = ConfigDict(extra="allow")

    name: str = ""
    description: str = ""
    scan_depth: Optional[int] = None
    token_budget: Optional[int] = None
    recursive_scanning: Optional[bool] = None
    extensions: Dict[str, Any] = Field(default_factory=dict)
    entries: List[LorebookEntry] = Field(default_factory=list)


class Asset(BaseModel):
    """Character asset model (icon, background, etc.)."""

    model_config = ConfigDict(extra="allow")

    type: str
    uri: str
    name: str
    ext: str


class CharacterCardData(BaseModel):
    """Character card data model (V3 spec)."""

    model_config = ConfigDict(extra="allow")

    name: str
    description: str = ""
    tags: List[str] = Field(default_factory=list)
    creator: str = ""
    character_version: str = ""
    mes_example: str = ""
    extensions: Dict[str, Any] = Field(default_factory=dict)
    system_prompt: str = ""
    post_history_instructions: str = ""
    first_mes: str = ""
    alternate_greetings: List[str] = Field(default_factory=list)
    personality: str = ""
    scenario: str = ""
    creator_notes: str = ""
    character_book: Optional[Lorebook] = None
    assets: Optional[List[Asset]] = None
    nickname: Optional[str] = None
    creator_notes_multilingual: Optional[Dict[str, str]] = None
    source: Optional[List[str]] = None
    group_only_greetings: List[str] = Field(default_factory=list)
    creation_date: Optional[int] = None
    modification_date: Optional[int] = None


class CharacterCardV3(BaseModel):
    """Character Card V3 root model."""

    model_config = ConfigDict(extra="allow")

    spec: Literal["chara_card_v3"] = "chara_card_v3"
    spec_version: Literal["3.0"] = "3.0"
    data: CharacterCardData


__all__ = [
    "LorebookEntry",
    "Lorebook",
    "Asset",
    "CharacterCardData",
    "CharacterCardV3",
]
