/**
 * API 请求封装模块
 * 
 * 提供统一的 fetch 封装、错误归一化处理
 */

// API 错误码枚举 (与后端 ErrorCode 对齐)
export const ErrorCode = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  PARSE_ERROR: 'PARSE_ERROR',
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  INVALID_FORMAT: 'INVALID_FORMAT',
  NETWORK_ERROR: 'NETWORK_ERROR',
  TIMEOUT: 'TIMEOUT',
  UNAUTHORIZED: 'UNAUTHORIZED',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
};

// 错误码对应的用户友好消息
const ERROR_MESSAGES = {
  [ErrorCode.VALIDATION_ERROR]: '数据验证失败',
  [ErrorCode.PARSE_ERROR]: '解析失败，请检查文件格式',
  [ErrorCode.FILE_TOO_LARGE]: '文件过大，请上传小于 20MB 的文件',
  [ErrorCode.INVALID_FORMAT]: '不支持的文件格式',
  [ErrorCode.NETWORK_ERROR]: '网络错误，请检查网络连接',
  [ErrorCode.TIMEOUT]: '请求超时，请稍后重试',
  [ErrorCode.UNAUTHORIZED]: '认证失败，请检查 API Key',
  [ErrorCode.RATE_LIMITED]: '请求过于频繁，请稍后重试',
  [ErrorCode.INTERNAL_ERROR]: '服务器内部错误，请稍后重试',
};

/**
 * API 错误类
 */
export class ApiError extends Error {
  constructor(message, code, status, details = null) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }

  /**
   * 获取用户友好的错误消息
   */
  getUserMessage() {
    return ERROR_MESSAGES[this.code] || this.message || `未知错误 (${this.code})`;
  }
}

/**
 * 默认请求配置
 */
const DEFAULT_CONFIG = {
  timeout: 30000, // 30 秒超时
  headers: {
    'Accept': 'application/json',
  },
};

/**
 * 创建带超时的 AbortController
 */
function createTimeoutController(timeout) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  return { controller, timeoutId };
}

/**
 * 解析响应体
 */
async function parseResponse(response) {
  const contentType = response.headers.get('content-type');
  
  // JSON 响应
  if (contentType?.includes('application/json')) {
    return await response.json();
  }
  
  // 二进制响应 (如 PNG)
  if (contentType?.includes('image/') || contentType?.includes('application/octet-stream')) {
    return await response.blob();
  }
  
  // 文本响应
  return await response.text();
}

/**
 * 处理响应错误
 */
async function handleResponseError(response) {
  let errorData = null;
  let message = `请求失败: ${response.status}`;
  let code = ErrorCode.INTERNAL_ERROR;

  try {
    errorData = await response.json();
    message = errorData.error || errorData.detail || message;
    code = errorData.error_code || code;
  } catch {
    // 无法解析 JSON，使用默认消息
  }

  // 根据 HTTP 状态码映射错误码
  switch (response.status) {
    case 400:
      code = errorData?.error_code || ErrorCode.VALIDATION_ERROR;
      break;
    case 401:
      code = ErrorCode.UNAUTHORIZED;
      break;
    case 413:
      code = ErrorCode.FILE_TOO_LARGE;
      break;
    case 422:
      code = ErrorCode.VALIDATION_ERROR;
      break;
    case 429:
      code = ErrorCode.RATE_LIMITED;
      break;
    case 502:
    case 504:
      code = ErrorCode.TIMEOUT;
      break;
    case 500:
    default:
      code = ErrorCode.INTERNAL_ERROR;
  }

  throw new ApiError(message, code, response.status, errorData);
}

/**
 * 发起 API 请求
 * 
 * @param {string} url - 请求 URL
 * @param {Object} options - fetch 选项
 * @param {number} options.timeout - 超时时间 (毫秒)
 * @param {Object} options.params - URL 查询参数
 * @returns {Promise<any>} 响应数据
 */
export async function request(url, options = {}) {
  const config = { ...DEFAULT_CONFIG, ...options };
  const { timeout, params, ...fetchOptions } = config;
  
  // 处理查询参数
  if (params && typeof params === 'object') {
    const urlObj = new URL(url, window.location.origin);
    Object.keys(params).forEach(key => {
      if (params[key] !== undefined && params[key] !== null) {
        urlObj.searchParams.append(key, params[key]);
      }
    });
    url = urlObj.pathname + urlObj.search;
  }
  
  // 创建超时控制器
  const { controller, timeoutId } = createTimeoutController(timeout);
  
  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      await handleResponseError(response);
    }
    
    return await parseResponse(response);
  } catch (error) {
    clearTimeout(timeoutId);
    
    // 处理中止/超时错误
    if (error.name === 'AbortError') {
      throw new ApiError('请求超时', ErrorCode.TIMEOUT, 0);
    }
    
    // 处理网络错误
    if (error instanceof TypeError && error.message.includes('fetch')) {
      throw new ApiError('网络连接失败', ErrorCode.NETWORK_ERROR, 0);
    }
    
    // 已经是 ApiError，直接抛出
    if (error instanceof ApiError) {
      throw error;
    }
    
    // 其他错误
    throw new ApiError(error.message, ErrorCode.INTERNAL_ERROR, 0);
  }
}

/**
 * GET 请求
 */
export async function get(url, options = {}) {
  return request(url, { ...options, method: 'GET' });
}

/**
 * POST 请求 (JSON body)
 */
export async function post(url, data, options = {}) {
  return request(url, {
    ...options,
    method: 'POST',
    headers: {
      ...DEFAULT_CONFIG.headers,
      'Content-Type': 'application/json',
      ...options.headers,
    },
    body: JSON.stringify(data),
  });
}

/**
 * POST 请求 (FormData/multipart)
 */
export async function postForm(url, formData, options = {}) {
  // 不设置 Content-Type，让浏览器自动设置 multipart boundary
  const headers = { ...options.headers };
  delete headers['Content-Type'];
  
  return request(url, {
    ...options,
    method: 'POST',
    headers,
    body: formData,
  });
}


// ============================================================
// Cards API
// ============================================================

/**
 * 解析角色卡 (PNG/JSON)
 * 
 * @param {File} file - 要解析的文件
 * @returns {Promise<Object>} ParseResult (已解包的 data 字段)
 */
export async function parseCard(file) {
  const formData = new FormData();
  formData.append('file', file);
  
  const resp = await postForm('/api/cards/parse', formData);
  return unwrapApiResponse(resp, '解析失败', ErrorCode.PARSE_ERROR);
}

/**
 * 注入角色卡数据到 PNG
 * 
 * @param {File} imageFile - 原始 PNG 文件
 * @param {Object} cardData - CharacterCardV3 数据
 * @param {boolean} includeV2Compat - 是否包含 V2 兼容数据
 * @returns {Promise<Blob>} PNG Blob
 */
export async function injectCard(imageFile, cardData, includeV2Compat = true) {
  const formData = new FormData();
  formData.append('file', imageFile);
  formData.append('card_v3_json', JSON.stringify(cardData));
  formData.append('include_v2_compat', String(includeV2Compat));
  
  return postForm('/api/cards/inject', formData, { timeout: 60000 });
}

/**
 * 验证角色卡数据
 * 
 * @param {Object} cardData - CharacterCardV3 数据
 * @returns {Promise<Object>} ValidateResult
 */
export async function validateCard(cardData) {
  return post('/api/cards/validate', cardData);
}

// ============================================================
// Lorebook API
// ============================================================

/**
 * 导出世界书
 * 
 * @param {Object} cardData - CharacterCardV3 数据
 * @returns {Promise<Object>} LorebookExportResult
 */
export async function exportLorebook(cardData) {
  const resp = await post('/api/lorebook/export', { card: cardData });
  return unwrapApiResponse(resp, '导出失败', ErrorCode.INTERNAL_ERROR);
}

/**
 * 导入世界书
 * 
 * @param {Object} cardData - CharacterCardV3 数据
 * @param {Object} lorebook - Lorebook 数据
 * @param {string} mergeMode - 合并模式: 'replace', 'merge', 'skip'
 * @returns {Promise<Object>} LorebookImportResult
 */
export async function importLorebook(cardData, lorebook, mergeMode = 'replace') {
  const resp = await post('/api/lorebook/import', {
    card: cardData,
    lorebook: lorebook,
    merge_mode: mergeMode,
  });
  return unwrapApiResponse(resp, '导入失败', ErrorCode.INTERNAL_ERROR);
}

// ============================================================
// Health API
// ============================================================

/**
 * 健康检查
 */
export async function checkHealth() {
  return get('/api/health');
}

/**
 * 获取版本信息
 */
export async function getVersion() {
  return get('/api/version');
}

// ============================================================
// Supplier API (OpenAI-compatible)
// ============================================================

function normalizeSupplierBaseUrl(baseUrl) {
  if (!baseUrl || typeof baseUrl !== 'string') {
    throw new ApiError('请填写 API 地址', ErrorCode.VALIDATION_ERROR, 400);
  }

  const trimmed = baseUrl.trim();
  if (!trimmed) {
    throw new ApiError('请填写 API 地址', ErrorCode.VALIDATION_ERROR, 400);
  }

  return trimmed.replace(/\/+$/, '');
}

function extractModelsFromPayload(payload) {
  const data = payload?.data;
  if (!Array.isArray(data)) return [];
  return data
    .filter((item) => item && typeof item === 'object' && item.id)
    .map((item) => ({ id: item.id }));
}

async function fetchModelsDirect(baseUrl, apiKey) {
  const normalizedBaseUrl = normalizeSupplierBaseUrl(baseUrl);
  let url;

  try {
    url = new URL('/v1/models', normalizedBaseUrl);
  } catch (error) {
    throw new ApiError('API 地址无效', ErrorCode.VALIDATION_ERROR, 400, { error });
  }

  let response;
  try {
    response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
    });
  } catch (error) {
    throw new ApiError('跨域限制，请启用代理', ErrorCode.NETWORK_ERROR, 0, { error });
  }

  if (!response.ok) {
    let message = `请求失败 (${response.status})`;
    let code = ErrorCode.INTERNAL_ERROR;

    if (response.status === 401) {
      message = '认证失败，请检查 API Key';
      code = ErrorCode.UNAUTHORIZED;
    } else if (response.status === 429) {
      message = '请求过于频繁，请稍后重试';
      code = ErrorCode.RATE_LIMITED;
    } else if (response.status === 400) {
      message = 'API 地址无效';
      code = ErrorCode.VALIDATION_ERROR;
    }

    throw new ApiError(message, code, response.status);
  }

  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    throw new ApiError('响应解析失败', ErrorCode.PARSE_ERROR, response.status, { error });
  }

  return extractModelsFromPayload(payload);
}

export async function getSupplierModels(config) {
  const normalizedBaseUrl = normalizeSupplierBaseUrl(config?.baseUrl);

  if (config?.useProxy) {
    const resp = await post('/api/suppliers/models', {
      base_url: normalizedBaseUrl,
      api_key: config.apiKey,
      use_proxy: config.useProxy,
    });
    const data = unwrapApiResponse(resp, '获取模型列表失败', ErrorCode.NETWORK_ERROR);
    return data.models || [];
  }

  return fetchModelsDirect(normalizedBaseUrl, config?.apiKey);
}

export async function testSupplierConnection(config) {
  const normalizedBaseUrl = normalizeSupplierBaseUrl(config?.baseUrl);

  if (config?.useProxy) {
    const resp = await post('/api/suppliers/test-connection', {
      base_url: normalizedBaseUrl,
      api_key: config.apiKey,
      use_proxy: config.useProxy,
      model: config.model || null,
    });

    return unwrapApiResponse(resp, '连接失败', ErrorCode.NETWORK_ERROR);
  }

  const models = await fetchModelsDirect(normalizedBaseUrl, config?.apiKey);
  return {
    success: true,
    message: '连接成功',
    models,
  };
}

function unwrapApiResponse(resp, errorMessage, errorCode) {
  if (resp && resp.success === false) {
    throw new ApiError(resp.error || errorMessage, resp.error_code || errorCode, 400);
  }
  if (resp && typeof resp === 'object' && 'data' in resp) {
    return resp.data;
  }
  return resp;
}

// ============================================================
// 导出
// ============================================================

export default {
  ErrorCode,
  ApiError,
  request,
  get,
  post,
  postForm,
  parseCard,
  injectCard,
  validateCard,
  exportLorebook,
  importLorebook,
  checkHealth,
  getVersion,
  getSupplierModels,
  testSupplierConnection,
};
