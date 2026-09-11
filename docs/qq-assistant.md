# QQ 小伴

QQ 小伴由 `worker/qq-assistant.mjs` 运行，通过 QQ Bot Gateway 接收私聊和提醒事件，再调用站内内部接口生成回复。

## 模型与上下文

- QQ 始终使用服务端线上模型，不读取浏览器里的 Ollama 配置。
- 未启用账号自定义在线模型时，使用平台默认模型；启用后使用账号配置的在线 API。
- QQ 与网页小伴共用主聊天上下文、长期记忆、任务和提醒。
- QQ 消息通过 `Message.source = QQ` 标记，网页重新打开后可以看到同一时间线。

QQ 不能直接连接用户电脑上的 `127.0.0.1:11434`，因此不会使用本地 Ollama。网页端的线上 / 本地切换也不会影响 QQ。

## 能力

- 流式输出回复。
- 支持 QQ 可展示的标准 Markdown；避免 HTML、复杂表格和站内相对链接。
- 支持通过 QQ 菜单或消息场景启用联网搜索。
- 支持接收 QQ 图片并交给视觉模型分析；图片必须能通过 HTTPS 访问。
- 支持回复“完成了”“延后 10 分钟”等短指令处理已送达提醒。

## 配置

先在网页个人中心的 QQ 小伴设置中保存 QQ Bot 的 AppID 和 AppSecret。AppSecret 会在服务端加密保存，网页不会返回明文。

服务器环境变量：

```env
QQ_ASSISTANT_SECRET="至少 32 位的随机字符串"
QQ_ASSISTANT_INTERNAL_URL="http://127.0.0.1:8001/api/internal/assistant/qq/messages"
QQ_ASSISTANT_POLL_MS="5000"
```

`QQ_ASSISTANT_SECRET` 是 Web 内部接口鉴权密钥，不是 QQ Bot 的 AppSecret。该值必须在 Web 服务和 QQ Worker 环境中保持一致。

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

- Access Token 成功但没有回复：检查 `QQ_ASSISTANT_SECRET`、`QQ_ASSISTANT_INTERNAL_URL` 和 Web 服务端口。
- 回复提示模型连接失败：检查服务端线上模型配置，不要检查浏览器 Ollama。
- 图片没有被识别：确认 QQ 图片 URL 是 HTTPS，并确认线上模型支持视觉输入。
- 重复处理同一事件：检查数据库中的 `AssistantQQEvent`，Worker 会按事件 ID 去重。
