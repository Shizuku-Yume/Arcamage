---
name: 对话示例与提示词
description: 编写对话示例(mes_example)与中立的 system/post_history 指令,稳定语气与人设。
references:
  - references/mes-example-format.md
  - references/system-prompt-guide.md
---

本技能帮你写好两类「让角色稳定不跑偏」的内容:`mes_example`(示范角色怎么说话)与 `system_prompt` / `post_history_instructions`(给模型的行为指令)。前者靠示例,后者靠规则,二者配合让语气和人设可控。

## 何时使用

- 角色说话不像设定、语气飘忽 → 需要 `mes_example` 示范。
- 用户想加对话示例,或现有示例格式混乱。
- 用户想写/优化 `system_prompt` 或 `post_history_instructions`。
- 角色容易 OOC(脱离人设)、容易替用户行动、回复风格不稳。

## 必须做

- 写 `mes_example` 时遵循 `mes-example-format` 的 `<START>` 约定与格式。
- 示例要**示范语气而非堆事实**:展示角色怎么遣词、怎么反应,而不是复述设定。
- 写指令时遵循 `system-prompt-guide`:中立、聚焦行为约束,不臆造剧情。
- 区分 `system_prompt`(开场前的总指令)与 `post_history_instructions`(对话历史后的提醒,常用于强化近期约束)。
- 保留所有宏(`{{user}}`、`{{char}}`)与 HTML 标签;`{{user}}`/`{{char}}` 在示例里用对。

## 不要做

- 不要在 `mes_example` 里替 {{user}} 写台词以外的既定动作/想法(示范对话除外)。
- 不要在指令里写死具体剧情走向(那是开场白和世界书的事)。
- 不要堆叠冗长、互相矛盾的规则;指令越短越聚焦越有效。
- 不要让指令覆盖或弱化卡片/系统的既有约束。
- 不要改变用户已设定的核心人设。

## 工作流

1. 读 `personality` / `description`,提炼角色说话风格(用词、句长、口头禅、情绪反应)。
2. 用 `mes-example-format` 写 1-3 段示范对话,覆盖典型情境(日常、冲突、被问及核心话题)。
3. 如需行为约束,用 `system-prompt-guide` 写简洁中立的 `system_prompt`。
4. 近期容易跑偏的约束(如「保持第一人称」「不替用户行动」)放 `post_history_instructions`。
5. 说明写了哪些示例/指令、各自意图。

## 示例

- 「角色说话不像设定里那么毒舌,帮我加示例。」→ 写 2 段 mes_example,示范她怎么用刻薄但不失分寸的方式回应。
- 「老是替我做决定,怎么办?」→ 在 `post_history_instructions` 加一句中立约束:不替 {{user}} 决定其言行。
