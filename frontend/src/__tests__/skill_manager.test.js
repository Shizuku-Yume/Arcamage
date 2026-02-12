import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  loadSkillBundle,
  loadSkillCatalog,
  resetSkillManagerCache,
  setSkillFetcher,
} from '../agent/skill_manager.js';
import { SKILL_REPOSITORY_STORAGE_KEY, SKILL_STORAGE_KEY } from '../agent/skill_constants.js';

function createMockFetcher(fileMap) {
  return vi.fn(async (url) => {
    if (!Object.prototype.hasOwnProperty.call(fileMap, url)) {
      return {
        ok: false,
        status: 404,
        text: async () => '',
      };
    }
    return {
      ok: true,
      status: 200,
      text: async () => fileMap[url],
    };
  });
}

describe('skill_manager', () => {
  beforeEach(() => {
    resetSkillManagerCache();
    localStorage.removeItem(SKILL_REPOSITORY_STORAGE_KEY);
    localStorage.removeItem(SKILL_STORAGE_KEY);
  });

  afterEach(() => {
    setSkillFetcher(null);
  });

  it('loads catalog and skill bundle with references', async () => {
    const fetcher = createMockFetcher({
      '/agent-skills/SKILLS.md': `- id: Demo\n  description: Demo desc\n  path: Demo/SKILL.md`,
      '/agent-skills/Demo/SKILL.md': `---\nname: Demo\ndescription: Demo desc\nreferences:\n  - references/a.md\n---\n\nBody`,
      '/agent-skills/Demo/references/a.md': 'Ref body',
    });
    setSkillFetcher(fetcher);

    const catalog = await loadSkillCatalog();
    expect(catalog.error).toBeNull();
    expect(catalog.catalog).toHaveLength(1);
    expect(catalog.catalog[0].id).toBe('Demo');

    const bundle = await loadSkillBundle('Demo');
    expect(bundle.error).toBeNull();
    expect(bundle.skill?.name).toBe('Demo');
    expect(bundle.references).toHaveLength(1);
    expect(bundle.references[0].path).toBe('Demo/references/a.md');
  });

  it('rejects invalid reference paths and keeps flow alive', async () => {
    const fetcher = createMockFetcher({
      '/agent-skills/SKILLS.md': `- id: Demo\n  description: Demo desc\n  path: Demo/SKILL.md`,
      '/agent-skills/Demo/SKILL.md': `---\nname: Demo\ndescription: Demo desc\nreferences:\n  - ../secrets.md\n  - https://example.com/remote.md\n  - references/ok.md\n---\n\nBody`,
      '/agent-skills/Demo/references/ok.md': 'OK ref',
    });
    setSkillFetcher(fetcher);

    const bundle = await loadSkillBundle('Demo');
    expect(bundle.error).toBeNull();
    expect(bundle.references).toHaveLength(1);
    expect(bundle.references[0].path).toBe('Demo/references/ok.md');
    expect(bundle.ignored.length).toBe(2);
    expect(bundle.ignored.every((item) => item.reason === 'invalid_reference_path')).toBe(true);
  });

  it('deduplicates repeated references', async () => {
    const fetcher = createMockFetcher({
      '/agent-skills/SKILLS.md': `- id: Demo\n  description: Demo desc\n  path: Demo/SKILL.md`,
      '/agent-skills/Demo/SKILL.md': `---\nname: Demo\ndescription: Demo desc\nreferences:\n  - references/a.md\n  - references/a.md\n---\n\nBody`,
      '/agent-skills/Demo/references/a.md': 'Ref body',
    });
    setSkillFetcher(fetcher);

    const bundle = await loadSkillBundle('Demo');
    expect(bundle.error).toBeNull();
    expect(bundle.references).toHaveLength(1);
    expect(bundle.ignored.some((item) => item.reason === 'duplicate_reference')).toBe(true);
  });

  it('surfaces explicit error when markdown request returns html fallback', async () => {
    const fetcher = createMockFetcher({
      '/agent-skills/SKILLS.md': '<!doctype html><html><head><title>Arcamage</title></head><body>app</body></html>',
    });
    setSkillFetcher(fetcher);

    const catalog = await loadSkillCatalog({ forceRefresh: true });
    expect(catalog.catalog).toHaveLength(0);
    expect(catalog.error).toContain('Expected markdown but received HTML fallback');
  });
});
