/** @type {ReadonlyArray<{ id: string, name: string, category: string, description: string, url: string, authType: 'none' | 'bearer' | 'custom' }>} */
export const CONNECTOR_CATALOG = Object.freeze([
  { id: 'feishu-cli', name: '飞书', category: '办公', description: '连接飞书，在对话中处理消息、文档、日历与多维表格。各入口独立开启。', url: 'connector:feishu-cli', authType: 'custom' },
  { id: 'personal-mail', name: '个人邮箱', category: '办公', description: '通过授权码连接 QQ、网易或 Gmail，只读搜索收件箱与邮件正文。各入口独立开启。', url: 'connector:personal-mail', authType: 'custom' },
  { id: 'http-mcp', name: '远程 HTTP MCP', category: '通用', description: '配置支持当前 HTTP MCP 客户端的服务地址，可使用 Token 或自定义请求头。', url: '', authType: 'bearer' },
  { id: 'local-http-mcp', name: '服务器本机 HTTP MCP', category: '自部署', description: '连接部署平台服务器上的 localhost / 127.0.0.1 服务，不是浏览器所在电脑。', url: 'http://localhost:3000/mcp', authType: 'none' },
]);
