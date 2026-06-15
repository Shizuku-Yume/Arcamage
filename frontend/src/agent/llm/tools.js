function normalizePlainTool(tool) {
  if (!tool || typeof tool !== 'object') return null;
  const source = tool.type === 'function' && tool.function ? tool.function : tool;
  const name = typeof source?.name === 'string' ? source.name.trim() : '';
  if (!name) return null;
  return {
    name,
    description: typeof source.description === 'string' ? source.description : '',
    parameters: source.parameters && typeof source.parameters === 'object'
      ? source.parameters
      : { type: 'object', properties: {} },
  };
}

export function normalizeToolDefinitions(tools) {
  if (!Array.isArray(tools)) return [];
  return tools
    .map((tool) => normalizePlainTool(tool))
    .filter(Boolean);
}

export function toLegacyOpenAiTools(tools) {
  if (!Array.isArray(tools) || tools.length === 0) return undefined;
  const normalized = normalizeToolDefinitions(tools);
  if (normalized.length === 0) return undefined;
  return normalized.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

export function toPiAiTools(tools) {
  return normalizeToolDefinitions(tools).map((tool) => ({ ...tool }));
}
