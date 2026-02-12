import { describe, expect, it, vi } from 'vitest';

import { buildSkillContext, selectAutoMatchedSkillIds } from '../agent/skill_context.js';

describe('skill_context', () => {
  it('auto-matches skills by instruction keywords', () => {
    const catalog = [
      {
        id: 'knowledge-structuring',
        description: 'organize lorebook entries',
        tags: ['lorebook', 'structure'],
      },
      {
        id: 'prose-polish',
        description: 'improve writing tone',
        tags: ['writing'],
      },
    ];

    const matched = selectAutoMatchedSkillIds({
      catalog,
      instruction: '请帮我整理 lorebook 的结构和检索命中',
      limit: 2,
    });

    expect(matched).toContain('knowledge-structuring');
  });

  it('merges manual and auto selection in stable order', async () => {
    const catalog = [
      { id: 'manual-skill', description: 'manual', tags: [] },
      { id: 'auto-skill', description: 'auto skill', tags: ['auto'] },
    ];

    const manager = {
      loadSkillCatalog: vi.fn(async () => ({ catalog, warnings: [], error: null })),
      loadSkillBundle: vi.fn(async (skillId) => ({
        skill: {
          id: skillId,
          name: skillId,
          description: `${skillId} desc`,
          content: `content for ${skillId}`,
          truncated: false,
          originalChars: 20,
          usedChars: 20,
        },
        references: [],
        ignored: [],
        warnings: [],
        error: null,
      })),
    };

    const result = await buildSkillContext({
      instruction: 'please run auto skill for me',
      selectedIds: ['manual-skill'],
      catalog,
      manager,
      totalMaxChars: 4000,
    });

    expect(result.error).toBeNull();
    expect(result.meta.loadedSkillIds).toEqual(['manual-skill', 'auto-skill']);
    expect(result.contextText).toContain('manual-skill');
    expect(result.contextText).toContain('auto-skill');
  });

  it('records truncation and budget-based ignore', async () => {
    const catalog = [{ id: 'demo', description: 'demo', tags: [] }];
    const manager = {
      loadSkillCatalog: vi.fn(async () => ({ catalog, warnings: [], error: null })),
      loadSkillBundle: vi.fn(async () => ({
        skill: {
          id: 'demo',
          name: 'demo',
          description: 'demo',
          content: 'A'.repeat(120),
          truncated: false,
          originalChars: 120,
          usedChars: 120,
        },
        references: [{ path: 'demo/references/a.md', content: 'B'.repeat(120), truncated: false, originalChars: 120 }],
        ignored: [],
        warnings: [],
        error: null,
      })),
    };

    const result = await buildSkillContext({
      instruction: 'demo',
      selectedIds: ['demo'],
      catalog,
      manager,
      totalMaxChars: 120,
    });

    expect(result.error).toBeNull();
    expect(result.meta.truncated.length).toBeGreaterThan(0);
    expect(result.meta.ignored.some((item) => item.reason === 'context_budget')).toBe(true);
  });
});
