# AlmarenChat

一个基于Web的智能通信工具，内置AI助手，支持Agent聊天和人机聊天。

## 功能特性

### 核心功能
- **智能聊天**：支持与AI Agent进行自然语言对话
- **实时通信**：基于WebSocket的实时消息传输
- **多用户支持**：支持多用户同时在线聊天
- **消息历史**：完整的聊天记录保存和查看

### AI Agent功能
- **Agent商店**：浏览和选择各种AI助手
- **自定义Agent**：创建个性化的AI助手
- **智能对话**：基于Google Gemini的AI对话能力
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
- **Vite**：快速的前端构建工具
- **Tailwind CSS**：实用优先的CSS框架
- **Lucide React**：美观的图标库
- **React Markdown**：Markdown渲染支持

### 后端技术
- **Express**：Node.js Web应用框架
- **Google Gemini AI**：先进的AI模型服务
- **WebSocket**：实时通信支持

### 开发工具
- **ESBuild**：超快的JavaScript打包器
- **tsx**：TypeScript执行环境
- **PostCSS**：CSS处理工具

## 项目结构

```
AlmarenChat/
├── src/
│   ├── components/          # React组件
│   │   ├── ActiveChatScreen.tsx    # 聊天界面
│   │   ├── AgentStoreScreen.tsx    # Agent商店
│   │   ├── ChatListScreen.tsx      # 聊天列表
│   │   ├── ContactsScreen.tsx      # 联系人列表
│   │   ├── LoginScreen.tsx         # 登录界面
│   │   └── SettingsScreen.tsx      # 设置界面
│   ├── lib/                 # 工具库
│   │   ├── agent.json       # Agent配置数据
│   │   └── utils.ts         # 工具函数
│   ├── App.tsx              # 主应用组件
│   ├── main.tsx             # 应用入口
│   ├── mockData.ts          # 模拟数据
│   └── types.ts             # TypeScript类型定义
├── server.ts                # Express服务器
├── package.json             # 项目配置
├── vite.config.ts           # Vite配置
└── tsconfig.json            # TypeScript配置
```

## 安装和运行

### 环境要求
- Node.js 18+
- npm 或 yarn
- Google Gemini API密钥

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
   复制`.env.example`文件为`.env`，并填入你的Google Gemini API密钥：
   ```bash
   cp .env.example .env
   ```
   编辑`.env`文件：
   ```
   GEMINI_API_KEY=your_api_key_here
   ```

4. **启动开发服务器**
   ```bash
   npm run dev
   ```

5. **访问应用**
   打开浏览器访问 `http://localhost:3000`

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

## API接口

### 聊天API
- **POST** `/api/chat` - 发送消息并获取AI回复
  - 请求体：`{ message, history, context }`
  - 响应：流式文本响应

## 开发指南

### 添加新组件
1. 在`src/components/`目录下创建新组件
2. 使用TypeScript编写组件逻辑
3. 使用Tailwind CSS进行样式设计
4. 在`App.tsx`中引入并使用

### 修改AI配置
编辑`server.ts`文件中的AI模型配置：
```typescript
const responseStream = await ai.models.generateContentStream({
  model: 'gemini-3.5-flash', // 修改使用的模型
  contents,
  config: {
    systemInstruction: context || 'You are a helpful AI assistant.',
  }
});
```

### 自定义样式
修改`tailwind.config.js`文件来自定义主题：
```javascript
module.exports = {
  theme: {
    extend: {
      colors: {
        primary: '#your-color',
      }
    }
  }
}
```

## 部署说明

### Docker部署
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build
EXPOSE 3000
CMD ["npm", "start"]
```

### 云平台部署
支持部署到以下平台：
- Vercel
- Netlify
- AWS Amplify
- Google Cloud Run

## 常见问题

### Q: 如何获取Google Gemini API密钥？
A: 访问 [Google AI Studio](https://makersuite.google.com/app/apikey) 获取API密钥。

### Q: 如何修改端口号？
A: 编辑`server.ts`文件中的`PORT`变量。

### Q: 如何添加新的AI模型？
A: 修改`server.ts`中的模型配置，并确保API密钥支持该模型。

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