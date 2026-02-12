"""
统一异常处理模块

定义 Arcamage 应用的所有自定义异常类。
"""

from typing import Optional

from .api_models import ErrorCode


class ArcamageException(Exception):
    """Base exception for Arcamage"""

    def __init__(
        self,
        message: str,
        error_code: ErrorCode,
        status_code: int = 400,
        details: Optional[dict] = None,
    ):
        self.message = message
        self.error_code = error_code
        self.status_code = status_code
        self.details = details or {}
        super().__init__(message)


class ParseError(ArcamageException):
    """PNG/JSON 解析错误"""

    def __init__(self, message: str, details: Optional[dict] = None):
        super().__init__(message, ErrorCode.PARSE_ERROR, 400, details)


class ValidationError(ArcamageException):
    """V3 Schema 验证错误"""

    def __init__(self, message: str, details: Optional[dict] = None):
        super().__init__(message, ErrorCode.VALIDATION_ERROR, 422, details)


class FileTooLargeError(ArcamageException):
    """文件超过大小限制"""

    def __init__(self, message: str, max_size_mb: int):
        super().__init__(message, ErrorCode.FILE_TOO_LARGE, 413, {"max_size_mb": max_size_mb})


class InvalidFormatError(ArcamageException):
    """无效的文件格式"""

    def __init__(self, message: str, expected_formats: list[str]):
        super().__init__(
            message, ErrorCode.INVALID_FORMAT, 400, {"expected_formats": expected_formats}
        )


class NetworkError(ArcamageException):
    """网络请求错误"""

    def __init__(self, message: str, details: Optional[dict] = None):
        super().__init__(message, ErrorCode.NETWORK_ERROR, 502, details)


class TimeoutError(ArcamageException):
    """请求超时"""

    def __init__(self, message: str = "Request timed out"):
        super().__init__(message, ErrorCode.TIMEOUT, 504)


class UnauthorizedError(ArcamageException):
    """认证错误（Cookie/API Key 无效）"""

    def __init__(self, message: str = "Unauthorized"):
        super().__init__(message, ErrorCode.UNAUTHORIZED, 401)


class RateLimitedError(ArcamageException):
    """请求被限流"""

    def __init__(self, message: str = "Rate limit exceeded"):
        super().__init__(message, ErrorCode.RATE_LIMITED, 429)


class InternalServerError(ArcamageException):
    """内部服务器错误"""

    def __init__(self, message: str = "Internal server error", details: Optional[dict] = None):
        super().__init__(message, ErrorCode.INTERNAL_ERROR, 500, details)


__all__ = [
    "ArcamageException",
    "ParseError",
    "ValidationError",
    "FileTooLargeError",
    "InvalidFormatError",
    "NetworkError",
    "TimeoutError",
    "UnauthorizedError",
    "RateLimitedError",
    "InternalServerError",
]
