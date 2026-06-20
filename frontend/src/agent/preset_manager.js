const STORAGE_KEY = 'arcamage_agent_presets';

export const DEFAULT_PRESETS = [
  {
    id: 'polish',
    label: '润色',
    prompt: '请润色当前角色卡的文字表达，让语言更流畅、更有表现力。先读取要润色的字段（如 description、personality、first_mes），在保持原意、人称视角不变的前提下优化遣词造句与节奏。保留所有宏（{{user}}、{{char}}）和 HTML 标签，避免堆砌辞藻或改变设定。修改后用一两句话说明调整了哪些地方。',
  },
  {
    id: 'expand',
    label: '扩写',
    prompt: '请在现有内容的基础上扩写，补充更丰富的细节。先读取相关字段，理解已有的人设与世界观，再围绕场景氛围、外貌神态、动机情绪等维度增添内容，不要引入与既有设定冲突的信息。保持原有的语言风格，篇幅扩充要适度协调，保留宏与 HTML 标签。完成后简要说明补充了哪些细节。',
  },
  {
    id: 'refresh',
    label: '焕新',
    prompt: '请为角色描述换一种新鲜的表达方式。先读取 description 等核心字段，在完整保留角色身份、性格、关键设定的前提下，重新组织叙述结构与措辞，让描述更有记忆点、不落俗套。保留宏（{{user}}、{{char}}）和 HTML 标签，不要新增或删改既定事实。改写后用一两句话总结新旧风格的差异。',
  },
  {
    id: 'unify-style',
    label: '统一风格',
    prompt: '请统一整张卡片的描述风格。依次读取 description、personality、scenario、first_mes 等字段，识别语气、时态、人称、叙述视角上的不一致之处，将它们调整为统一连贯的语言风格。优先用 card_patch_text 做局部小改，避免整段重写，并保留宏与 HTML 标签。完成后说明统一到了哪种风格、改动了哪些字段。',
  },
  {
    id: 'fill-personality',
    label: '性格补全',
    prompt: '请填充并丰富角色的 personality 字段。先读取 description 和现有 personality，提炼角色的核心设定，再补全性格特质、说话习惯、行为倾向、价值观与情绪反应等内容，组织得条理清晰。保持与描述一致、不臆造冲突设定，保留宏与 HTML 标签。完成后简要说明补充了哪些性格维度。',
  },
  {
    id: 'greeting-refine',
    label: '开场白优化',
    prompt: '请优化角色的开场白（first_mes）。先读取 first_mes，在保留剧情走向和角色语气的前提下，改善开场的氛围营造、信息层次与代入感，让第一段更能吸引用户并自然落到角色口吻。保留所有宏（{{user}}、{{char}}）和 HTML 标签。完成后用一两句话说明优化思路。',
  },
  {
    id: 'greeting-add',
    label: '新增开场白',
    prompt: '请为角色设计一条新的备选开场白，追加到 alternate_greetings。先读取 first_mes 和现有的 alternate_greetings，确保新开场白在场景、情绪或切入点上与已有的有所区分，同时与角色设定保持一致、风格连贯。保留宏与 HTML 标签，避免与现有开场白重复。完成后说明这条开场白设定在什么情境。',
  },
  {
    id: 'lore-expand',
    label: '扩充世界书',
    prompt: '请扩充角色卡的世界书背景。先用 lorebook_* 工具列出条目概览（不要一次性读取整本世界书），再挑选需要丰富的现有条目或新增关键条目，如地点、势力、历史、规则、重要人物等，补充有层次的背景细节，并为新条目设置合理的 keys。保留宏与 HTML 标签，新增内容需与既有设定自洽。完成后简要说明新增或扩写了哪些条目。',
  },
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
