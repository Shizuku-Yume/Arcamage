import { describe, expect, it } from 'vitest';

import { formatDiffLabel, splitDiffLines } from '../components/agent_diff.js';

describe('agent_diff formatDiffLabel', () => {
  it('adds array index suffix for alternate greetings', () => {
    expect(formatDiffLabel('set', 'data.alternate_greetings[0]')).toBe('修改 备选开场白 #1');
  });

  it('adds array index suffix for group-only greetings', () => {
    expect(formatDiffLabel('remove', 'data.group_only_greetings[3]')).toBe('删除 群聊开场白 #4');
  });
});

describe('agent_diff splitDiffLines', () => {
  it('treats empty content as zero lines', () => {
    expect(splitDiffLines('')).toEqual([]);
    expect(splitDiffLines(null)).toEqual([]);
  });

  it('converts escaped line breaks to real lines', () => {
    expect(splitDiffLines('line-1\\nline-2\\r\\nline-3')).toEqual(['line-1', 'line-2', 'line-3']);
  });

  it('preserves explicit blank lines in non-empty content', () => {
    expect(splitDiffLines('<START>\n\n{{user}}')).toEqual(['<START>', '', '{{user}}']);
  });
});
