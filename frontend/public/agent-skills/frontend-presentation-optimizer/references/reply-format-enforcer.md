# reply-format-enforcer

用于稳定「后续每轮」的回复格式,避免有时精致、有时散乱。格式是骨架,不是枷锁——信息密度永远优先于装饰。

## 推荐回复骨架(纯文本/Markdown 版)

```markdown
[状态栏 · 一行]
情绪：[emotion]｜目标：[goal]｜风险：[risk]

[动作/镜头]
[2-4 句,描述角色行为、环境变化、节奏推进]

[对白]
「[1-3 句核心台词,保留角色语气]」

[可选扩展]
线索：[clue]　下一步：[next_action]
```

## HTML 版

需要更强的视觉分区时使用;配色与开场壳保持一致。

```html
<article class="rp-turn">
  <div class="rp-turn__state">情绪：[emotion]｜目标：[goal]｜风险：[risk]</div>
  <div class="rp-turn__action">[动作与镜头描述]</div>
  <blockquote class="rp-turn__dialogue">「[核心台词]」</blockquote>
  <div class="rp-turn__next">下一步：[next_action]</div>
</article>

<style>
.rp-turn__state { font-size: .82rem; opacity: .8; margin-bottom: 8px; }
.rp-turn__action { line-height: 1.75; margin-bottom: 8px; }
.rp-turn__dialogue { border-left: 3px solid rgba(167,139,250,.6); margin: 8px 0;
  padding: 4px 12px; font-style: normal; }
.rp-turn__next { font-size: .85rem; opacity: .85; }
</style>
```

## 自适应模式

按卡片调性和用户偏好选强度,不要一律上最重的:

- **轻量模式**:只保留「动作 / 对白」两段。适合纯叙事、追求沉浸的卡。
- **标准模式**:状态栏(1 行) + 动作 + 对白。默认推荐。
- **增强模式**:标准 + 可选扩展(线索/下一步)+ 可选状态面板。适合游戏化、养成、探索类卡。

## 约束

- 对白和动作要分开,不要混成一坨。
- 状态栏除非用户要求,**不超过 1 行**。
- 每轮必须有「推进信息」:新线索 / 新选择 / 新压力,至少一项。
- 不要让格式喧宾夺主;模板越重,越要克制每段字数。
- 保留宏变量,尤其 `{{user}}` / `{{char}}`。
