# AlmarenChat 版本更新日志 (Changelog)

本文档记录 AlmarenChat 平台各版本的重要功能迭代、架构改进与部署变更。
完整文档亦可见于 [docs/CHANGELOG.md](docs/CHANGELOG.md)。

---

## [v2.2.0] - 2026-10-07

### 🌟 核心新特性概览：多智能体群聊治理与人机交互深度优化

本次更新重点聚焦于**多智能体协作空间（Spaces）中的群聊体验、流转纪律与人机决策闭环**，彻底解决了多 Agent 讨论时“无限死循环、自嗨互聊、无法随时打断、缺少向用户汇报收尾”的痛点，并落地了后台空闲智能破冰搭话引擎。

---

### 一、空间群聊互动规则治理（Space Discussion Settings）

为空间引入细粒度的群聊与互聊策略控制，将群聊节奏与发言权完全交给用户管理：

1. **多维度规则配置**：
   - **互聊轮次上限 (`botChainLimit`)**：限制群聊中 AI 连续互相回复的最大轮次（支持 1~6 轮，默认 3 轮），防止机器人之间互相寒暄失控。
   - **自动接话开关 (`autoBotChat`)**：控制是否允许空间内的智能体在没有用户发言时自发接力回应。
   - **@ 触发接力 (`botAtMentionTriggersReply`)**：当 AI 成员在回复中提及（@）其他成员时，是否允许被提及的成员自动接话。
   - **空闲主动搭话 (`idleTalk`)**：允许空间长期静默后，由智能体在茶水间模式下主动发起轻量破冰问候。
2. **前后端与数据持久化**：
   - 数据库 `Space` 表新增 `discussionSettings` 字段（JSON 格式）。
   - 前端新增专属弹窗 [`SpaceDiscussionSettingsDialog`](components/spaces/SpaceDiscussionSettingsDialog.tsx)，并在空间底部工具栏与空间设置抽屉中提供可视化配置入口与规则状态看板。
   - 配套标准 Prisma Migration（`20261006220000_add_space_discussion_settings`），完全兼容现有线上 `deploy-pm2.sh` 一键无缝部署。

---

### 二、多成员圆桌讨论与调度策略升级（Roundtable & Relay Scheduler）

1. **总轮次上限控制与防死循环熔断**：
   - 引入 `groupChatTurnLimit` 动态轮次边界计算，根据参与成员数与设定的轮次数（`participants.length * maxRounds`）严格收敛总发言次数，杜绝讨论无限递增。
2. **公平发言调度策略 (`group-chat-scheduler.mjs`)**：
   - 优化圆桌讨论与接力发言选举算法，动态依据历史发言频率、轮次均衡度与间隔轮次自动选择下一个最合适的成员发言，避免个别活跃成员霸场。
3. **成员独立模型容错与降级回退**：
   - 支持空间不同成员绑定不同的大模型供应商（如 GPT、Claude、DeepSeek）。
   - 当成员配置的独立私有模型发生异常或超时时，自动平滑降级回退到空间全局默认模型继续发言，保证圆桌讨论不中断。

---

### 三、“还麦给用户”视觉感知与决策闭环（Turn Handoff & Decision Loop）

在过去，AI 讨论常常在某一条消息戛然而止，用户不知道讨论是否已结束，也不清楚下一步该如何推进。新版全面打通了“收尾总结 -> 还麦用户 -> 一键决策”的完整闭环：

1. **全链路还麦信号识别与标记**：
   - **Worker 圆桌讨论**：最后一轮讨论发言自动标记 `{ handoff: true }`。
   - **前端群聊接力**：接力达到预设轮次上限时的最后一跳，注入提示词指导成员“向用户总结核心结论并邀请用户决策还麦”，并在后端持久化为 `{ type: 'relay_handoff' }` 附件。
2. **还麦视觉卡片（[`SpaceMessageItem.tsx`](components/spaces/SpaceMessageItem.tsx)）**：
   - 在收尾发言下方渲染优雅的双色渐变卡片：`🎯 讨论收尾 · 等待您的决策还麦`。
3. **智能决策 Chip 提取 (`extractHandoffOptions`)**：
   - 正则智能解析 AI 回复中的方案选项（如 `1. 方案A`、`A. 选项A`、`① 方案一`、`方案/选项：xxx`），提炼为直观的决策 Chip。
   - 若正文中无显式编号选项，自动提供智能兜底选项（`赞同该方案，直接推进`、`需要进一步补充细节`、`我有不同想法`）。
4. **一键预填与对焦**：
   - 点击任意建议 Chip 或“快速回复”，自动将决策内容填充至底部输入框并聚焦光标，无需用户重新手动输入。

---

### 四、随时打断与抢麦发言体验（Interruptible Relay & Instant Takeover）

解决 AI 多个成员在群聊中接力发言时，用户无法插话、只能被动等待的难题：

1. **输入栏上方常驻接力状态 Banner**：
   - 当检测到多成员正在队列式接力发言时，在底部输入栏上方实时展示动态进度条：
     - 显示当前发言顺序：`多成员接力中（第 X/Y 位 · 成员名）`；
     - 罗列后续排队待发言的成员名单；
     - 提供显式的 `[⏹ 停止后续接力 · 由我发言]` 按钮，一键清空排队队列并把光标聚焦到底部输入框。
2. **用户提前打字抢麦**：
   - 当 AI 正在发言或排队时，用户在输入框键入文字后，发送按钮智能切换为高亮蓝色的“抢麦发送（打断后续接力）”；
   - 用户敲击回车或点击发送时，系统立即中断（`abort()`）当前正在进行的流式生成，清空后续队列，并把用户的最新指令置顶优先提交。

---

### 五、后台 Worker 空闲主动搭话引擎（Idle Talk Engine）

为空间注入“数字生命”的温度，在保证绝不打扰正常工作的前提下实现自然破冰：

1. **独立后台巡检服务（[`idle-talk-runtime.mjs`](worker/runtime/idle-talk-runtime.mjs)）**：
   - 作为子运行时挂载进 Worker 主轮询循环（`worker-loop.mjs`）。
   - 仅针对配置了 `idleTalk: true` 的空间执行巡检。
2. **多层安全防扰与冲突防护机制**：
   - **工作状态互斥**：若空间当前存在正在运行的自动化任务（`AgentRun`）、圆桌讨论（`SpaceDiscussion`）或进行中的接力（`SpaceRelay`），立即静默跳过，绝不在工作期间打扰。
   - **静默时序控制**：空间连续静默超过 6 小时且巡检间隔满 3 小时方可触发一次。
   - **防自言自语刷屏**：检测空间最后一条消息，若已是主动问候消息则绝不重复发送。
3. **自然破冰问候生成**：
   - 结合空间主题与设定的成员性格，生成简短亲切（<150 字）的破冰问候。
   - 消息携带 `{ type: 'idle_talk' }` 标签，在前端展示专属徽章：`☕ 空间茶水间 · 空闲主动问候`。

---

### 六、核心文件变更清单一览

| 模块 / 路径 | 变更类型 | 说明 |
| :--- | :--- | :--- |
| `prisma/schema.prisma` | 修改 | `Space` 表新增 `discussionSettings` 字段 (JSON) |
| `prisma/migrations/20261006220000_add_space_discussion_settings/` | 新增 | 标准数据库迁移 SQL，支持 `deploy-pm2.sh` 自动执行 |
| `types/index.ts` | 修改 | 新增 `SpaceDiscussionSettings`、`SpaceRelayHandoffAttachment`、`SpaceIdleTalkAttachment` 等类型定义 |
| `worker/policies/group-chat-scheduler.mjs` | 修改 | 实现公平均衡发言人调度与总轮次边界限制 |
| `worker/runtime/discussion-runtime.mjs` | 修改 | 圆桌讨论接入新调度器、还麦指令注入、独立模型异常回退 |
| `worker/runtime/idle-talk-runtime.mjs` | 新增 | 空闲主动搭话的后台巡检引擎与安全守护机制 |
| `worker/runtime/worker-loop.mjs` | 修改 | 将 `checkIdleTalk` 编排入 Worker 核心心跳循环 |
| `worker/agent-runtime.mjs` | 修改 | 实例化并装配 IdleTalkRuntime |
| `components/spaces/SpaceDiscussionSettingsDialog.tsx` | 新增 | 讨论与互动规则可视化配置弹窗组件 |
| `components/spaces/SpaceDiscussionDialog.tsx` | 修改 | 接入规则配置弹窗快捷入口 |
| `components/spaces/SpaceMessageItem.tsx` | 修改 | 渲染还麦收尾卡片、决策建议 Chip 提取、空闲搭话徽章 |
| `app/api/spaces/[spaceId]/route.ts` | 修改 | 保存空间时支持写入与更新 `discussionSettings` |
| `app/api/spaces/[spaceId]/messages/route.ts` | 修改 | 支持流式消息的 `isHandoffTurn` 标记持久化 |
| `app/spaces/[spaceId]/page.tsx` | 修改 | 增加接力打断队列控制器、接力状态 Banner、打字抢麦发送、规则配置看板 |
| `lib/api.ts` | 修改 | `streamSpaceMessage` 增加 `isHandoffTurn` 字段透传 |
| `scripts/upgrade-agent-runtime.mjs` | 修改 | 离线数据库升级脚本同步添加 `discussionSettings` 补齐 |
| `docs/CHANGELOG.md` | 新增 | 完整的版本更新日志与技术架构说明文档 |
| `README.md` | 修改 | 目录补充更新日志文档链接 |
| `docs/PRODUCT_OVERVIEW.md` | 修改 | Spaces 支柱章节同步补充多智能体讨论治理与交互亮点 |
