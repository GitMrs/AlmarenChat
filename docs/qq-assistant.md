# QQ Bot 通道

`worker/qq-assistant.mjs` 通过 QQ Bot Gateway 接收私聊消息，再调用站内内部接口生成回复。当前支持两种绑定：

- **Agent 独立 QQ Bot**：每个 Agent 使用自己的 AppID / AppSecret、自己的 QQ 接收人、自己的主聊天和 Webhook。多个 Agent 可以同时在线，消息按绑定和会话隔离。
- **个人 QQ 通道（旧版）**：继续使用 `AssistantQQBinding`，对应个人助理的主聊天，行为保持不变。

## Agent 独立 QQ Bot

在 Agent 聊天页右侧详情面板点击 **接入 QQ Bot**，填写该 Agent 专属的 QQ Bot AppID 和 AppSecret。保存后：

- 创建 `QqBotAccount` 保存加密后的 AppSecret。
- 创建 `AgentQQBinding`，把 Agent、Bot 账号和该 Agent 的主聊天关联起来。
- 第一次收到 QQ 私聊时，创建 `QqUserIdentity`，记录这个 Bot 对应的 QQ 接收人。
- QQ 消息写入该 Agent 的主聊天，`Message.source = QQ`；网页和 QQ 共用同一段上下文、记忆和知识库。

不同 Agent 使用不同的 `conversationId`，即使同时在线也不会串消息。每个 Agent 的 Bot 只接受一个 QQ 接收人；在设置里点击 **重置接收人** 后，可以让另一个 QQ 号重新私聊绑定。

默认每个用户最多接入 `QQ_MAX_BOTS_PER_USER=5` 个 Agent Bot，避免误配置导致无限创建。该上限只是安全阀，后续可调整。

### 主动通知

每个 Agent 绑定可以单独生成 Webhook，供外部任务或后续自动化向该 Agent 的 QQ 接收人投递消息。生成、轮换或查看 Webhook 都在 **接入 QQ Bot** 面板中完成；查看地址需要验证当前账号密码。当前个人助理的定时提醒仍只投递到旧版个人 QQ 通道，Agent 级提醒自动投递暂未接入。

## 模型与上下文

- QQ 始终使用服务端线上模型，不读取浏览器里的 Ollama 配置。
- 未启用账号自定义在线模型时，使用平台默认模型；启用后使用账号配置的在线 API。
- Agent QQ 消息使用该 Agent 的系统提示词、记忆、知识库、成长记录和主聊天历史。
- 个人 QQ 通道继续与网页个人助理共用主聊天、长期记忆、任务和提醒。

QQ 不能直接连接用户电脑上的 `127.0.0.1:11434`，因此不会使用本地 Ollama。网页端的线上 / 本地切换也不会影响 QQ。

## 能力

- 流式输出回复。
- 支持 QQ 可展示的标准 Markdown；避免 HTML、复杂表格和站内相对链接。
- QQ 对话会按需使用联网搜索，不再提供单独的联网菜单开关。
- 支持接收 QQ 图片并交给视觉模型分析；图片必须能通过 HTTPS 访问。
- 个人 QQ 通道继续支持回复“完成了”“延后 10 分钟”等短指令处理已送达提醒。

## 配置

Agent Bot 的 AppID 和 AppSecret 在对应 Agent 的 **接入 QQ Bot** 面板中保存，不写入环境变量。AppSecret 会在服务端加密保存，网页不会返回明文。

服务器环境变量：

```env
QQ_ASSISTANT_SECRET="至少 32 位的随机字符串"
QQ_ASSISTANT_INTERNAL_URL="http://127.0.0.1:8001/api/internal/assistant/qq/messages"
# 可选；默认从 QQ_ASSISTANT_INTERNAL_URL 推导 /api/internal/agents/qq/messages
QQ_AGENT_INTERNAL_URL=""
QQ_MAX_BOTS_PER_USER="5"
QQ_ASSISTANT_POLL_MS="5000"
QQ_ASSISTANT_WEBHOOK_PUBLIC_URL=""
QQ_ASSISTANT_WEBHOOK_INTERNAL_URL="http://127.0.0.1:8787"
QQ_ASSISTANT_WEBHOOK_PORT="8787"
QQ_ASSISTANT_WEBHOOK_HOST="127.0.0.1"
```

`QQ_ASSISTANT_SECRET` 是 Web 内部接口鉴权密钥，不是 QQ Bot 的 AppSecret。该值必须在 Web 服务和 QQ Worker 环境中保持一致。

个人 QQ 通道可以生成一个独立的用户级 QQ Webhook。它不复用平台登录 Token，也不暴露 QQ AppSecret；同一用户的多个空间可以共用。生成时默认读取当前公开请求的协议、域名和端口，自动拼接 Webhook 路径；`QQ_ASSISTANT_WEBHOOK_PUBLIC_URL` 只用于反向代理地址与浏览器地址不一致时的覆盖。空间自动化选择“通知 Webhook → 个人中心 QQ”后，Agent Worker 会直接调用这个地址，QQ Worker 校验地址并立即发送，不建立待发送消息队列。Webhook 地址需要使用 HTTPS 或内网地址，并在泄露后通过个人中心重新生成。

空间自动化也支持统一的 Webhook 通知事件。空间侧栏的“通知 Webhook”中可以保存、编辑、启用或删除自定义目标及 JSON 请求体模板；自动化只引用已启用的目标。模板只支持安全变量替换，例如 `{{content.text}}`、`{{content.markdown}}`、`{{source.automationName}}` 和 `{{run.status}}`，不执行脚本；自定义地址不会访问本机或内网。QQ 目标仍由 QQ Worker 转换为 QQ 私聊消息。

## 启动

手动运行：

```bash
yarn worker:qq
```

生产环境使用 PM2 时，`ecosystem.config.cjs` 中的 `almaren-chat-qq` 会启动 QQ Worker：

```bash
pm2 logs almaren-chat-qq
pm2 status
```

Web 服务、Agent Worker 和 QQ Worker 必须使用同一份代码、数据库和环境变量。修改 QQ 配置或 Worker 代码后，需要重启 QQ Worker。

## 排障

- Access Token 成功但没有回复：检查 `QQ_ASSISTANT_SECRET`、`QQ_ASSISTANT_INTERNAL_URL`、`QQ_AGENT_INTERNAL_URL` 和 Web 服务端口。
- Agent 消息没有回复：确认该 Agent 的 **接入 QQ Bot** 状态为“已连接”，并确认已经用 QQ 私聊过这个 Bot。
- 回复提示模型连接失败：检查服务端线上模型配置，不要检查浏览器 Ollama。
- 图片没有被识别：确认 QQ 图片 URL 是 HTTPS，并确认线上模型支持视觉输入。
- 多个 Agent 同时在线：每个 Agent 必须有独立 AppID；如果复用 AppID，Worker 会跳过重复绑定并在日志中提示。
- 重复处理同一事件：Agent 消息使用 `appId + eventId` 生成幂等消息 ID，Worker 和内部接口都会去重。
