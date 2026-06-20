# interaction-and-safety

可选的轻量交互件 + 输出前的安全/可读性检查清单。交互默认不加,用户明确要求再用。

## 交互件 1:折叠展开(免 JS,首选)

`<details>` 原生可折叠,兼容性最好、最稳。能用它就别写 JS。

```html
<details class="rp-fold">
  <summary>展开额外线索</summary>
  <div>[可选补充内容,如背景、提示、分支]</div>
</details>

<style>
.rp-fold { border: 1px solid rgba(255,255,255,.16); border-radius: 8px; padding: 6px 12px; margin: 8px 0; }
.rp-fold > summary { cursor: pointer; font-weight: 600; }
.rp-fold > div { margin-top: 8px; line-height: 1.7; }
</style>
```

## 交互件 2:标签切换(需要 JS 时)

需要脚本交互时,脚本要包在 IIFE 里、用 `data-*` 选择器、不污染全局。

```html
<div class="rp-tabs" data-tabs>
  <button type="button" data-tab="scene">场景</button>
  <button type="button" data-tab="intel">情报</button>
  <section data-panel="scene">[场景正文]</section>
  <section data-panel="intel" hidden>[情报正文]</section>
</div>

<script>
(() => {
  const root = document.currentScript.previousElementSibling;
  if (!root || !root.matches('[data-tabs]')) return;
  root.querySelectorAll('[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.getAttribute('data-tab');
      root.querySelectorAll('[data-panel]').forEach((p) => {
        p.hidden = p.getAttribute('data-panel') !== key;
      });
    });
  });
})();
</script>
```

## 交互件 3:掷骰按钮

```html
<button type="button" class="rp-roll">🎲 掷骰 (d20)</button>
<span class="rp-roll-out"></span>

<script>
(() => {
  const btn = document.currentScript.previousElementSibling.previousElementSibling
    || document.querySelector('.rp-roll');
  const out = document.querySelector('.rp-roll-out');
  if (!btn || !out) return;
  btn.addEventListener('click', () => { out.textContent = ' → ' + (1 + Math.floor(Math.random() * 20)); });
})();
</script>
```

## 交互安全护栏

- 不访问远程资源(脚本、字体、图片、接口)。
- 不使用 `eval` / `new Function` 等动态执行。
- 不注册全局高频监听(如连续 `mousemove` 计算)。
- 脚本包在 IIFE 内,作用域限定在自己的容器,不污染全局变量。
- 选择器尽量局部(基于 `data-*` 或就近 DOM),避免 `querySelector` 命中页面其它楼层的同名元素。

## 输出前检查清单

- [ ] 宏变量完整保留(`{{user}}`、`{{char}}`、`{{roll}}` 等)。
- [ ] HTML 标签闭合完整,无错位嵌套。
- [ ] 样式/脚本作用域局部化(类名 `rp-*`/`fx-*`,脚本 IIFE)。
- [ ] 无外链依赖、无危险脚本模式。
- [ ] 动效不过量,信息密度优先于装饰密度。
- [ ] 去掉无意义空容器与重复样式。
- [ ] 配色质感与卡片主题一致,深色底文字对比度足够。

## 要避免的失败模式

- 视觉很炫但剧情零推进。
- 模板过重导致每轮回复又长又水。
- 为了视觉效果擅自改角色设定或世界观事实。
- 同一回复里叠多个复杂动画。
