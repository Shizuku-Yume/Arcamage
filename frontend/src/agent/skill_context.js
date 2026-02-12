import {
  SKILL_AUTO_MATCH_LIMIT,
  SKILL_CONTEXT_TOTAL_MAX_CHARS,
  SKILL_LOW_PRIORITY_SECTIONS,
} from './skill_constants.js';
import { loadSkillBundle, loadSkillCatalog } from './skill_manager.js';

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeIds(ids) {
  if (!Array.isArray(ids)) return [];
  const values = ids
    .map((item) => String(item || '').trim())
    .filter(Boolean);
  return Array.from(new Set(values));
}

function extractKeywordsFromSkill(entry) {
  const sources = [
    entry?.id,
    entry?.description,
    ...(Array.isArray(entry?.tags) ? entry.tags : []),
  ];

  const tokens = new Set();
  sources.forEach((source) => {
    const text = normalizeText(source);
    if (!text) return;
    text
      .split(/[^a-z0-9\u4e00-\u9fff]+/u)
      .map((token) => token.trim())
      .filter(Boolean)
      .forEach((token) => {
        if (token.length >= 2) {
          tokens.add(token);
        }
      });
  });

  return Array.from(tokens);
}

function scoreAutoMatch(entry, instruction) {
  const text = normalizeText(instruction);
  if (!text) return 0;

  let score = 0;
  const id = normalizeText(entry?.id);
  const tags = Array.isArray(entry?.tags)
    ? entry.tags.map((item) => normalizeText(item)).filter(Boolean)
    : [];

  if (id && text.includes(id)) score += 8;
  tags.forEach((tag) => {
    if (tag && text.includes(tag)) {
      score += 3;
    }
  });

  const keywords = extractKeywordsFromSkill(entry);
  keywords.forEach((token) => {
    if (!token || token.length < 2) return;
    if (text.includes(token)) {
      score += token.length >= 4 ? 2 : 1;
    }
  });

  return score;
}

function createEmptyMeta() {
  return {
    loadedSkillIds: [],
    loadedReferences: [],
    truncated: [],
    ignored: [],
    warnings: [],
    totalChars: 0,
  };
}

function headingShouldDrop(title) {
  const normalized = normalizeText(title);
  return SKILL_LOW_PRIORITY_SECTIONS.some((keyword) => normalized.includes(normalizeText(keyword)));
}

function removeLowPrioritySections(markdown) {
  const lines = String(markdown || '').split('\n');
  const output = [];
  const removedSections = [];
  let skipLevel = null;

  lines.forEach((line) => {
    const headingMatch = line.match(/^(#{2,6})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const title = headingMatch[2].trim();

      if (skipLevel !== null && level <= skipLevel) {
        skipLevel = null;
      }

      if (skipLevel === null && headingShouldDrop(title)) {
        skipLevel = level;
        removedSections.push(title);
        return;
      }
    }

    if (skipLevel !== null) return;
    output.push(line);
  });

  return {
    content: output.join('\n').trim(),
    removedSections,
  };
}

function fitSkillMainContent(content, budget) {
  const text = String(content || '').trim();
  if (!text || budget <= 0) {
    return {
      content: '',
      truncated: text.length > 0,
      removedSections: [],
      originalChars: text.length,
      usedChars: 0,
    };
  }
  if (text.length <= budget) {
    return {
      content: text,
      truncated: false,
      removedSections: [],
      originalChars: text.length,
      usedChars: text.length,
    };
  }

  const removed = removeLowPrioritySections(text);
  let candidate = removed.content || text;
  let truncated = candidate.length > budget;
  if (truncated) {
    candidate = candidate.slice(0, budget);
  }

  return {
    content: candidate,
    truncated,
    removedSections: removed.removedSections,
    originalChars: text.length,
    usedChars: candidate.length,
  };
}

function fitReferenceContent(content, budget) {
  const text = String(content || '');
  if (!text || budget <= 0) {
    return {
      content: '',
      truncated: text.length > 0,
      originalChars: text.length,
      usedChars: 0,
    };
  }
  if (text.length <= budget) {
    return {
      content: text,
      truncated: false,
      originalChars: text.length,
      usedChars: text.length,
    };
  }
  const trimmed = text.slice(0, budget);
  return {
    content: trimmed,
    truncated: true,
    originalChars: text.length,
    usedChars: trimmed.length,
  };
}

function appendBlock(parts, block) {
  const text = String(block || '').trim();
  if (!text) return;
  parts.push(text);
}

export function createEmptySkillContextMeta() {
  return createEmptyMeta();
}

export function selectAutoMatchedSkillIds({ catalog, instruction, limit = SKILL_AUTO_MATCH_LIMIT }) {
  const list = Array.isArray(catalog) ? catalog : [];
  const scored = list
    .map((entry) => ({
      id: String(entry?.id || '').trim(),
      score: scoreAutoMatch(entry, instruction),
    }))
    .filter((entry) => entry.id && entry.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return left.id.localeCompare(right.id);
    });

  return scored.slice(0, Math.max(0, Number(limit) || 0)).map((entry) => entry.id);
}

export async function buildSkillContext({
  instruction,
  enabled = true,
  selectedIds = [],
  catalog = null,
  totalMaxChars = SKILL_CONTEXT_TOTAL_MAX_CHARS,
  autoMatchLimit = SKILL_AUTO_MATCH_LIMIT,
  manager = null,
} = {}) {
  const meta = createEmptyMeta();
  const skillManager = manager || {
    loadSkillCatalog,
    loadSkillBundle,
  };

  if (!enabled) {
    return {
      contextText: '',
      autoMatchedIds: [],
      selectedIds: normalizeIds(selectedIds),
      meta,
      catalog: Array.isArray(catalog) ? catalog : [],
      error: null,
    };
  }

  let availableCatalog = Array.isArray(catalog) ? catalog : [];
  if (availableCatalog.length === 0) {
    const catalogResult = await skillManager.loadSkillCatalog();
    availableCatalog = Array.isArray(catalogResult.catalog) ? catalogResult.catalog : [];
    if (catalogResult.error) {
      return {
        contextText: '',
        autoMatchedIds: [],
        selectedIds: normalizeIds(selectedIds),
        meta,
        catalog: availableCatalog,
        error: catalogResult.error,
      };
    }
    if (Array.isArray(catalogResult.warnings) && catalogResult.warnings.length) {
      meta.warnings.push(...catalogResult.warnings);
    }
  }

  const catalogIdSet = new Set(availableCatalog.map((entry) => String(entry?.id || '').trim()).filter(Boolean));
  const manualSelectedIds = normalizeIds(selectedIds).filter((id) => catalogIdSet.has(id));
  const autoMatchedIds = selectAutoMatchedSkillIds({
    catalog: availableCatalog,
    instruction,
    limit: autoMatchLimit,
  }).filter((id) => !manualSelectedIds.includes(id));

  const orderedIds = [...manualSelectedIds, ...autoMatchedIds];
  if (orderedIds.length === 0) {
    return {
      contextText: '',
      autoMatchedIds,
      selectedIds: manualSelectedIds,
      meta,
      catalog: availableCatalog,
      error: null,
    };
  }

  const blocks = [];
  let usedChars = 0;

  for (const skillId of orderedIds) {
    if (usedChars >= totalMaxChars) {
      meta.ignored.push({
        type: 'skill',
        skillId,
        reason: 'context_budget',
        detail: 'Total skill context budget exceeded',
      });
      continue;
    }

    const bundle = await skillManager.loadSkillBundle(skillId);
    if (bundle.error || !bundle.skill) {
      meta.ignored.push({
        type: 'skill',
        skillId,
        reason: 'skill_load_failed',
        detail: bundle.error || 'Skill bundle not available',
      });
      continue;
    }

    if (Array.isArray(bundle.warnings) && bundle.warnings.length) {
      meta.warnings.push(...bundle.warnings);
    }

    if (Array.isArray(bundle.ignored) && bundle.ignored.length) {
      bundle.ignored.forEach((item) => {
        meta.ignored.push({
          type: 'reference',
          skillId,
          ...item,
        });
      });
    }

    const skillHeader = `## Skill · ${bundle.skill.name || skillId} (${skillId})`;
    const skillDescription = bundle.skill.description ? `> ${bundle.skill.description}` : '';
    const sectionPrefix = [skillHeader, skillDescription].filter(Boolean).join('\n');

    const budgetAfterPrefix = totalMaxChars - usedChars - sectionPrefix.length - 2;
    if (budgetAfterPrefix <= 0) {
      meta.ignored.push({
        type: 'skill',
        skillId,
        reason: 'context_budget',
        detail: 'No remaining budget for skill content',
      });
      continue;
    }

    const mainFit = fitSkillMainContent(bundle.skill.content, budgetAfterPrefix);
    if (!mainFit.content) {
      meta.ignored.push({
        type: 'skill',
        skillId,
        reason: 'context_budget',
        detail: 'No remaining budget for skill body',
      });
      continue;
    }

    const mainSection = [sectionPrefix, mainFit.content].join('\n\n').trim();
    appendBlock(blocks, mainSection);
    usedChars += mainSection.length;
    meta.loadedSkillIds.push(skillId);

    if (bundle.skill.truncated || mainFit.truncated || mainFit.removedSections.length > 0) {
      meta.truncated.push({
        type: 'skill',
        skillId,
        reason: mainFit.removedSections.length > 0 ? 'low_priority_section_pruned' : 'skill_content_truncated',
        originalChars: Math.max(bundle.skill.originalChars || 0, mainFit.originalChars),
        usedChars: mainFit.usedChars,
        removedSections: mainFit.removedSections,
      });
    }

    const references = Array.isArray(bundle.references) ? bundle.references : [];
    for (const ref of references) {
      const refPath = String(ref?.path || '').trim();
      if (!refPath) continue;

      const remaining = totalMaxChars - usedChars;
      if (remaining <= 0) {
        meta.ignored.push({
          type: 'reference',
          skillId,
          path: refPath,
          reason: 'context_budget',
          detail: 'No remaining budget for reference',
        });
        continue;
      }

      const referenceHeader = `### Reference · ${refPath}`;
      const budgetForReference = remaining - referenceHeader.length - 2;
      if (budgetForReference <= 0) {
        meta.ignored.push({
          type: 'reference',
          skillId,
          path: refPath,
          reason: 'context_budget',
          detail: 'No remaining budget for reference body',
        });
        continue;
      }

      const referenceFit = fitReferenceContent(ref.content, budgetForReference);
      if (!referenceFit.content) {
        meta.ignored.push({
          type: 'reference',
          skillId,
          path: refPath,
          reason: 'context_budget',
          detail: 'Reference content is empty after budget trim',
        });
        continue;
      }

      const referenceSection = `${referenceHeader}\n\n${referenceFit.content}`;
      appendBlock(blocks, referenceSection);
      usedChars += referenceSection.length;
      meta.loadedReferences.push({
        skillId,
        path: refPath,
        chars: referenceFit.usedChars,
        truncated: Boolean(ref.truncated || referenceFit.truncated),
      });

      if (ref.truncated || referenceFit.truncated) {
        meta.truncated.push({
          type: 'reference',
          skillId,
          path: refPath,
          reason: 'reference_content_truncated',
          originalChars: Math.max(ref.originalChars || 0, referenceFit.originalChars),
          usedChars: referenceFit.usedChars,
        });
      }
    }
  }

  const contextText = blocks.join('\n\n').trim();
  meta.totalChars = contextText.length;

  return {
    contextText,
    autoMatchedIds,
    selectedIds: manualSelectedIds,
    meta,
    catalog: availableCatalog,
    error: null,
  };
}

export default {
  createEmptySkillContextMeta,
  selectAutoMatchedSkillIds,
  buildSkillContext,
};
