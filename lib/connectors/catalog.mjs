/** @type {ReadonlyArray<{ id: string, name: string, category: string, description: string, url: string, authType: 'none' | 'bearer' | 'custom' }>} */
export const CONNECTOR_CATALOG = Object.freeze([
  { id: 'feishu-cli', name: '飞书 CLI', category: '办公', description: '官方飞书 CLI：完整业务命令、按需操作说明、应用与用户授权。需服务端安装 CLI，支持 Linux / Windows。', url: 'connector:feishu-cli', authType: 'custom' },
  { id: 'http-mcp', name: '远程 HTTP MCP', category: '通用', description: '配置支持当前 HTTP MCP 客户端的服务地址，可使用 Token 或自定义请求头。', url: '', authType: 'bearer' },
  { id: 'local-http-mcp', name: '服务器本机 HTTP MCP', category: '自部署', description: '连接部署平台服务器上的 localhost / 127.0.0.1 服务，不是浏览器所在电脑。', url: 'http://localhost:3000/mcp', authType: 'none' },
]);
