import { describe, expect, it } from 'vitest';

import { parseSkillCatalog, parseSkillDocument } from '../agent/skill_parser.js';

describe('skill_parser', () => {
  it('parses SKILL.md frontmatter and body', () => {
    const raw = `---
name: Demo Skill
description: Demo description
references:
  - references/a.md
  - references/b.md
---

## When to use

Use this for demo.
`;

    const parsed = parseSkillDocument(raw);
    expect(parsed.name).toBe('Demo Skill');
    expect(parsed.description).toBe('Demo description');
    expect(parsed.references).toEqual(['references/a.md', 'references/b.md']);
    expect(parsed.body).toContain('## When to use');
    expect(parsed.warnings).toHaveLength(0);
  });

  it('parses catalog markdown list entries', () => {
    const raw = `- id: alpha
  description: Alpha desc
  path: alpha/SKILL.md
  tags: [a, b]

- id: beta
  description: Beta desc
  path: beta/SKILL.md
`;

    const parsed = parseSkillCatalog(raw);
    expect(parsed.entries).toHaveLength(2);
    expect(parsed.entries[0]).toEqual({
      id: 'alpha',
      description: 'Alpha desc',
      path: 'alpha/SKILL.md',
      tags: ['a', 'b'],
    });
    expect(parsed.entries[1].id).toBe('beta');
  });

  it('drops duplicate catalog ids with warning', () => {
    const raw = `- id: alpha
  description: Alpha desc
  path: alpha/SKILL.md

- id: alpha
  description: Alpha desc 2
  path: alpha2/SKILL.md
`;

    const parsed = parseSkillCatalog(raw);
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.entries[0].path).toBe('alpha/SKILL.md');
    expect(parsed.warnings.some((item) => item.code === 'W_SKILL_CATALOG_DUPLICATE')).toBe(true);
  });
});
