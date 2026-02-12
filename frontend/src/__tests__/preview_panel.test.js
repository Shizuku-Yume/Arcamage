import { describe, expect, it } from 'vitest';

import { generateIframeContent, renderContent } from '../components/preview_panel.js';

describe('preview panel rendering', () => {
  it('renders markdown in markdown mode', () => {
    const html = renderContent('**hello**', { markdown: true });
    expect(html).toContain('<strong>hello</strong>');
  });

  it('preserves line breaks in plain text mode', () => {
    const html = renderContent('line-1\nline-2', { markdown: false });
    expect(html).toContain('line-1<br>line-2');
  });

  it('preserves safe styles and semantic html from full documents', () => {
    const srcdoc = generateIframeContent(
      `<!DOCTYPE html>
      <html>
        <head>
          <style>
            .vn-panel { color: red; }
            @import url('https://example.com/evil.css');
            .bad { background: url(javascript:alert(1)); }
          </style>
        </head>
        <body class="vn-root">
          <details open>
            <summary>面板标题</summary>
            <div class="vn-panel">内容</div>
          </details>
        </body>
      </html>`,
      { markdown: true, darkMode: false }
    );

    expect(srcdoc).toContain('class="vn-root"');
    expect(srcdoc).toContain('.vn-panel { color: red; }');
    expect(srcdoc).toContain('<details');
    expect(srcdoc).toContain('<summary>面板标题</summary>');
    expect(srcdoc).not.toContain('@import');
    expect(srcdoc).not.toContain('javascript:alert');
  });

  it('removes scripts and event handlers from html content', () => {
    const srcdoc = generateIframeContent(
      '<div onclick="alert(1)">hello</div><script>alert(1)</script>',
      { markdown: false, darkMode: false }
    );

    expect(srcdoc).toContain('<div>hello</div>');
    expect(srcdoc).not.toContain('onclick=');
    expect(srcdoc).not.toContain('<script');
  });

  it('renders first_mes native DSL blocks with dialogue and choices', () => {
    const srcdoc = generateIframeContent(
      `<game_response>
旁白||这是旁白
莉莉亚|常服|欢迎你[action|莉莉亚|jump]
[choice|选项A|选项B]
</game_response>
<UpdateVariable>_.set('foo','bar')</UpdateVariable>`,
      { mode: 'first_mes_native', markdown: true, darkMode: false }
    );

    expect(srcdoc).toContain('st-first-mes');
    expect(srcdoc).toContain('st-dialogue-row');
    expect(srcdoc).toContain('st-choice-option');
    expect(srcdoc).toContain('已隐藏 1 段 UpdateVariable 逻辑块');
  });

  it('applies regex scripts and macro expansion in native mode', () => {
    const srcdoc = generateIframeContent(
      '<game_response>旁白||Hello {{user}}</game_response>',
      {
        mode: 'first_mes_native',
        markdown: true,
        darkMode: false,
        expandMacros: true,
        macroContext: { user: 'Shizuku', char: '异世界和平' },
        applyRegexScripts: true,
        regexScripts: [
          {
            scriptName: 'replace-hello',
            disabled: false,
            promptOnly: false,
            markdownOnly: true,
            findRegex: 'Hello',
            replaceString: 'Hi',
          },
        ],
      }
    );

    expect(srcdoc).toContain('Hi Shizuku');
  });

  it('uses default user placeholder for both user and char macros', () => {
    const srcdoc = generateIframeContent(
      '<game_response>旁白||{{user}} 与 {{char}}</game_response>',
      {
        mode: 'first_mes_native',
        markdown: true,
        darkMode: false,
        expandMacros: true,
      }
    );

    expect(srcdoc).toContain('user 与 user');
  });

  it('keeps script tags when unsafe script mode is enabled', () => {
    const srcdoc = generateIframeContent(
      '<body><script>window.__cfPreview = 1;</script><div>unsafe</div></body>',
      { markdown: false, darkMode: false, allowScripts: true }
    );

    expect(srcdoc).toContain('<script>window.__cfPreview = 1;</script>');
  });

  it('falls back to html rendering for native mode html fragments', () => {
    const srcdoc = generateIframeContent(
      '<div class="vn-panel-container">面板正文</div><style>.vn-panel-container{color:#fff}</style>',
      { mode: 'first_mes_native', markdown: true, darkMode: false, allowScripts: true }
    );

    expect(srcdoc).toContain('class="vn-panel-container"');
    expect(srcdoc).toContain('data-preview-style="0"');
    expect(srcdoc).not.toContain('<div class="st-first-mes">');
  });

  it('renders multiline html fragment in native mode without escaping', () => {
    const srcdoc = generateIframeContent(
      `<div style="display: flex; gap: 10px;">
  <img src="https://z.wiki/u/zWp6j8" alt="Assistant Avatar">
  <div style="max-height:120px; overflow-y:auto;">{{user}}是教导处主任<br>我是您的助理</div>
</div>`,
      {
        mode: 'first_mes_native',
        markdown: true,
        darkMode: false,
        allowScripts: true,
        expandMacros: true,
      }
    );

    expect(srcdoc).toContain('src="https://z.wiki/u/zWp6j8"');
    expect(srcdoc).toContain('user是教导处主任');
    expect(srcdoc).not.toContain('&lt;div style=');
    expect(srcdoc).not.toContain('<div class="st-first-mes">');
  });

  it('keeps native dsl path when dialogue lines include html tags', () => {
    const srcdoc = generateIframeContent(
      '<game_response>旁白||这是 <b>强调</b> 文本</game_response>',
      { mode: 'first_mes_native', markdown: true, darkMode: false, allowScripts: true }
    );

    expect(srcdoc).toContain('<div class="st-first-mes">');
    expect(srcdoc).toContain('<b>强调</b>');
  });

  it('uses safe html fallback in native mode when scripts are disabled', () => {
    const srcdoc = generateIframeContent(
      '<div class="vn-panel-container">安全面板</div><style>.vn-panel-container{color:#fff}</style><script>window.__cf=1;</script>',
      { mode: 'first_mes_native', markdown: true, darkMode: false, allowScripts: false }
    );

    expect(srcdoc).toContain('class="vn-panel-container"');
    expect(srcdoc).toContain('data-preview-style="0"');
    expect(srcdoc).not.toContain('<script>window.__cf=1;</script>');
    expect(srcdoc).not.toContain('<div class="st-first-mes">');
  });
});
