# AlmarenChat

AlmarenChat 是一个基于 Next.js、Prisma 和 SQLite 的 AI 工作与陪伴平台，包含 Agent 单聊、个人小伴、QQ Bot、空间任务和受治理的自动化连接器。

当前功能文档：

- [AI 模型与运行方式](docs/ai-models.md)
- [网页小伴](docs/personal-assistant.md)
- [QQ 小伴](docs/qq-assistant.md)
- [个人小伴记忆规则](docs/personal-assistant-memory.md)
- [Agent Runtime](docs/agent-runtime.md)
- [空间连接器](docs/space-connectors.md)
- [空间自动化验收](docs/space-automation-acceptance.md)

## 功能特性

### 核心功能
- **智能聊天**：支持与AI Agent进行自然语言对话
- **实时通信**：基于WebSocket的实时消息传输
- **多用户支持**：支持多用户同时在线聊天
- **消息历史**：完整的聊天记录保存和查看

### AI Agent功能
- **Agent商店**：浏览和选择各种AI助手
- **自定义Agent**：创建个性化的AI助手
- **智能对话**：支持平台模型、在线兼容 API 和浏览器本地 Ollama
- **上下文理解**：AI能够理解对话上下文

### 用户界面
- **响应式设计**：支持桌面端和移动端
- **暗黑模式**：支持深色主题切换
- **现代化UI**：基于Tailwind CSS的美观界面
- **流畅动画**：使用Motion库实现平滑过渡效果

## 技术栈

### 前端技术
- **React 19**：现代化的前端框架
- **TypeScript**：类型安全的JavaScript超集
- **Next.js**：页面和 API 路由
- **Tailwind CSS**：实用优先的CSS框架
- **Lucide React**：美观的图标库
- **React Markdown**：Markdown渲染支持

### 后端技术
- **Prisma + SQLite**：用户、消息、任务和记忆数据
- **OpenAI 兼容接口**：线上模型与本地 Ollama
- **QQ Bot Worker**：QQ 私聊、流式回复和提醒投递

### 开发工具
- **ESBuild**：超快的JavaScript打包器
- **tsx**：TypeScript执行环境
- **PostCSS**：CSS处理工具

## 项目结构

```
AlmarenChat/
├── app/                     # Next.js 页面与 API 路由
├── components/              # React UI 组件
├── lib/                     # 模型、记忆、连接器和运行时逻辑
├── prisma/                  # Schema 与数据库迁移
├── worker/                  # Agent、QQ 和空间后台 Worker
├── public/                  # 静态资源与上传文件
├── package.json
└── deploy-pm2.sh            # 生产部署入口
```

## 安装和运行

### 环境要求
- Node.js 18+
- npm 或 yarn
- 线上模型密钥（按部署环境配置）

### 安装步骤

1. **克隆项目**
   ```bash
   git clone <repository-url>
   cd AlmarenChat
   ```

2. **安装依赖**
   ```bash
   npm install
   ```

3. **配置环境变量**
   复制 `.env.example` 文件为 `.env`，按需填写数据库、模型、QQ 和连接器密钥：
   ```bash
   cp .env.example .env
   ```
   编辑`.env`文件：
   ```
   DATABASE_URL="file:./data/dev.db"
   ```

4. **启动开发服务器**
   ```bash
   npm run dev
   ```

5. **访问应用**
   打开终端显示的本地地址。生产部署默认使用 `PORT=8001`，可参考 `deploy-pm2.sh`。

### 生产构建

```bash
npm run build
npm start
```

## 使用说明

### 登录系统
1. 打开应用后进入登录界面
2. 输入邮箱和密码（演示版本可任意输入）
3. 点击登录按钮进入主界面

### 聊天功能
1. **创建聊天**：在聊天列表中点击"+"按钮
2. **选择联系人**：从联系人列表中选择聊天对象
3. **发送消息**：在聊天界面输入消息并发送
4. **AI对话**：选择Agent进行AI对话

### Agent管理
1. **浏览Agent**：在设置中打开Agent商店
2. **选择Agent**：点击感兴趣的Agent查看详情
3. **开始聊天**：点击"开始聊天"按钮
4. **创建自定义Agent**：点击"创建Agent"按钮

### 设置功能
- **主题切换**：在设置中切换深色/浅色主题
- **通知设置**：管理消息通知
- **隐私设置**：控制已读回执等隐私选项

## API 接口

- **POST** `/api/chat`：Agent 单聊流式回复
- **POST** `/api/assistant/messages`：网页小伴消息和本地 Ollama 准备请求
- **POST** `/api/uploads/images`：上传聊天图片
- **POST** `/api/internal/assistant/qq/messages`：QQ Worker 内部消息接口，需要内部密钥

## 开发说明

业务代码主要位于 `app/`、`components/`、`lib/`、`prisma/` 和 `worker/`。模型配置和 QQ/小伴运行规则见上方文档索引；修改数据库 Schema 后需要生成 Prisma Client 并执行对应迁移或升级脚本。

## 部署说明

### PM2 部署

```bash
ENV_FILE=.env.production PORT=8001 ./deploy-pm2.sh
pm2 status
pm2 logs almaren-chat
pm2 logs almaren-chat-worker
pm2 logs almaren-chat-qq
```

部署脚本会备份 SQLite、升级 Agent Runtime Schema、构建应用并启动 Web、Agent Worker 和 QQ Worker。

## 常见问题

### Q: 本地 Ollama 配置保存在哪里？
A: 保存在当前浏览器的 localStorage。它是 Agent 和小伴的默认配置，聊天时仍可切换回线上模型。详见 [AI 模型与运行方式](docs/ai-models.md)。

### Q: 如何修改端口号？
A: 启动时设置 `PORT`，例如 `PORT=8001 yarn start`；PM2 部署时设置 `PORT` 环境变量。

### Q: QQ 为什么不使用本地 Ollama？
A: QQ Worker 在服务端运行，只能调用线上模型；网页端 Agent 和小伴才支持浏览器直连 Ollama。详见 [QQ 小伴](docs/qq-assistant.md)。

## 贡献指南

1. Fork项目
2. 创建功能分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 创建Pull Request

## 许可证

本项目采用MIT许可证 - 查看 [LICENSE](LICENSE) 文件了解详情

## 联系方式

- 项目维护者：[Your Name]
- 邮箱：[your.email@example.com]
- 项目链接：[GitHub Repository]

## 更新日志

### v1.0.0 (2026-05-26)
- 初始版本发布
- 基础聊天功能
- AI Agent集成
- 响应式UI设计
- 暗黑模式支持
