# 公共模型请求

`model-fetch.mjs` 的 `createModelFetch` 是服务端模型 HTTP 请求的共同入口。`model-client.ts`、Worker 和 Pi 使用该函数，但分别保留自己的 SDK、预算、超时与会话管理。

| 调用入口 | 接入位置 |
| --- | --- |
| QQ 小伴、QQ Agent、网页小伴、单 Agent、空间普通回复 | `model-client.ts` |
| 模型列表、连接测试、记忆提取、归档摘要、热点提炼、研习、Studio 协调者 | `model-client.ts` |
| 后台原生 Worker、多人讨论与接力 | `worker/runtime/model-client.mjs` |
| 空间 Pi、Pi Worker（含内部压缩请求） | `lib/pi-runtime/session-core.mjs` 的 Provider |
| Studio 宿主与 Docker Pi | `lib/coding-agents/extensions/model-network.ts` 的 `custom` Provider |
| 图片生成（空间 Pi 与 Worker） | `lib/media/image-generation.mjs` |
| Fish 语音合成 | `lib/tts/fish-tts.mjs`，保留原有代理优先与超时设置 |

默认直连优先，直连发生网络连接、TLS 或等待响应超时等传输错误时，尝试一次可用代理。代理复用 `lib/web/proxy.ts` 的检测：先读取 `HTTPS_PROXY` / `HTTP_PROXY` / `ALL_PROXY`（兼容小写），否则探测本机常用端口 `7890`、`7897`、`10809`、`10808`。服务器需有其自身可用的代理，本机代理不会自动供远端服务器使用。

收到任何 HTTP 响应后不因状态码切换代理，错误继续交给 SDK 和调用方处理。SDK 原有重试规则保留。响应正文或流式内容在返回后中断时，不在网络适配层换线路重发；用户取消请求也不会触发代理重试。Worker 已输出流式片段后中断会返回 `MODEL_STREAM_INTERRUPTED`，不会再次重试整轮请求。

模型请求保留原有完整响应等待时间（默认 10 分钟），不套用普通网页请求的 3.2 秒直连等待时间。调用方仍可通过 `timeoutMs`、`maxRetries`、`prefer` 覆盖，例如确实需要强制直连时使用 `prefer: 'direct-only'`。

Studio 子进程只转发明确的代理环境变量，不继承全部宿主环境。Docker 额外挂载三个固定的只读传输源码文件（扩展、`model-fetch.mjs`、`proxy.ts`），从已安装 Pi 的依赖中解析 HTTP 库，不挂载项目根目录或 `.env`。这些挂载在新容器启动时生效，无需为本次变更重建镜像；已运行的 Studio 进程需结束后重新启动。

容器中的 `127.0.0.1` 是容器自身，不能把宿主回环代理地址原样当成可用代理。Docker 模式需配置容器可达的 `HTTPS_PROXY`，并由管理员保证该代理的监听地址和访问限制适当；代码不自动暴露宿主代理端口，也不改变容器网络隔离。

该兼容不改变浏览器直连 Ollama、本地 embedding/Whisper、Edge TTS WebSocket 的请求路径。Edge TTS 已有独立的直连/代理机制。普通网页抓取仍保留原有的代理回退策略。
