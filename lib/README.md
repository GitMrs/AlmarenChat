# lib 目录说明

本目录存放服务端与运行时的共享逻辑。经过多轮归档后，`lib` 顶层除本文档外不再有散落代码文件，所有代码按“基础层 / 业务域”归入子目录。

新增代码时请优先放入已有目录；确实需要新目录时，在本文档补一行说明。

## 一、分层总览

```
lib/
├─ 跨域基础层
│  ├─ core/          模型客户端、限制、调度器、沙箱、备份
│  ├─ client/        浏览器侧工具（无服务端依赖）
│  ├─ misc/          轻量独立工具
│  ├─ knowledge/     知识库入库与本地向量
│  ├─ web/           网页抓取、搜索、联网
│  ├─ chat/          聊天协议与配额
│  ├─ media/         图片生成与分享
│  └─ connectors/    通用连接器基建
│
├─ Agent 域
│  ├─ agents/data/    内置 Agent 目录
│  ├─ agents/model/   模型配置
│  ├─ agents/runtime/ Agent 执行时（工具循环、技能、权限、重试、证据）
│  └─ agents/memory/  记忆上下文与压缩
│
├─ 空间产品域
│  ├─ space/          Space 业务（成员、消息、技能、模板、自动化、分享、预览、作品）
│  └─ workspace/      工作区执行 + 发布/游戏/行情能力
│     ├─ wechat/      公众号发布
│     ├─ game/        四类互动游戏
│     └─ crypto/      加密行情与事件
│
└─ 独立业务域
   ├─ agent-study/        研习引擎
   ├─ personal-assistant/ 个人助理
   ├─ companion/          桌面伴侣
   ├─ coding-agents/      编码 Agent 编排
   ├─ pi-runtime/         pi agent 运行时
   ├─ qq-assistant/       QQ 助手
   ├─ trending/           热榜抓取
   ├─ video/              视频解析与 ASR
   ├─ tts/                语音合成
   └─ world/              世界事件与 Agent 策略
```

## 二、目录职责

### 基础层

| 目录 | 职责 | 典型模块 |
| --- | --- | --- |
| `core/` | 跨领域基础设施，任何业务都可依赖 | `model-client`、`model-limits`、`scheduler`、`linux-bubblewrap`、`sqlite-backup` |
| `client/` | 浏览器侧代码，禁止引入 Node 专属模块 | `api`、`socket`、`toast`、`utils`、`recent`、`client-id`、`use-weather-location` |
| `misc/` | 与业务无关的小工具 | `weather`、`moon-phase` |
| `knowledge/` | 知识库分块、向量化与检索 | `knowledge`、`local-embeddings` |
| `web/` | 所有“上网”能力：抓取、搜索、自动联网、代理、内容沙箱 | `fetch-webpage`、`web-fetch`、`web-search`、`auto-web`、`proxy`、`static-html-sandbox` |
| `chat/` | 聊天流式协议、配额、聊天数据工具 | `chat-stream`、`chat-quota`、`chat-data-tools` |
| `media/` | 图片生成、聊天图片落盘、Markdown 分享 | `image-generation`、`generated-chat-images`、`markdown-share` |
| `connectors/` | 通用连接器：凭据加解密、注册表、投递清单、webhook 模板 | `credentials`、`store`、`registry`、`delivery-manifest`、`webhook-template` |

### Agent 域

| 目录 | 职责 | 典型模块 |
| --- | --- | --- |
| `agents/data/` | 内置 Agent 静态数据与转换 | `agents-data`、`agent-avatar`、`gaming-agents` |
| `agents/model/` | Agent 模型配置的读取与解析 | `agent-model-config` |
| `agents/runtime/` | Agent 执行时：工具循环、技能注册、MCP、权限、重试链、运行证据、完成/等待策略、任务执行计划 | `tool-loop`、`runtime-tools`、`skill-registry`、`agent-runtime-v3-policy`、`run-retry-policy`、`runtime-permission-broker`、`task-execution-plan` |
| `agents/memory/` | 记忆加载、个人记忆、记忆策略、上下文压缩 | `agent-memory`、`agent-memory-service`、`agent-personal-memory`、`context-compression`、`current-time-context` |

### 空间产品域

| 目录 | 职责 | 典型模块 |
| --- | --- | --- |
| `space/` | Space 业务本身：成员与权限、消息运行时、技能、模板、自动化、内容重置、分享、预览、脚本执行、作品版本、任务提案 | `space-foundation`、`space-message-runtime`、`space-skills`、`space-templates`、`space-automation-policy`、`space-preview-policy`、`space-script-runner`、`space-share-policy`、`work-versions`、`task-proposals` |
| `workspace/` | Agent 执行工作区：任务尝试目录、快照 diff/apply/discard、写入意图判断 | `workspace-staging`、`workspace-write-intent` |
| `workspace/wechat/` | 公众号发布链路：草稿快照、文章策略、主题、发布状态、账号连接 | `wechat-publishing`、`wechat-article-policy`、`wechat-draft-snapshot`、`wechat-official-account`、`wechat-publication-policy` |
| `workspace/game/` | 互动游戏引擎 | `trpg/`、`turtle-soup/`、`undercover/`、`relay/` |
| `workspace/crypto/` | 加密行情与事件驱动：行情查询、事件同步、OKX 接入、交易生命周期、哨兵调度 | `market-query`、`market-tools`、`event-sync`、`okx-service`、`trade-lifecycle`、`sentinel-service` |

### 独立业务域

| 目录 | 职责 | 典型模块 |
| --- | --- | --- |
| `agent-study/` | 研习引擎：选题、内容抓取、知识评估、入库、每日调度 | `study-engine`、`interest-matcher`、`knowledge-assessor`、`ingest`、`scheduler` |
| `personal-assistant/` | 个人助理：记忆、提醒、历史上下文、主动跟进、工具循环 | `user-memory`、`memory-intent`、`reminder-extraction`、`proactive-schedule`、`prompt-builder` |
| `companion/` | 桌面伴侣：Live2D、语音、动作、回复协议 | `cubism-loader`、`motion`、`voice`、`reply-protocol` |
| `coding-agents/` | 编码 Agent 编排与沙箱 | `coordinator`、`registry`、`supervisor`、`sandbox` |
| `pi-runtime/` | pi coding agent 的会话与工作记忆 | `session-core`、`space-session`、`working-memory` |
| `qq-assistant/` | QQ 助手凭据、策略与 webhook | `credentials`、`policy`、`webhook` |
| `trending/` | 各平台热榜抓取与摘要 | `sources`、`parsers`、`scheduler`、`summary-service` |
| `video/` | 视频解析、B 站搜索、ASR 转写 | `web-video`、`video-asr`、`bilibili-search` |
| `tts/` | 语音合成供应商封装 | `edge-tts`、`fish-tts`、`markdown-cleaner`、`voices` |
| `world/` | 世界事件与 Agent 策略 | `events`、`context`、`agent-policy` |

## 三、文件格式约定

- **`.ts`**：被 Next.js 应用、API 路由、TypeScript 代码直接导入的模块。
- **`.mjs`**：被 `worker/`、`scripts/` 通过 `node` 直接加载的模块；导入时必须保留 `.mjs` 后缀。
- **测试**：与被测文件同目录，命名为 `*.test.mjs` 或 `*.test.ts`。
- **纯数据**：随模块放在同级 `data/` 下（如 `workspace/game/turtle-soup/data/library.json`），不要放到 `lib` 顶层。

## 四、引用规则

| 调用方 | 引用方式 | 示例 |
| --- | --- | --- |
| `app/`、`components/`、`lib/` 内的 TS | `@/lib/...` 别名 | `import { knowledge } from '@/lib/knowledge/knowledge'` |
| `lib/` 内的相对引用 | `../目录/文件` | `import { fetchWebPage } from '../web/web-fetch.mjs'` |
| `worker/`、`scripts/` | 相对路径，必须带扩展名 | `import ... from '../../lib/agents/runtime/tool-loop.mjs'` |
| 测试 harness | mock key 必须与源码 import 字符串完全一致 | `'../web/proxy.ts'` |

移动文件时需同步检查三类引用：`@/lib` 别名、`worker/`/`scripts/` 相对路径、测试里的源码路径与 mock key。

## 五、放置决策

新模块按以下顺序判断：

1. 是否只是模型/Scheduler/沙箱等基础能力？→ `core/`
2. 是否只在浏览器运行？→ `client/`
3. 是否属于“上网”能力？→ `web/`
4. 是否属于 Agent 执行、记忆、模型配置？→ `agents/{runtime,memory,model,data}/`
5. 是否属于 Space 业务或工作区？→ `space/` 或 `workspace/`
6. 是否属于已存在的独立业务域？→ 对应目录
7. 都不属于且只有一个消费者？→ 放入该消费者所属领域目录，不要新建顶层目录

## 六、当前边界说明

- `space/` 是 **Space 业务域**（成员、消息、技能、分享等产品能力）。
- `workspace/` 是 **执行工作区 + 发布/游戏能力容器**，与 `space/` 无直接互相引用。
- 公众号发布后端已集中在 `workspace/wechat/`；前端仍复用 `components/spaces/` 公共层，待后续单独抽离。
- 游戏后端在 `workspace/game/`，前端对应 `components/spaces/game/`。

## 七、验证

改动 `lib` 后至少执行：

```bash
npx tsc --noEmit
node --test "lib/**/*.test.mjs"
```

当前基线：631 个测试，612 通过，19 个既有失败（DOM 动画 harness、外部 TTS、文本断言等，与目录归档无关）。
