# reply-format-enforcer

用于稳定后续每轮回复格式，避免有时精致有时散乱。

## Recommended Reply Skeleton

```markdown
[状态栏]
- 情绪: [emotion]
- 目标: [goal]
- 风险: [risk]

[动作/镜头]
[2-4 句，描述角色行为、环境变化、节奏推进]

[对白]
「[1-3 句核心台词，保留角色语气]」

[可选扩展]
- 线索: [clue]
- 下一步: [next_action]
```

## HTML Variant

```html
<article class="rp-turn">
  <div class="rp-turn__state">情绪：[emotion]｜目标：[goal]｜风险：[risk]</div>
  <div class="rp-turn__action">[动作与镜头描述]</div>
  <blockquote class="rp-turn__dialogue">「[核心台词]」</blockquote>
  <div class="rp-turn__next">下一步：[next_action]</div>
</article>
```

## Constraints

- 对白和动作要分开，不要混成一段。
- 除非用户要求，不要让状态栏超过 1 行。
- 每轮必须有“推进信息”（新线索/新选择/新压力至少一项）。
- 不要让格式喧宾夺主，正文信息密度优先。

## Adaptive Mode

- 轻量模式：只保留“动作/对白”两段。
- 标准模式：状态栏 + 动作 + 对白。
- 增强模式：标准模式 + 可选扩展（线索/下一步）。
