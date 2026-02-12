"""
异常处理器模块

提供 FastAPI 异常处理器，将自定义异常转换为统一的 API 响应格式。
"""

from fastapi import Request
from fastapi.responses import JSONResponse

from app.core.api_models import ApiResponse
from app.core.api_models import ErrorCode
from app.core.exceptions import ArcamageException


async def arcamage_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """统一异常响应处理"""
    if isinstance(exc, ArcamageException):
        error = exc.message
        error_code = exc.error_code
        status_code = exc.status_code
    else:
        error = str(exc)
        error_code = ErrorCode.INTERNAL_ERROR
        status_code = 500

    return JSONResponse(
        status_code=status_code,
        content=ApiResponse(
            success=False,
            error=error,
            error_code=error_code,
        ).model_dump(),
    )
