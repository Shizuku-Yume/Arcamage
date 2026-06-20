# css-theming-presets

按「卡片主题」选配色与质感,而不是无脑套紫蓝渐变。先定主题盘,再去 `opening-visual-composer` / `status-panel-designer` 套组件。

## 按主题选盘

| 卡片主题 | 主色 | 辅色 | 质感关键词 |
| --- | --- | --- | --- |
| 暗黑奇幻 / 哥特 | `#7c3aed` 暗紫 | `#dc2626` 血红 | 深底、烫金边、暗角 |
| 赛博朋克 / 科技 | `#22d3ee` 青 | `#f472b6` 品红 | 霓虹、扫描线、等宽字 |
| 古风 / 武侠 | `#b45309` 褐金 | `#15803d` 竹青 | 宣纸、留白、衬线 |
| 治愈 / 日常 | `#fb7185` 樱粉 | `#38bdf8` 天蓝 | 低饱和、圆角、柔和阴影 |
| 末世 / 废土 | `#a16207` 锈黄 | `#57534e` 灰褐 | 做旧、噪点、低对比 |
| 校园 / 青春 | `#f59e0b` 暖橙 | `#3b82f6` 蓝 | 明亮、活泼、糖果色 |

> 选 1 主色 + 1 辅色就够;主色用于标题/进度条/强调,辅色用于次级点缀。

## 质感预设 1:渐变标题

```css
.fx-gradient-title {
  background: linear-gradient(90deg, #a78bfa, #22d3ee 55%, #34d399);
  -webkit-background-clip: text; background-clip: text;
  color: transparent; font-weight: 700;
}
```

## 质感预设 2:柔光卡片

```css
.fx-glow-card {
  border-radius: 14px; border: 1px solid rgba(255,255,255,.14);
  box-shadow: 0 0 0 1px rgba(255,255,255,.04) inset, 0 10px 28px rgba(0,0,0,.25);
  background: radial-gradient(circle at top right, rgba(167,139,250,.12), rgba(0,0,0,.1) 60%);
}
```

## 质感预设 3:宣纸/做旧底

```css
.fx-paper {
  background: #f5efe1; color: #3b2f1e; border: 1px solid #d8c9a8;
  border-radius: 6px; box-shadow: inset 0 0 40px rgba(120,90,40,.12);
}
```

## 动效预设 1:轻微淡入

```css
@keyframes fx-fade-up { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
.fx-fade-up { animation: fx-fade-up .35s ease-out both; }
```

## 动效预设 2:打字光标(伪元素)

```css
.fx-typing::after { content: '▍'; margin-left: 2px; opacity: .65; animation: fx-blink 1s steps(1) infinite; }
@keyframes fx-blink { 50% { opacity: .15; } }
```

## 用法规则

- 一次只挑 1-2 个特效,不要叠满。
- 单段动效时长 300-600ms;除非是极低频提示,否则避免无限循环动画。
- 类名用语义前缀(`rp-*` 业务结构、`fx-*` 纯特效),避免污染。
- 给无动画/不支持环境留正常静态可读样式(特效是增强,不是依赖)。
- 深色主题保证文字与背景对比度足够(正文不要低于浅灰 `#cbd5e1` 级别)。
