import { describe, expect, it } from 'vitest';

import { __agentModalTesting } from '../components/agent_modal.js';

describe('agent_modal skills manager helpers', () => {
  it('accepts multilingual identifiers and rejects special symbols', () => {
    const { isValidSkillIdentifier } = __agentModalTesting;
    expect(isValidSkillIdentifier('写作 助手')).toBe(true);
    expect(isValidSkillIdentifier('Greeting Helper 2')).toBe(true);
    expect(isValidSkillIdentifier('技能-ID_01')).toBe(true);

    expect(isValidSkillIdentifier('')).toBe(false);
    expect(isValidSkillIdentifier('bad/id')).toBe(false);
    expect(isValidSkillIdentifier('bad*id')).toBe(false);
  });

  it('normalizes markdown paths and rejects invalid paths', () => {
    const { normalizeSkillEditorPath } = __agentModalTesting;
    expect(normalizeSkillEditorPath('demo/SKILL.md')).toBe('demo/SKILL.md');
    expect(normalizeSkillEditorPath('./demo/references/a.md')).toBe('demo/references/a.md');
    expect(normalizeSkillEditorPath('../secret.md')).toBe('');
    expect(normalizeSkillEditorPath('https://example.com/a.md')).toBe('');
    expect(normalizeSkillEditorPath('demo/not-markdown.txt')).toBe('');
  });

  it('resolves references relative to skill file', () => {
    const {
      resolveSkillReferencePath,
      buildReferenceRelativePathFromName,
      getReferenceNameFromPath,
    } = __agentModalTesting;

    const relative = buildReferenceRelativePathFromName('背景 设定');
    expect(relative).toBe('references/背景 设定.md');
    expect(getReferenceNameFromPath(relative)).toBe('背景 设定');
    expect(resolveSkillReferencePath('demo/SKILL.md', relative)).toBe('demo/references/背景 设定.md');
    expect(resolveSkillReferencePath('demo/SKILL.md', '../references/a.md')).toBe('');
  });

  it('keeps reference first line synchronized with reference name', () => {
    const { ensureReferenceHeadingLine } = __agentModalTesting;

    expect(ensureReferenceHeadingLine('macro-integrity', 'body only')).toBe('# macro-integrity\n\nbody only');
    expect(ensureReferenceHeadingLine('macro-integrity', '# old-title\n\nrest body')).toBe('# macro-integrity\n\nrest body');
    expect(ensureReferenceHeadingLine('macro-integrity', '# macro-integrity\n')).toBe('# macro-integrity\n');
  });

  it('serializes catalog and skill markdown with frontmatter', () => {
    const {
      serializeSkillCatalogMarkdown,
      serializeSkillDocumentMarkdown,
      buildSkillPathById,
    } = __agentModalTesting;

    expect(buildSkillPathById('写作 助手')).toBe('写作 助手/SKILL.md');

    const catalog = serializeSkillCatalogMarkdown([
      {
        id: '写作 助手',
        description: 'Used for tests',
        path: 'should/be/ignored.md',
        tags: ['alpha'],
      },
    ]);
    expect(catalog).toContain('- id: 写作 助手');
    expect(catalog).toContain('path: 写作 助手/SKILL.md');

    const markdown = serializeSkillDocumentMarkdown({
      name: '写作助手',
      description: 'Skill description',
      content: '## Body\n\nhello',
      references: ['references/背景 设定.md'],
    });
    expect(markdown).toContain('name: 写作助手');
    expect(markdown).toContain('description: Skill description');
    expect(markdown).toContain('- references/背景 设定.md');
    expect(markdown).toContain('## Body');
  });
});
