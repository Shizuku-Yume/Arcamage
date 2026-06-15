export const DEFAULT_SUPPLIER_PROVIDER = 'openai-compatible';
export const DEFAULT_SUPPLIER_API = 'openai-completions';
export const DEFAULT_SUPPLIER_TRANSPORT = 'direct';
export const DEFAULT_CONTEXT_WINDOW = 128000;
export const DEFAULT_MAX_TOKENS = 4096;
export const DEFAULT_MODEL_TEMPERATURE = 1.0;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function clonePlainObject(value) {
  return isPlainObject(value) ? { ...value } : {};
}

function defaultCompatForSupplier({ provider, api }) {
  if (provider === 'openai-compatible' && api === 'openai-completions') {
    return {
      supportsDeveloperRole: false,
    };
  }
  return {};
}

function normalizeString(value, fallback = '') {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed || fallback;
}

function normalizePositiveInteger(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return Math.floor(numeric);
}

export function normalizeSupplierModels(models) {
  if (!Array.isArray(models)) return [];

  const seen = new Set();
  return models
    .map((item) => {
      const rawId = typeof item === 'string' ? item : item?.id;
      const id = typeof rawId === 'string' ? rawId.trim() : '';
      if (!id || seen.has(id)) return null;
      seen.add(id);
      if (isPlainObject(item)) {
        return { ...item, id };
      }
      return { id };
    })
    .filter(Boolean);
}

export function normalizeSupplierTemperature(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_MODEL_TEMPERATURE;
  const clamped = Math.min(2, Math.max(0, numeric));
  return Number(clamped.toFixed(1));
}

export function resolveTransport(config = {}) {
  const explicit = normalizeString(config?.transport, '');
  if (explicit === 'legacy-proxy') return 'arcamage-proxy';
  if (explicit) return explicit;
  return config?.useProxy ? 'arcamage-proxy' : DEFAULT_SUPPLIER_TRANSPORT;
}

export function normalizeSupplierConfig(raw = {}) {
  const transport = resolveTransport(raw);
  const provider = normalizeString(raw?.provider, DEFAULT_SUPPLIER_PROVIDER);
  const api = normalizeString(raw?.api, DEFAULT_SUPPLIER_API);
  const model = normalizeString(raw?.model ?? raw?.modelId ?? raw?.model_id, '');
  const useProxy = raw?.useProxy ?? transport === 'arcamage-proxy';
  const compat = {
    ...defaultCompatForSupplier({ provider, api }),
    ...clonePlainObject(raw?.compat),
  };

  return {
    ...raw,
    id: normalizeString(raw?.id, 'provider_default'),
    name: normalizeString(raw?.name, 'Provider'),
    provider,
    api,
    transport,
    compat,
    headers: clonePlainObject(raw?.headers),
    reasoning: raw?.reasoning === true,
    contextWindow: normalizePositiveInteger(raw?.contextWindow, DEFAULT_CONTEXT_WINDOW),
    maxTokens: normalizePositiveInteger(raw?.maxTokens, DEFAULT_MAX_TOKENS),
    availableModels: normalizeSupplierModels(raw?.availableModels || raw?.models),
    baseUrl: normalizeString(raw?.baseUrl ?? raw?.base_url, ''),
    apiKey: typeof (raw?.apiKey ?? raw?.api_key) === 'string' ? (raw?.apiKey ?? raw?.api_key) : '',
    model,
    modelId: model,
    useProxy: Boolean(useProxy) && transport === 'arcamage-proxy',
    temperature: normalizeSupplierTemperature(raw?.temperature),
  };
}

function normalizeModelBaseUrl(supplier) {
  const baseUrl = supplier.baseUrl;
  if (!['openai-completions', 'openai-responses'].includes(supplier.api)) return baseUrl;
  const normalized = baseUrl.replace(/\/+$/, '');
  if (!normalized || normalized.toLowerCase().endsWith('/v1')) return normalized;
  return `${normalized}/v1`;
}

export function supplierToModel(config = {}) {
  const supplier = normalizeSupplierConfig(config);
  return {
    id: supplier.model,
    name: supplier.model,
    api: supplier.api,
    provider: supplier.provider,
    baseUrl: normalizeModelBaseUrl(supplier),
    reasoning: supplier.reasoning,
    input: ['text'],
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    },
    contextWindow: supplier.contextWindow,
    maxTokens: supplier.maxTokens,
    headers: { ...supplier.headers },
    compat: { ...supplier.compat },
  };
}
