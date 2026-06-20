# opening-visual-composer

用于设计「有前端展示感」的开场白。原则:先立氛围,再给信息,再落到角色语气与互动钩子。一次只用一个主视觉容器。

## 主题母题先行

动手前先回答三个问题,答案决定后面所有视觉选择:

- **色调**:这张卡的世界是冷的还是暖的?明亮还是幽暗?(赛博→霓虹冷色;古风→宣纸暖褐;治愈→低饱和柔色)
- **材质感**:玻璃拟态 / 纸张 / 金属 / 数据终端 / 羊皮卷?
- **信息密度**:严肃叙事卡宜留白,游戏化卡可上面板。

把答案对照 `css-theming-presets` 选一套配色,再套下面的壳。

## Pattern A:电影感开场壳

适合有场景、有氛围的叙事卡。

```html
<section class="rp-opening">
  <header class="rp-opening__title">[场景标题]</header>
  <p class="rp-opening__meta">时间：[time] · 地点：[location] · 氛围：[mood]</p>
  <p class="rp-opening__body">[2-4 句镜头化描述,先给空间与光线,再给人物状态]</p>
  <p class="rp-opening__hook">[一句引导 {{user}} 行动的问题或动作钩子]</p>
</section>

<style>
.rp-opening {
  border: 1px solid rgba(255,255,255,.16);
  border-radius: 14px;
  padding: 14px 16px;
  background: linear-gradient(160deg, rgba(255,255,255,.08), rgba(255,255,255,.02));
}
.rp-opening__title { font-size: 1.05rem; font-weight: 700; letter-spacing: .04em; margin-bottom: 4px; }
.rp-opening__meta { opacity: .72; font-size: .86rem; margin-bottom: 10px; }
.rp-opening__body { line-height: 1.7; margin-bottom: 10px; }
.rp-opening__hook { font-weight: 600; }
</style>
```

## Pattern B:终端 / 系统提示开场

适合科技、游戏系统、异世界「系统流」卡。

```html
<section class="rp-term">
  <div class="rp-term__bar">● ● ●　SYSTEM · [系统名]</div>
  <div class="rp-term__line">&gt; 检测到宿主接入……</div>
  <div class="rp-term__line">&gt; [一行设定/任务播报]</div>
  <div class="rp-term__body">[正文描述]</div>
</section>

<style>
.rp-term { font-family: ui-monospace, monospace; border-radius: 10px; padding: 12px 14px;
  background: #0b0f17; color: #9fe7c0; border: 1px solid #1f2a37; }
.rp-term__bar { color: #6b7280; font-size: .8rem; margin-bottom: 8px; letter-spacing:.1em; }
.rp-term__line { line-height: 1.7; }
.rp-term__body { color: #d6e2f0; margin-top: 8px; line-height: 1.7; }
</style>
```

## Pattern C:极简低开销开场

不确定渲染环境、或卡片偏纯文字叙事时的安全选择。纯 Markdown,不依赖样式。

```markdown
【[场景标题]】
`[time] · [location] · [mood]`

[2-3 句画面感描述]

**引导：** [一句 {{user}} 可直接回应的问题或可执行动作]
```

## 构图规则

- 首句给「镜头」(看得见的画面),不要给抽象评价(「气氛很紧张」)。
- 细节优先级:空间环境 > 人物当前状态 > 当前冲突/悬念。
- 结尾必须给 {{user}} 一个可接的互动钩子:问句、选择、或一个动作切入点。
- 多开场卡:每个 `alternate_greetings` 用不同的壳或不同切入角度,避免千篇一律(配合 `opening-narrative-crafter` 技能)。
- 视觉容器一次一个,不要开场就嵌三层卡片。
