import { beforeEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';

import {
  SKILL_REPOSITORY_STORAGE_KEY,
  SKILL_STORAGE_KEY,
} from '../agent/skill_constants.js';
import {
  buildDefaultSkillMarkdown,
  createSkillEntry,
  deleteSkillEntry,
  exportSkillRepositoryState,
  exportSkillTransferFile,
  importSkillTransferFile,
  importSkillRepositoryState,
  loadSkillCatalog,
  readSkillMarkdown,
  resetSkillManagerCache,
  setSkillFetcher,
  writeSkillMarkdown,
} from '../agent/skill_manager.js';

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

function readBlobAsText(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read blob as text'));
    reader.onload = () => resolve(String(reader.result || ''));
    reader.readAsText(blob);
  });
}

function readBlobAsArrayBuffer(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read blob as arrayBuffer'));
    reader.onload = () => resolve(reader.result);
    reader.readAsArrayBuffer(blob);
  });
}

describe('skill_manager local repository mutations', () => {
  beforeEach(() => {
    localStorage.removeItem(SKILL_REPOSITORY_STORAGE_KEY);
    localStorage.removeItem(SKILL_STORAGE_KEY);
    setSkillFetcher(null);
    resetSkillManagerCache();
  });

  it('creates, edits and deletes local skill entries', async () => {
    setSkillFetcher(createMockFetcher({
      '/agent-skills/SKILLS.md': '',
    }));

    await createSkillEntry({
      id: 'demo-local',
      description: 'Local skill description',
    });

    let catalog = await loadSkillCatalog({ forceRefresh: true });
    expect(catalog.error).toBeNull();
    expect(catalog.catalog.some((item) => item.id === 'demo-local')).toBe(true);

    const file = await readSkillMarkdown('demo-local/SKILL.md');
    expect(file.content).toContain('## When to use');

    await writeSkillMarkdown('demo-local/SKILL.md', '# Updated\n\ncontent');
    const updated = await readSkillMarkdown('demo-local/SKILL.md');
    expect(updated.content).toBe('# Updated\n\ncontent');

    await deleteSkillEntry('demo-local');
    catalog = await loadSkillCatalog({ forceRefresh: true });
    expect(catalog.catalog.some((item) => item.id === 'demo-local')).toBe(false);
  });

  it('writing SKILLS.md updates catalog in local repository', async () => {
    setSkillFetcher(createMockFetcher({
      '/agent-skills/SKILLS.md': '',
    }));

    await writeSkillMarkdown('SKILLS.md', `- id: alpha\n  description: Alpha desc\n  path: alpha/SKILL.md\n`);

    const catalog = await loadSkillCatalog({ forceRefresh: true });
    expect(catalog.catalog).toHaveLength(1);
    expect(catalog.catalog[0].id).toBe('alpha');
  });

  it('persists repository to localStorage', async () => {
    setSkillFetcher(createMockFetcher({
      '/agent-skills/SKILLS.md': '',
    }));

    await createSkillEntry({
      id: 'persisted',
      description: 'Persist me',
      content: '# Persisted',
    });

    const raw = localStorage.getItem(SKILL_REPOSITORY_STORAGE_KEY);
    expect(typeof raw).toBe('string');
    const parsed = JSON.parse(raw || '{}');
    expect(Array.isArray(parsed.catalog)).toBe(true);
    expect(parsed.catalog.some((item) => item.id === 'persisted')).toBe(true);
    expect(parsed.files['persisted/SKILL.md']).toBe('# Persisted');
  });

  it('reloads repository from localStorage without static bootstrap', async () => {
    setSkillFetcher(createMockFetcher({
      '/agent-skills/SKILLS.md': '',
    }));

    await createSkillEntry({
      id: 'reload-demo',
      description: 'Reload from local storage',
      content: '# Reload\n\nfrom local',
    });

    resetSkillManagerCache();
    setSkillFetcher(createMockFetcher({}));

    const catalog = await loadSkillCatalog({ forceRefresh: true });
    expect(catalog.error).toBeNull();
    expect(catalog.catalog.some((item) => item.id === 'reload-demo')).toBe(true);

    const file = await readSkillMarkdown('reload-demo/SKILL.md');
    expect(file.content).toBe('# Reload\n\nfrom local');
  });

  it('builds deterministic default markdown template', () => {
    const template = buildDefaultSkillMarkdown({ name: 'X', description: 'Y' });
    expect(template).toContain('name: X');
    expect(template).toContain('description: Y');
    expect(template).toContain('## Must not do');
  });

  it('exports and imports repository snapshots atomically', async () => {
    setSkillFetcher(createMockFetcher({
      '/agent-skills/SKILLS.md': '',
    }));

    await createSkillEntry({
      id: 'snapshot-demo',
      description: 'Before import',
      content: '# Snapshot',
    });

    const snapshot = await exportSkillRepositoryState();
    snapshot.catalog[0].description = 'Snapshot Imported';
    snapshot.files['snapshot-demo/SKILL.md'] = '# Imported';

    importSkillRepositoryState(snapshot);

    let catalog = await loadSkillCatalog({ forceRefresh: true });
    expect(catalog.catalog[0].description).toBe('Snapshot Imported');

    const file = await readSkillMarkdown('snapshot-demo/SKILL.md');
    expect(file.content).toBe('# Imported');

    snapshot.catalog[0].description = 'Mutated After Import';
    catalog = await loadSkillCatalog({ forceRefresh: true });
    expect(catalog.catalog[0].description).toBe('Snapshot Imported');

    const raw = localStorage.getItem(SKILL_REPOSITORY_STORAGE_KEY);
    const parsed = JSON.parse(raw || '{}');
    expect(parsed.catalog[0].description).toBe('Snapshot Imported');
  });

  it('rejects invalid snapshot paths during import', () => {
    expect(() => importSkillRepositoryState({
      catalog: [],
      files: {
        '../escape.md': 'bad',
      },
    })).toThrow();
  });

  it('exports single skill as markdown when no references exist', async () => {
    setSkillFetcher(createMockFetcher({
      '/agent-skills/SKILLS.md': '',
    }));

    await createSkillEntry({
      id: 'plain-export',
      description: 'No references',
      content: `---\nname: plain-export\ndescription: Plain export\nreferences: []\n---\n\n## Body\n\nNo refs`,
    });

    const exported = await exportSkillTransferFile('plain-export');
    expect(exported.format).toBe('markdown');
    expect(exported.fileName).toBe('plain-export.md');
    expect(exported.referencesCount).toBe(0);

    const markdown = await readBlobAsText(exported.blob);
    expect(markdown).toContain('name: plain-export');
    expect(markdown).toContain('## Body');
  });

  it('exports skill as zip when references are present', async () => {
    setSkillFetcher(createMockFetcher({
      '/agent-skills/SKILLS.md': '',
    }));

    await createSkillEntry({
      id: 'zip-export',
      description: 'Zip export',
      content: `---\nname: zip-export\ndescription: Zip export\nreferences:\n  - references/checklist.md\n---\n\n## Body`,
    });
    await writeSkillMarkdown('zip-export/references/checklist.md', '# Checklist\n\n- keep format');

    const exported = await exportSkillTransferFile('zip-export');
    expect(exported.format).toBe('zip');
    expect(exported.fileName).toBe('zip-export.zip');
    expect(exported.referencesCount).toBe(1);

    const zip = await JSZip.loadAsync(await readBlobAsArrayBuffer(exported.blob));
    const skillContent = await zip.file('zip-export/SKILL.md')?.async('string');
    const refContent = await zip.file('zip-export/references/checklist.md')?.async('string');
    expect(skillContent).toContain('references/checklist.md');
    expect(refContent).toContain('Checklist');
  });

  it('imports markdown skill transfer file into repository', async () => {
    setSkillFetcher(createMockFetcher({
      '/agent-skills/SKILLS.md': '',
    }));

    const file = new File([
      `---\nname: md-import\ndescription: Imported from markdown\nreferences: []\n---\n\n## Must do\n\n- keep structure`,
    ], 'md-import.md', { type: 'text/markdown' });

    const imported = await importSkillTransferFile(file);
    expect(imported.skillId).toBe('md-import');
    expect(imported.referencesCount).toBe(0);
    expect(imported.replaced).toBe(false);

    const catalog = await loadSkillCatalog({ forceRefresh: true });
    expect(catalog.catalog.some((entry) => entry.id === 'md-import')).toBe(true);

    const saved = await readSkillMarkdown('md-import/SKILL.md');
    expect(saved.content).toContain('name: md-import');
    expect(saved.content).toContain('Imported from markdown');
  });

  it('imports zip transfer and overwrites existing skill content', async () => {
    setSkillFetcher(createMockFetcher({
      '/agent-skills/SKILLS.md': '',
    }));

    await createSkillEntry({
      id: 'zip-import',
      description: 'Old description',
      content: `---\nname: zip-import\ndescription: Old description\nreferences: []\n---\n\nOld`,
    });

    const zip = new JSZip();
    zip.file('zip-import/SKILL.md', `---\nname: zip-import\ndescription: Imported zip\n---\n\n## New Body`);
    zip.file('zip-import/references/guide.md', '# Guide\n\nFrom zip package');
    const zipBlob = await zip.generateAsync({ type: 'blob' });
    const file = new File([zipBlob], 'zip-import.zip', { type: 'application/zip' });

    const imported = await importSkillTransferFile(file);
    expect(imported.skillId).toBe('zip-import');
    expect(imported.referencesCount).toBe(1);
    expect(imported.replaced).toBe(true);

    const savedSkill = await readSkillMarkdown('zip-import/SKILL.md');
    expect(savedSkill.content).toContain('description: Imported zip');
    expect(savedSkill.content).toContain('references/guide.md');

    const savedRef = await readSkillMarkdown('zip-import/references/guide.md');
    expect(savedRef.content).toContain('From zip package');
  });
});
