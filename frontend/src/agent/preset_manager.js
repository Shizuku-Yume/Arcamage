const STORAGE_KEY = 'arcamage_agent_presets';

export const DEFAULT_PRESETS = [
  { id: 'translate', label: '翻译', prompt: '请将主要内容翻译成中文，保持语气自然。' },
  { id: 'polish', label: '润色', prompt: '请润色文字，使其更有表现力但不改变含义。' },
  { id: 'expand', label: '扩写', prompt: '请在原有基础上扩写内容，增加细节。' },
  { id: 'refresh', label: '焕新', prompt: '请优化角色描述，补充细节并保持原有风格。' },
];

function normalizeHiddenIds(hiddenIds) {
  if (!Array.isArray(hiddenIds)) return [];
  const normalized = hiddenIds
    .map((item) => String(item || '').trim())
    .filter(Boolean);
  return Array.from(new Set(normalized));
}

function normalizePreset(preset, fallbackId) {
  if (!preset || typeof preset !== 'object') return null;
  const label = String(preset.label || '').trim();
  const prompt = String(preset.prompt || '').trim();
  if (!label || !prompt) return null;
  const id = String(preset.id || fallbackId || '').trim();
  return {
    id: id || `custom_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    label,
    prompt,
  };
}

export function loadCustomPresets() {
  return loadPresetState().customPresets;
}

export function saveCustomPresets(customPresets) {
  const state = loadPresetState();
  savePresetState({
    customPresets,
    hiddenPresetIds: state.hiddenPresetIds,
  });
}

export function loadPresetState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { customPresets: [], hiddenPresetIds: [] };
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.custom)
        ? parsed.custom
        : [];
    const hidden = normalizeHiddenIds(parsed?.hidden || []);
    const customPresets = list
      .map((item, index) => normalizePreset(item, `custom_${index}`))
      .filter(Boolean);
    return { customPresets, hiddenPresetIds: hidden };
  } catch (error) {
    console.warn('Failed to load agent presets:', error);
    return { customPresets: [], hiddenPresetIds: [] };
  }
}

export function savePresetState({ customPresets, hiddenPresetIds }) {
  try {
    const sanitized = (customPresets || [])
      .map((item, index) => normalizePreset(item, `custom_${index}`))
      .filter(Boolean);
    const hidden = normalizeHiddenIds(hiddenPresetIds || []);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      custom: sanitized,
      hidden,
    }));
  } catch (error) {
    console.warn('Failed to save agent presets:', error);
  }
}

export function createCustomPreset({ label, prompt }) {
  const safeLabel = String(label || '').trim();
  const safePrompt = String(prompt || '').trim();
  if (!safeLabel || !safePrompt) return null;
  return normalizePreset({ label: safeLabel, prompt: safePrompt });
}

export default {
  DEFAULT_PRESETS,
  loadCustomPresets,
  saveCustomPresets,
  loadPresetState,
  savePresetState,
  createCustomPreset,
};
