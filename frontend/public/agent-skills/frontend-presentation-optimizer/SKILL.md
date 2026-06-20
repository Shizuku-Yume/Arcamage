---
name: 卡面前端设计
description: 为开场白、状态面板与每轮回复设计贴合卡片主题的前端展示效果。
references:
  - references/opening-visual-composer.md
  - references/status-panel-designer.md
  - references/reply-format-enforcer.md
  - references/css-theming-presets.md
  - references/interaction-and-safety.md
---

本技能帮助你为角色卡设计「前端展示层」:开场白的视觉呈现、状态面板/状态栏界面、以及每轮回复的稳定排版。核心目标不是堆砌特效,而是让视觉服务于剧情代入,并且**贴合这张卡的主题**。

## 何时使用

- 用户想让开场白更有视觉冲击力或舞台感。
- 用户想要状态面板 / 状态栏(HP、好感度、时间、属性、所持物等)。
- 用户想要每轮回复有稳定、有层次的排版结构。
- 用户想要轻量交互(展开/收起、切换标签、骰子等)。
- 现有内容能读但很「平」:没有层次、重复、缺乏主题感。

## 必须做

- **先读主题,再做设计**:从卡片的 `description`、`tags`、世界观里提取视觉母题(色调、材质、时代、氛围),让配色和版式语气与之一致。一张赛博朋克卡和一张古风卡的面板不该长一样。
- 按需取用 reference,只用最少够用的部分;层次顺序是「先氛围 → 再信息 → 最后特效」。
- 输出可直接使用的完整结果:用到 HTML 时附带配套 `<style>`,用到交互时附带 `<script>`。
- 完整保留宏与变量(`{{user}}`、`{{char}}`、`{{roll}}` 等)和角色设定事实。
- 输出前过一遍 `interaction-and-safety` 的检查清单。

## 不要做

- 不要为了炫技而牺牲可读性或剧情推进。
- 不要凭空捏造世界观事实、人设约束或硬性规则。
- 不要依赖外部 CDN / 远程字体 / 远程图片(除非用户提供了明确可用的链接)。
- 不要一次叠满多种特效或多个复杂动画;主视觉容器一次一个,避免层层嵌套。
- 不要让模板太重,导致每轮回复都冗长。

## 工作流

1. 提取主题母题(`css-theming-presets` 的「按主题选盘」),定下配色与版式语气。
2. 从 `opening-visual-composer` 选一个开场壳;需要数值界面时叠加 `status-panel-designer`。
3. 用 `reply-format-enforcer` 定一个后续每轮的回复骨架。
4. 只在用户要求交互时,从 `interaction-and-safety` 取一个交互件。
5. 按 `interaction-and-safety` 的 checklist 自检后再输出。

## 示例

- 「把开场写得更有舞台感,带点 UI 氛围。」→ 电影感开场壳 + 渐变标题 + 轻微淡入。
- 「给我加一个好感度和体力的状态面板。」→ status-panel 的进度条 + 网格组件,配色取自卡片主题。
- 「之后每轮都按固定格式回。」→ reply-format 标准骨架(状态/动作/对白)。
- 「要一点交互但别太重。」→ 一个 `<details>` 展开件或单个掷骰按钮。
