import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { feishuBinary, FEISHU_CLI_VERSION } from './feishu-cli.mjs';
import { macosSandboxProbeArgs } from './feishu-macos.mjs';

const execute = promisify(execFile);

export async function checkFeishuRuntime({ platform = process.platform, binary = feishuBinary(), run = execute } = {}) {
  const supported = ['linux', 'darwin', 'win32'].includes(platform);
  if (!supported) return { platform, ready: false, expectedVersion: FEISHU_CLI_VERSION, cli: { status: 'unsupported', version: null, message: '当前支持 Linux、macOS 和 Windows' }, sandbox: { status: 'unsupported', message: '当前系统暂不支持' } };
  // Only inspect versions/runtime prerequisites; never initialize config or access login state.
  const env = {};
  for (const key of ['PATH', 'SystemRoot', 'WINDIR', 'LANG']) if (process.env[key]) env[key] = process.env[key];
  const options = { timeout: 5000, maxBuffer: 16 * 1024, windowsHide: true, shell: false, env };
  const [cli, sandbox] = await Promise.all([
    (async () => {
      try {
        const { stdout } = await run(binary, ['--version'], options);
        const version = stdout.match(/\bv?(\d+\.\d+\.\d+(?:-[\w.-]+)?)(?:\+[\w.-]+)?\b/)?.[1] || null;
        return { status: version === FEISHU_CLI_VERSION ? 'ready' : 'mismatch', version, message: version === FEISHU_CLI_VERSION ? '已安装，版本匹配' : `版本不匹配，需要 ${FEISHU_CLI_VERSION}` };
      } catch (error) {
        return { status: error.code === 'ENOENT' ? 'missing' : 'error', version: null, message: error.code === 'ENOENT' ? '尚未安装飞书 CLI' : 'CLI 无法运行或检测超时，请检查安装文件与执行权限' };
      }
    })(),
    (async () => {
      if (platform === 'win32') return { status: 'directory', message: 'Windows 目录分离模式' };
      if (platform === 'darwin') {
        try {
          await run('/usr/bin/sandbox-exec', macosSandboxProbeArgs(), options);
          return { status: 'ready', message: 'macOS 系统沙箱可用，执行时使用独立凭据存储' };
        } catch (error) {
          return { status: error.code === 'ENOENT' ? 'missing' : 'error', message: 'macOS 系统沙箱不可用，请联系管理员检查服务运行环境' };
        }
      }
      try {
        await run('/usr/bin/bwrap', ['--version'], options);
        await run('/usr/bin/bwrap', ['--unshare-user', '--unshare-pid', '--ro-bind', '/', '/', '--', '/usr/bin/true'], options);
        return { status: 'ready', message: 'bubblewrap 与用户命名空间可用' };
      } catch (error) {
        return { status: error.code === 'ENOENT' ? 'missing' : 'error', message: error.code === 'ENOENT' ? '缺少 bubblewrap 隔离组件，请联系管理员检查服务端环境' : 'bubblewrap 无法运行，请联系管理员检查服务端环境' };
      }
    })(),
  ]);
  return { platform, expectedVersion: FEISHU_CLI_VERSION, cli, sandbox, ready: cli.status === 'ready' && ['ready', 'directory'].includes(sandbox.status) };
}
