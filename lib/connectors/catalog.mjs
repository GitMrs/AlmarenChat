/** @type {ReadonlyArray<{ id: string, name: string, category: string, description: string, url: string, authType: 'none' | 'bearer' | 'custom' }>} */
export const CONNECTOR_CATALOG = Object.freeze([
  { id: 'feishu-cli', name: '飞书', category: '办公', description: '让小伴和 Agent 协助处理飞书消息、文档、日历与多维表格。连接应用、授权账号，再选择使用入口。', url: 'connector:feishu-cli', authType: 'custom' },
  { id: 'http-mcp', name: '远程 HTTP MCP', category: '通用', description: '配置支持当前 HTTP MCP 客户端的服务地址，可使用 Token 或自定义请求头。', url: '', authType: 'bearer' },
  { id: 'local-http-mcp', name: '服务器本机 HTTP MCP', category: '自部署', description: '连接部署平台服务器上的 localhost / 127.0.0.1 服务，不是浏览器所在电脑。', url: 'http://localhost:3000/mcp', authType: 'none' },
]);
