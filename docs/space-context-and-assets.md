# 空间资产管理、两阶段防重与增量检查点压缩技术文档

本文档详细记录 AlmarenChat 在多 Agent 空间（Spaces）与自动化运行中，针对**脚本化自动化两阶段去重**、**资产模块化精准上传**以及**上下文双重压缩与手动检查点归档**的架构设计与实现标准。

---

## 目录

1. [背景与核心原则](#1-背景与核心原则)
2. [脚本化执行与两阶段防重体系](#2-脚本化执行与两阶段防重体系)
3. [空间资产模块化精准上传](#3-空间资产模块化精准上传)
4. [上下文双重压缩与增量检查点](#4-上下文双重压缩与增量检查点)
5. [相关 API 与数据结构清单](#5-相关-api-与数据结构清单)
6. [端到端验收与验证](#6-端到端验收与验证)

---

## 1. 背景与核心原则

在多 Agent 协同空间与自动化运作中，随着用户任务从简单的文字问答演变为长期的工程脚本编写、跨平台数据采集及超长对话推进，系统暴露了三类关键痛点：
1. **确定性逻辑与模型生成混杂**：大模型自行抓取上百条 JSON 并用上下文比对历史 ID 极其脆弱，且执行失败时过早记录已发 ID 会导致漏推；
2. **文件上传路径黑盒硬编码**：用户在“共享资产”或“基础资料”模块点击上传，文件全部默认掉入 `inbox/` 待处理收件箱，造成视觉“丢失”；
3. **上下文负载不透明且缺乏主动权**：侧边栏状态不可点击，大模型上下文压缩依赖 91k tokens 的被动爆仓阈值，日常会话只有生硬的条数截断。

为此，系统确立了以下三个工程原则：
- **职责解耦（Code for Data, LLM for Content）**：网络请求、数据去重、数值计算交由空间 Python/Node 脚本稳定执行；大模型专心做深度提炼与排版编排。
- **所见即所存（Upload by Active Module）**：用户在哪个资产 Tab 点击上传，文件就精准落入对应的物理目录与资产角色中。
- **记忆分层与用户可控（Layered Memory & User Control）**：日常按条数滑动修剪，重要节点用户可一键手动触发“检查点摘要”，将成百上千条早期对话浓缩持久化。

---

## 2. 脚本化执行与两阶段防重体系

空间 Python/Node.js 脚本在 Linux 生产服务器上强制通过 Bubblewrap 执行；macOS 和 Windows 仅作为可信本地开发环境直接执行。部署要求、隔离边界、断网限制和排障方法见 [空间脚本 Linux 沙箱说明](./space-script-sandbox.md)。

### 2.1 技能注册表分工升级（`script-developer`）
- **痛点**：此前后台代码生成任务经常被 `document-writer`（仅支持 `.md`）拦截，导致 Python 等后台脚本创建失败并抛出“不支持代码格式”错误。
- **解法**：在 `lib/agent-runtime/skill-registry.mjs` 中新增内置技能 `script-developer`，显式支持 `.py, .js, .mjs, .ts, .sh, .txt, .json, .md` 文件。后端代码生成需求精准路由给 `script-developer`，彻底解决拦截冲突。

### 2.2 榜单接口数据适配（`shared/fetch_and_filter.py`）
- 适配目标接口 `https://xbangdan.com/hot.json`：
  - 根结构：`{ "updated": int, "rate": list[tweet], "views": list[tweet] }`；
  - 自动合并增速榜（`rate`）与浏览榜（`views`），按推文 `id` 毫秒级去重；
  - 提取关键字段：`id, h (handle), n (昵称), c (分类), t (正文), age (距今小时), v (浏览量), l (点赞数), r (增速得分)`。

### 2.3 执行级交付回执
定时采集、AI 处理与外部推送采用通用的执行级回执，不再由平台提交某一种来源专用的 `pending-ids.txt`：

```
[采集] -> [AI 处理或脚本直出] -> SpaceAutomationExecution
                                      ├─ PENDING：等待推送
                                      ├─ DELIVERING：正在推送
                                      ├─ DELIVERED：外部接收方确认成功
                                      └─ FAILED：重试耗尽，保留错误
```

- 每次执行独立保存 `workId`、推送内容、内容哈希、尝试次数、送达时间和错误，不共享可被后一次执行覆盖的暂存文件。
- Worker 中断时，`DELIVERING` 会恢复为 `PENDING`；Webhook 使用稳定的执行级幂等键。
- 脚本通过 `SPACE_AUTOMATION_EXECUTION_ID` 识别本次执行，并从 `SPACE_AUTOMATION_RECEIPTS_PATH` 读取当前自动化最近 50 条已确认送达结果。
- 来源规则仍由脚本负责：脚本可按消息 ID、URL、游标或时间戳解释回执；平台只负责执行隔离和确认送达边界。

### 2.4 提示词与脚本输出纯净化解耦
- 移除了脚本 `format_for_llm` 中硬编码的指令建议文本；
- 脚本作为**纯粹的数据提供者（Data Provider）**，仅输出干净的 Markdown 数据列表；
- 业务排版（如两核心板块划分、超链接内嵌合并为 `序号. @{h}（博主名）：[{一句话提炼}（{浏览量} 浏览）]({url})`、禁止开头废话）100% 由外部 Prompt 主导。

---

## 3. 空间资产模块化精准上传

### 3.1 路由重定向与角色映射
彻底重构 `POST /api/spaces/[spaceId]/files`，废除以往无脑写入 `workspace/inbox/` 的硬编码逻辑。通过前端透传 `role` 与 `workId`，建立如下路由矩阵：

| 前端激活模块 / Tab | 目标物理路径 | 命名规范 | 资产分类 (`assetRole`) | 行为特性 |
| :--- | :--- | :--- | :--- | :--- |
| **共享资产** (`SHARED`) | `workspace/shared/<cleanName>` | 保持原始文件名（无时间戳） | `SHARED` | 脚本/配置，重复上传自动替换更新同名记录 |
| **基础资料** (`FOUNDATION`) | `workspace/foundation/<cleanName>` | 保持原始文件名 | `FOUNDATION` | 知识库与底层资产，支持平铺引用 |
| **成果** (`OUTPUT`) | `workspace/works/<workId>/<cleanName>` | 保持原始文件名 | `OUTPUT` | 归属于指定成果工作流，持久化归档 |
| **待处理** (`INPUT`) | `workspace/inbox/<timestamp>-<cleanName>` | 时间戳前缀 | `INPUT` | 待处理收件箱，供智能体后续消费 |
| **全部** (`all`) / 对话框附件 | `workspace/inbox/<timestamp>-<cleanName>` | 时间戳前缀 | `INPUT` | 安全进入待处理区 |

### 3.2 界面交互与即时反馈
- **动态文案与提示**：
  - 在“共享资产”标签下，上传按钮变为 **“上传共享资产”**，悬停提示标注目标路径 `workspace/shared/`；
  - 在“基础资料”标签下，上传按钮变为 **“上传基础资料”**；
  - 在“成果”标签下，上传按钮变为 **“上传成果”**；
- **状态列表去重更新**：前端上传成功后，自动按 `file.id` 和 `file.relativePath` 对旧记录去重，上传同名公共脚本或模板后界面即时刷新生效。

---

## 4. 上下文双重压缩与增量检查点

### 4.1 双重压缩体系设计

| 维度 | 第一层：日常滑动修剪 | 第二层：增量检查点归档 (Checkpoint) |
| :--- | :--- | :--- |
| **触发维度** | **消息条数与关键帧重要度** | **Token 真实消耗与用户主动意愿** |
| **工作时机** | 每次普通对话时实时运行 | 达到 91k tokens 爆仓线被动触发，或**用户在看板中一键主动触发** |
| **处理手段** | 优先保留最新对话窗口，早期对话挑高分帧（代码块、关键决策词） | 将早期全部历史消息深度浓缩为结构化 Markdown 摘要 |
| **存储介质** | 仅运行时计算，不修改数据库历史 | 写入数据库表 `SpaceContextCheckpoint` 持久化 |
| **大模型输入** | 挑出的 N 条原始整条消息 | **1 条检查点背景摘要 + 最新 5~8 条活跃对话** |
| **压缩效果** | 轻度优化（约 5% ~ 20% Tokens） | **深度优化（直接释放 60% ~ 80% Tokens）** |

### 4.2 交互弹窗化与透明化看板（`CompressionStatusPanel.tsx`）
- 侧边栏的“轻度压缩 7%”由原先不可点击的静态 Badge，升级为**可交互的状态卡片**；
- 点击后展开 **「上下文优化详情」** 弹窗：
  - **Token 使用对比进度条**；
  - **历史总消息数 vs 当前纳入上下文消息数**；
  - **增量检查点状态卡**（清晰标注已归档消息数与摘要更新时间）；
  - **操作控制台**：
    - `⚡ 立即归档为检查点（深度压缩）` 主按钮；
    - `清除检查点` 辅助按钮；
    - `刷新统计` 与历史记录展开。

### 4.3 检查点自动感知重算
更新 `GET /api/spaces/[spaceId]/compression-stats` 算法：
- 当检查点存在时，准确计算：
  - `originalCount = checkpoint.sourceMessageCount + recentMessages.length`
  - `originalTokens = checkpoint.sourceTokenCount + recentTokens`
  - `activeTokens = estimateTokens(checkpoint.summary) + recentTokens`
  - `reductionPercentage = (originalTokens - activeTokens) / originalTokens * 100`
- 真实呈现大幅压缩率（如 65%~75%），侧边栏标签自适应变为 `中度压缩 / 激进压缩`。

---

## 5. 相关 API 与数据结构清单

### 5.1 空间文件上传接口
- **路径**：`POST /api/spaces/[spaceId]/files`
- **请求体（FormData）**：
  - `file`: File 对象（单个文件 <= 2MB）
  - `role`: 可选，`'SHARED' | 'FOUNDATION' | 'OUTPUT' | 'INPUT' | 'all'`
  - `workId`: 可选，成果 ID（当 `role === 'OUTPUT'` 时生效）
- **返回**：`{ file: SpaceFile }`（包含计算后的 `relativePath` 与 `assetRole`）

### 5.2 检查点创建与归档接口
- **路径**：`POST /api/spaces/[spaceId]/compression-stats`
- **请求体（JSON）**：
  - `preserveRecent`: 可选，保留活跃条数（默认自动取 5~15 条）
- **返回**：
  ```json
  {
    "success": true,
    "checkpoint": {
      "id": "uuid",
      "updatedAt": "2026-09-21T...",
      "sourceMessageCount": 40,
      "sourceTokenCount": 2850,
      "throughMessageId": "msg-id"
    },
    "archivedCount": 40,
    "preservedCount": 8
  }
  ```

### 5.3 检查点清除接口
- **路径**：`DELETE /api/spaces/[spaceId]/compression-stats`
- **行为**：物理删除 `SpaceContextCheckpoint`，恢复为常规全量滑动模式。

---

## 6. 端到端验收与验证

1. **类型检查与单元测试**：
   - 运行 `npx tsc --noEmit`，验证通过（Exit Code 0）；
   - 运行 `node --test lib/agent-runtime/skill-registry.test.mjs`，10 项测试全部通过；
   - 运行 `node --test lib/context-compression.test.ts`，4 项测试全部通过。
2. **执行级交付回执实测**：
   - 验证脚本直出和 AI 分析两种执行都先写入独立的 `SpaceAutomationExecution`；
   - 验证只有 Webhook 返回成功后状态才变为 `DELIVERED`，失败重试不会重新执行采集脚本；
   - 验证下一次脚本只能从回执文件读到已确认送达的执行结果。
3. **文件模块化上传实测**：
   - 验证在 `SHARED` 标签上传脚本文件，直接落入 `workspace/shared/`，且多次上传同名文件无时间戳并能正确替换。
4. **手动检查点压缩实测**：
   - 验证点击 `立即归档为检查点` 后，数据库 `SpaceContextCheckpoint` 正常写入；
   - 前端统计指标由 7% 实时跳升为 65%+，刷新页面状态保持一致。
