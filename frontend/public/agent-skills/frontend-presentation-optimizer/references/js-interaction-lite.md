# js-interaction-lite

仅用于“轻交互”场景。默认不加 JS，用户明确要求再用。

## Interaction 1: Disclosure Toggle

```html
<button class="rp-toggle" type="button" data-target="rp-extra-1">展开额外线索</button>
<div id="rp-extra-1" hidden>
  [可选补充内容]
</div>

<script>
(() => {
  const btn = document.querySelector('.rp-toggle');
  const panel = document.getElementById(btn?.dataset?.target || '');
  if (!btn || !panel) return;
  btn.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    btn.textContent = panel.hidden ? '展开额外线索' : '收起额外线索';
  });
})();
</script>
```

## Interaction 2: Tab Switch (2 panels)

```html
<div class="rp-tabs" data-tabs>
  <button data-tab="scene">场景</button>
  <button data-tab="intel">情报</button>
  <section data-panel="scene">[场景正文]</section>
  <section data-panel="intel" hidden>[情报正文]</section>
</div>

<script>
(() => {
  const root = document.querySelector('[data-tabs]');
  if (!root) return;
  root.querySelectorAll('[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.getAttribute('data-tab');
      root.querySelectorAll('[data-panel]').forEach((panel) => {
        panel.hidden = panel.getAttribute('data-panel') !== key;
      });
    });
  });
})();
</script>
```

## Guardrails

- 不要访问远程资源。
- 不要使用 `eval/new Function`。
- 不要注册全局高频监听（如 `mousemove` 连续计算）。
- 脚本需包在 IIFE 内，避免污染全局变量。
