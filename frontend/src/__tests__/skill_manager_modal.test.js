import { describe, expect, it, vi } from 'vitest';
import Alpine from 'alpinejs';

import { __skillManagerModalTesting, skillManagerModal } from '../components/skill_manager_modal.js';

describe('skill manager modal helpers', () => {
  it('validates identifiers and normalizes markdown paths', () => {
    const {
      isValidSkillIdentifier,
      normalizeSkillEditorPath,
      buildSkillPathById,
    } = __skillManagerModalTesting;

    expect(isValidSkillIdentifier('写作 助手')).toBe(true);
    expect(isValidSkillIdentifier('frontend-presentation-optimizer')).toBe(true);
    expect(isValidSkillIdentifier('bad/id')).toBe(false);

    expect(normalizeSkillEditorPath('./demo/references/a.md')).toBe('demo/references/a.md');
    expect(normalizeSkillEditorPath('../secret.md')).toBe('');
    expect(normalizeSkillEditorPath('https://example.com/a.md')).toBe('');
    expect(buildSkillPathById('写作 助手')).toBe('写作 助手/SKILL.md');
  });

  it('keeps reference edits buffered while switching files until apply', () => {
    const { createSkillReferenceDraft } = __skillManagerModalTesting;
    Alpine.store('toast', { success: vi.fn(), error: vi.fn(), show: vi.fn() });
    Alpine.store('modalStack', { pop: vi.fn() });

    const modal = skillManagerModal({ id: 'skill-modal' });
    modal.skillEditorDraft = {
      id: 'demo-skill',
      sourcePath: 'demo-skill/SKILL.md',
      description: 'Demo skill',
      content: '## Body',
      references: [
        createSkillReferenceDraft('alpha', '# alpha\n\nold alpha'),
        createSkillReferenceDraft('beta', '# beta\n\nold beta'),
      ],
    };
    modal.skillManagerSelectedId = 'demo-skill';

    modal.goToEditReference(0);
    modal.selectedSkillReferenceDraft.content = '# alpha\n\nnew alpha';
    modal.selectSkillReferenceDraft(1);
    modal.selectedSkillReferenceDraft.content = '# beta\n\nnew beta';
    modal.activeScreen = 'edit-skill';

    expect(modal.skillEditorDraft.references[0].content).toContain('old alpha');
    expect(modal.skillEditorReferenceItems[1].content).toContain('new beta');

    const preparedReferences = modal.prepareSkillReferenceDraftsForSave();

    expect(preparedReferences).toHaveLength(2);
    expect(modal.skillEditorDraft.references[0].content).toContain('new alpha');
    expect(modal.skillEditorDraft.references[1].content).toContain('new beta');
    expect(modal.activeScreen).toBe('edit-skill');
  });

  it('tracks skill draft dirtiness and discards edits when returning is abandoned', async () => {
    const { createSkillReferenceDraft } = __skillManagerModalTesting;
    const confirmSaveBeforeExit = vi.fn().mockResolvedValue(false);
    Alpine.store('toast', { success: vi.fn(), error: vi.fn(), show: vi.fn() });
    Alpine.store('modalStack', { pop: vi.fn(), confirmSaveBeforeExit });

    const modalConfig = { id: 'skill-modal', dirty: false };
    const modal = skillManagerModal(modalConfig);
    modal.activeScreen = 'edit-skill';
    modal.skillEditorDraft = {
      id: 'demo-skill',
      sourcePath: 'demo-skill/SKILL.md',
      description: 'Demo skill',
      content: '## Body',
      references: [createSkillReferenceDraft('alpha', '# alpha')],
    };
    modal.skillManagerSelectedId = 'demo-skill';
    modal.markSkillEditorBaseline();

    expect(modal.isSkillManagerDirty).toBe(false);
    expect(modalConfig.dirty).toBe(false);

    modal.skillEditorDraft.description = 'Changed description';
    modal.syncModalDirty();

    expect(modal.isSkillManagerDirty).toBe(true);
    expect(modalConfig.dirty).toBe(true);

    const exited = await modal.requestGoToList();

    expect(exited).toBe(true);
    expect(confirmSaveBeforeExit).toHaveBeenCalled();
    expect(modal.activeScreen).toBe('list');
    expect(modalConfig.dirty).toBe(false);
  });

  it('saves dirty skill drafts before returning when confirmed', async () => {
    Alpine.store('toast', { success: vi.fn(), error: vi.fn(), show: vi.fn() });
    Alpine.store('modalStack', { pop: vi.fn(), confirmSaveBeforeExit: vi.fn().mockResolvedValue(true) });

    const modalConfig = { id: 'skill-modal', dirty: false };
    const modal = skillManagerModal(modalConfig);
    modal.activeScreen = 'edit-skill';
    modal.skillEditorDraft = {
      id: 'demo-skill',
      sourcePath: 'demo-skill/SKILL.md',
      description: 'Demo skill',
      content: '## Body',
      references: [],
    };
    modal.skillManagerSelectedId = 'demo-skill';
    modal.markSkillEditorBaseline();
    modal.skillEditorDraft.description = 'Changed description';
    modal.saveSkillManagerDraft = vi.fn().mockResolvedValue(true);

    const exited = await modal.requestGoToList();

    expect(exited).toBe(true);
    expect(modal.saveSkillManagerDraft).toHaveBeenCalledWith({ stayOnScreen: true });
    expect(modal.activeScreen).toBe('list');
  });

  it('keeps references relative and serializes skill markdown', () => {
    const {
      buildReferenceRelativePathFromName,
      getReferenceNameFromPath,
      resolveSkillReferencePath,
      ensureReferenceHeadingLine,
      serializeSkillDocumentMarkdown,
    } = __skillManagerModalTesting;

    const relativePath = buildReferenceRelativePathFromName('背景 设定');
    expect(relativePath).toBe('references/背景 设定.md');
    expect(getReferenceNameFromPath(relativePath)).toBe('背景 设定');
    expect(resolveSkillReferencePath('demo/SKILL.md', relativePath)).toBe('demo/references/背景 设定.md');
    expect(resolveSkillReferencePath('demo/SKILL.md', '../bad.md')).toBe('');

    expect(ensureReferenceHeadingLine('macro-integrity', '# old-title\n\nbody')).toBe('# macro-integrity\n\nbody');

    const markdown = serializeSkillDocumentMarkdown({
      name: '写作助手',
      description: 'Skill description',
      content: '## Body\n\nhello',
      references: [relativePath],
    });

    expect(markdown).toContain('name: 写作助手');
    expect(markdown).toContain('description: Skill description');
    expect(markdown).toContain('- references/背景 设定.md');
    expect(markdown).toContain('## Body');
  });
});
