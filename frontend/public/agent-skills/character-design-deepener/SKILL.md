---
name: 角色设定深化
description: 深化角色设定:外貌/性格/语气/背景/关系的结构化方法,避免设定矛盾与脸谱化。
references:
  - references/trait-structure.md
  - references/consistency-checklist.md
---

本技能帮你把单薄、脸谱化的角色设定做厚做立体,主要作用于 `description` 与 `personality` 字段,兼顾 `scenario` 的背景一致性。核心是「结构化 + 不矛盾 + show don't tell」。

## 何时使用

- 角色描述太单薄、空泛,或全是形容词堆砌。
- 性格写成了标签罗列(「温柔、善良、坚强」),缺少行为与动机支撑。
- 用户想「丰富人设」「让角色更立体」「补全性格」。
- 多次扩写后出现设定前后矛盾。

## 必须做

- 先 `card_patch_text` 读取现有 `description`、`personality`、`scenario`,理解已有设定再动笔。
- 按 `trait-structure` 的维度补全:外貌、性格、语气习惯、背景、动机、关系。
- **Show don't tell**:用具体行为/细节体现特质,而非直接贴标签。「她总把最后一块糖让给别人」优于「她很善良」。
- 给性格留「裂缝」:优点对应的代价、矛盾面、底线,避免完美脸谱。
- 用 `consistency-checklist` 自检新增内容与既有设定(年龄/能力/世界观/语气)不冲突。
- 保留所有宏(`{{user}}`、`{{char}}`)与 HTML 标签。

## 不要做

- 不要臆造与既有设定冲突的事实(年龄、身份、能力上限、世界观规则)。
- 不要把 `personality` 写成无支撑的形容词清单。
- 不要无节制扩写导致 token 爆炸——细节服务于「可演绎」,不是越多越好。
- 不要改变用户已设定的核心身份与剧情走向。

## 工作流

1. 读取 `description` / `personality` / `scenario`,列出已知事实与空白维度。
2. 对照 `trait-structure` 选 2-4 个最该补的维度(通常是动机、语气习惯、关系)。
3. 用 show-don't-tell 写出具体细节,优先 `card_patch_text` 局部增补而非整段重写。
4. 过 `consistency-checklist`,修掉矛盾与冗余。
5. 用一两句话说明补充了哪些维度。

## 示例

- 「这个角色太平了,帮我丰富一下。」→ 补动机(她想要什么、怕什么)、一个标志性小习惯、与 {{user}} 的关系张力。
- 「性格只有几个词,展开一下。」→ 把每个标签换成一个能在对话里演出来的行为模式 + 触发条件。
