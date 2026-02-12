# opening-visual-composer

用于生成“有前端展示感”的开场白。目标是：先立氛围，再给信息，再落到角色语气。

## Pattern A: Cinematic Opening Shell

```html
<section class="rp-opening">
  <header class="rp-opening__title">[场景标题]</header>
  <p class="rp-opening__meta">时间：[time] · 地点：[location] · 氛围：[mood]</p>
  <p class="rp-opening__body">[2-4 句镜头化描述，避免堆砌形容词]</p>
  <p class="rp-opening__hook">[一句引导用户互动的问题或动作钩子]</p>
</section>
```

```css
.rp-opening {
  border: 1px solid rgba(255,255,255,.16);
  border-radius: 14px;
  padding: 14px 16px;
  background: linear-gradient(160deg, rgba(255,255,255,.08), rgba(255,255,255,.02));
  backdrop-filter: blur(2px);
}
.rp-opening__title {
  font-size: 1.02rem;
  font-weight: 700;
  letter-spacing: .04em;
  margin-bottom: 4px;
}
.rp-opening__meta {
  opacity: .72;
  font-size: .86rem;
  margin-bottom: 10px;
}
.rp-opening__body { line-height: 1.7; margin-bottom: 10px; }
.rp-opening__hook { font-weight: 600; }
```

## Pattern B: Compact Opening (Low-overhead)

```markdown
【[场景标题]】
`[time] · [location] · [mood]`

[2-3 句画面感描述]

**引导：** [一句可回应的问题或可执行动作]
```

## Composition Rules

- 首句给“镜头”而不是抽象评价。
- 细节优先级：空间 > 人物状态 > 当前冲突。
- 结尾必须给用户可接的互动钩子（问句/选择/动作点）。
- 一次开场最多使用一个主视觉容器，避免层层嵌套。
