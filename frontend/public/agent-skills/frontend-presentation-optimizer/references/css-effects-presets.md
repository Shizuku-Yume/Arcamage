# css-effects-presets

可复用的轻量视觉特效片段。默认只选 1-2 个，不叠满。

## Preset 1: Gradient Title

```css
.fx-gradient-title {
  background: linear-gradient(90deg, #a78bfa, #22d3ee 55%, #34d399);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  font-weight: 700;
}
```

## Preset 2: Soft Glow Card

```css
.fx-glow-card {
  border-radius: 14px;
  border: 1px solid rgba(255,255,255,.14);
  box-shadow: 0 0 0 1px rgba(255,255,255,.04) inset, 0 10px 28px rgba(0,0,0,.25);
  background: radial-gradient(circle at top right, rgba(167,139,250,.12), rgba(0,0,0,.1) 60%);
}
```

## Preset 3: Gentle Fade-in

```css
@keyframes fx-fade-up {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}
.fx-fade-up {
  animation: fx-fade-up .35s ease-out both;
}
```

## Preset 4: Typing Cursor (Pseudo)

```css
.fx-typing::after {
  content: '▍';
  margin-left: 2px;
  opacity: .65;
  animation: fx-blink 1s steps(1) infinite;
}
@keyframes fx-blink { 50% { opacity: .15; } }
```

## Usage Rules

- 动效总时长控制在 300-600ms。
- 避免无限循环动画，除非是极低频率的提示型动画。
- 使用语义类名（`fx-*`），避免污染业务类。
- 给无动画环境提供正常静态可读样式。
