import { spawnSync } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { FEISHU_CLI_VERSION, feishuBinary } from '../lib/connectors/feishu-cli.mjs';
import { macosSandboxProbeArgs } from '../lib/connectors/feishu-macos.mjs';

if (!['linux', 'darwin', 'win32'].includes(process.platform)) throw new Error('平台飞书 CLI 当前支持 Linux、macOS 和 Windows');
if (process.platform === 'darwin' && spawnSync('/usr/bin/sandbox-exec', macosSandboxProbeArgs(), { stdio: 'inherit', shell: false, timeout: 5000 }).status !== 0) throw new Error('macOS 系统沙箱不可用，不能安全开启飞书 CLI；请检查服务运行环境');
if (process.platform === 'linux') {
  if (spawnSync('/usr/bin/bwrap', ['--version'], { stdio: 'inherit', shell: false }).status !== 0) throw new Error('请先安装 bubblewrap（Debian/Ubuntu: apt-get install bubblewrap），并允许服务使用非特权用户命名空间');
  if (spawnSync('/usr/bin/bwrap', ['--unshare-user', '--unshare-pid', '--ro-bind', '/', '/', '--', '/usr/bin/true'], { stdio: 'inherit', shell: false }).status !== 0) throw new Error('服务器不允许 bubblewrap 用户命名空间，不能安全开启飞书 CLI；请管理员配置运行环境');
}
const prefix = path.resolve('data/connectors/runtime');
mkdirSync(prefix, { recursive: true, mode: 0o700 });
const args = ['install', '--prefix', prefix, '--no-audit', '--no-fund', '--save-exact', `@larksuite/cli@${FEISHU_CLI_VERSION}`];
let executable = 'npm';
if (process.platform === 'win32') {
  // Execute npm's JS entry directly: npm.cmd needs a shell and breaks on spaced paths.
  const candidates = [process.env.npm_execpath, ...[path.dirname(process.execPath), ...(process.env.PATH || '').split(path.delimiter)].map(dir => path.join(dir, 'node_modules/npm/bin/npm-cli.js'))];
  const npmCli = candidates.find(file => file && path.basename(file) === 'npm-cli.js' && existsSync(file));
  if (!npmCli) throw new Error('找不到 npm-cli.js，请安装包含 npm 的 Node.js 后重试');
  executable = process.execPath;
  args.unshift(npmCli);
}
const install = spawnSync(executable, args, { stdio: 'inherit', shell: false });
if (install.status !== 0) process.exit(install.status || 1);
const verify = spawnSync(feishuBinary(), ['--version'], { stdio: 'inherit', shell: false });
if (verify.status !== 0) process.exit(verify.status || 1);
console.log('飞书 CLI 已安装。请在个人中心添加飞书连接器并授权；不会自动为聊天入口开启。');
