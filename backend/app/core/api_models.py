"""
API 请求和响应模型

定义所有 API 端点使用的请求/响应数据结构。
"""

from enum import Enum
from typing import Any, Dict, Generic, List, Literal, Optional, TypeVar

from pydantic import BaseModel, Field

from .card_models import CharacterCardV3, Lorebook

T = TypeVar("T")


# ============================================================
# 错误码枚举
# ============================================================


class ErrorCode(str, Enum):
    """API 错误码"""

    VALIDATION_ERROR = "VALIDATION_ERROR"
    PARSE_ERROR = "PARSE_ERROR"
    FILE_TOO_LARGE = "FILE_TOO_LARGE"
    INVALID_FORMAT = "INVALID_FORMAT"
    NETWORK_ERROR = "NETWORK_ERROR"
    TIMEOUT = "TIMEOUT"
    UNAUTHORIZED = "UNAUTHORIZED"
    RATE_LIMITED = "RATE_LIMITED"
    INTERNAL_ERROR = "INTERNAL_ERROR"


# ============================================================
# 通用响应模型
# ============================================================


class ApiResponse(BaseModel, Generic[T]):
    """统一 API 响应包装器"""

    success: bool = Field(..., description="请求是否成功")
    data: Optional[T] = Field(default=None, description="响应数据")
    error: Optional[str] = Field(default=None, description="错误消息")
    error_code: Optional[ErrorCode] = Field(default=None, description="错误码")


# ============================================================
# 卡片相关模型
# ============================================================


class ParseResult(BaseModel):
    """卡片解析结果"""

    card: CharacterCardV3 = Field(..., description="解析后的角色卡")
    source_format: Literal["v2", "v3", "json"] = Field(..., description="源数据格式")
    has_image: bool = Field(..., description="是否包含图像")
    warnings: List[str] = Field(default_factory=list, description="解析警告")


class InjectRequest(BaseModel):
    """卡片注入请求"""

    card: CharacterCardV3 = Field(..., description="要注入的角色卡数据")
    include_v2_compat: bool = Field(default=True, description="是否同时生成 chara chunk (V2 兼容)")


class ValidateResult(BaseModel):
    """卡片验证结果"""

    valid: bool = Field(..., description="是否通过验证")
    errors: List[str] = Field(default_factory=list, description="验证错误")
    warnings: List[str] = Field(default_factory=list, description="验证警告")


# ============================================================
# 世界书相关模型
# ============================================================


class LorebookExportResult(BaseModel):
    """世界书导出结果"""

    lorebook: Lorebook = Field(..., description="导出的世界书")
    entry_count: int = Field(..., description="条目数量")


class LorebookImportResult(BaseModel):
    """世界书导入结果"""

    card: CharacterCardV3 = Field(..., description="更新后的角色卡")
    entries_added: int = Field(..., description="新增条目数")


# ============================================================
# Token 估算模型
# ============================================================


class TokenEstimate(BaseModel):
    """Token 估算结果"""

    total_tokens: int = Field(..., description="总 Token 数")
    breakdown: Dict[str, int] = Field(default_factory=dict, description="各字段 Token 数明细")


# ============================================================
# Supplier (OpenAI-compatible) Models
# ============================================================


class SupplierModel(BaseModel):
    """Supplier model entry"""

    id: str = Field(..., description="模型 ID")


class SupplierConnectionRequest(BaseModel):
    """Supplier connection test request"""

    base_url: str = Field(..., description="OpenAI 兼容 API Base URL")
    api_key: str = Field(..., description="API Key")
    model: Optional[str] = Field(default=None, description="当前选择模型")
    use_proxy: bool = Field(default=False, description="是否使用代理")


class SupplierModelsRequest(BaseModel):
    """Supplier models request"""

    base_url: str = Field(..., description="OpenAI 兼容 API Base URL")
    api_key: str = Field(..., description="API Key")
    use_proxy: bool = Field(default=False, description="是否使用代理")


class SupplierChatRequest(BaseModel):
    """Supplier chat proxy request"""

    base_url: str = Field(..., description="OpenAI 兼容 API Base URL")
    api_key: str = Field(..., description="API Key")
    model: str = Field(..., description="模型 ID")
    messages: List[Dict[str, Any]] = Field(..., description="聊天消息列表")
    stream: bool = Field(default=True, description="是否使用流式响应")
    temperature: Optional[float] = Field(default=None, description="采样温度")
    tools: Optional[List[Dict[str, Any]]] = Field(default=None, description="工具列表")
    tool_choice: Optional[Any] = Field(default=None, description="工具选择策略")


class SupplierConnectionResult(BaseModel):
    """Supplier connection test result"""

    success: bool = Field(..., description="是否连接成功")
    message: str = Field(..., description="连接提示信息")
    models: List[SupplierModel] = Field(default_factory=list, description="可用模型列表")


class SupplierModelsResult(BaseModel):
    """Supplier models result"""

    models: List[SupplierModel] = Field(default_factory=list, description="可用模型列表")


# ============================================================
# 导出
# ============================================================

__all__ = [
    "ErrorCode",
    "ApiResponse",
    "ParseResult",
    "InjectRequest",
    "ValidateResult",
    "LorebookExportResult",
    "LorebookImportResult",
    "TokenEstimate",
    "SupplierModel",
    "SupplierConnectionRequest",
    "SupplierModelsRequest",
    "SupplierChatRequest",
    "SupplierConnectionResult",
    "SupplierModelsResult",
]
