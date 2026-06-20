# status-panel-designer

用于设计「状态面板 / 状态栏」界面:HP、好感度、时间、金钱、属性、所持物、关系网等可视化数值。面板服务于玩法与代入,不要为了好看而塞满。

## 设计原则

- **只显示当前回合相关的数值**。把不变的设定丢进世界书,不要每轮重复渲染。
- **数值用宏/变量占位**,方便后续回复持续更新:如 `{{好感度}}`、`HP [hp]/100`。不要写死成剧透值。
- 配色取自卡片主题(见 `css-theming-presets`),不要无脑用紫蓝渐变。
- 面板一般放在回复**开头**(状态)或**结尾**(结算),不要把对白切碎。

## 组件 1:横向状态条(进度条)

适合 HP / MP / 好感 / 进度类连续数值。

```html
<div class="rp-stat">
  <div class="rp-stat__row">
    <span class="rp-stat__label">体力</span>
    <span class="rp-stat__num">[hp]/100</span>
  </div>
  <div class="rp-stat__track"><div class="rp-stat__fill" style="width:[hp]%"></div></div>
</div>

<style>
.rp-stat { margin: 6px 0; }
.rp-stat__row { display: flex; justify-content: space-between; font-size: .85rem; margin-bottom: 4px; }
.rp-stat__label { opacity: .8; }
.rp-stat__track { height: 8px; border-radius: 999px; background: rgba(255,255,255,.12); overflow: hidden; }
.rp-stat__fill { height: 100%; border-radius: 999px;
  background: linear-gradient(90deg, #f59e0b, #ef4444); transition: width .4s ease; }
</style>
```

> 改 `.rp-stat__fill` 的渐变色即可换主题:好感度用粉红、法力用蓝紫、理智用青绿。

## 组件 2:属性网格

适合一组离散属性(力量/敏捷/智力…)或物品栏。

```html
<div class="rp-grid">
  <div class="rp-grid__cell"><b>力量</b><span>[str]</span></div>
  <div class="rp-grid__cell"><b>敏捷</b><span>[dex]</span></div>
  <div class="rp-grid__cell"><b>智力</b><span>[int]</span></div>
  <div class="rp-grid__cell"><b>魅力</b><span>[cha]</span></div>
</div>

<style>
.rp-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; margin: 8px 0; }
.rp-grid__cell { display: flex; justify-content: space-between; padding: 6px 10px;
  border: 1px solid rgba(255,255,255,.14); border-radius: 8px; font-size: .88rem; }
.rp-grid__cell b { opacity: .8; font-weight: 600; }
</style>
```

## 组件 3:状态徽章行

适合状态效果 / 标签(中毒、增益、关系称谓等),轻量、单行。

```html
<div class="rp-badges">
  <span class="rp-badge rp-badge--good">专注</span>
  <span class="rp-badge rp-badge--warn">疲惫</span>
  <span class="rp-badge">同伴</span>
</div>

<style>
.rp-badges { display: flex; flex-wrap: wrap; gap: 6px; margin: 6px 0; }
.rp-badge { font-size: .78rem; padding: 2px 10px; border-radius: 999px;
  border: 1px solid rgba(255,255,255,.2); }
.rp-badge--good { background: rgba(52,211,153,.16); border-color: rgba(52,211,153,.4); }
.rp-badge--warn { background: rgba(245,158,11,.16); border-color: rgba(245,158,11,.4); }
</style>
```

## 组件 4:顶栏概览(时间 / 地点 / 金钱)

适合放在每轮开头的一行环境信息。

```html
<div class="rp-topbar">
  <span>🕓 [time]</span><span>📍 [location]</span><span>💰 [gold]</span>
</div>

<style>
.rp-topbar { display: flex; gap: 14px; flex-wrap: wrap; font-size: .82rem; opacity: .85;
  padding: 6px 10px; border-radius: 8px; background: rgba(255,255,255,.05); }
</style>
```

## 组合规则

- 一个面板里组件数 ≤ 3,先选最能驱动玩法的那一两个。
- 给每个数值一个语义,不要堆没人用的属性。
- 进度条 `width` 用百分比占位,方便后续回合更新。
- 若同一卡既有开场壳又有状态面板,让二者风格(圆角、边框、配色)统一。
