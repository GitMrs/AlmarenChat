# 空间脚本 Linux 沙箱说明

本文档说明空间自动化直接执行 Python/Node.js 脚本时的安全边界、平台差异、部署要求与排障方式。

## 适用范围

空间自动化的 `SCRIPT_ANALYSIS` 和 `SCRIPT_DIRECT` 模式都通过 `lib/space-script-runner.mjs` 执行工作区中的 `.py`、`.js`、`.mjs` 或 `.cjs` 文件。

不同平台采用不同策略：

| 运行平台 | 执行方式 | 预期用途 |
| --- | --- | --- |
| Linux | 强制通过 Bubblewrap (`bwrap`) 执行 | 生产服务器 |
| macOS | 直接在当前用户下执行 | 本地开发 |
| Windows | 直接在当前用户下执行 | 本地开发 |

Linux 是 fail-closed：如果 `bwrap` 未安装、不可执行或系统不允许创建所需命名空间，脚本执行会失败，不会退回宿主机直接运行。macOS 和 Windows 的直接执行不构成安全沙箱，只适用于可信开发环境。

## Linux 隔离边界

Bubblewrap 调用由 `lib/linux-bubblewrap.mjs` 统一构造，空间脚本和 Skill Runner 共用这套 Linux 配置。

### 文件系统

- 当前空间工作区以可写方式挂载到 `/workspace`，并作为脚本工作目录。
- 脚本必须位于当前工作区内；执行前会通过规范化路径和 `realpath` 阻止 `..` 路径穿越与符号链接逃逸。
- `/usr`、`/bin`、`/lib`、`/lib64` 和 `/usr/local` 等运行时目录只读挂载。
- `/tmp` 使用独立的内存临时文件系统，`HOME` 指向沙箱内的 `/tmp/home`。
- 宿主用户目录、项目源码、其他空间工作区、SSH 密钥和未挂载的系统路径在沙箱内不可见。
- 脚本可以修改或删除当前 `/workspace` 内的文件，因此工作区内容仍应视为该脚本可完全控制的数据。

### 进程与权限

- 使用 `--unshare-all` 隔离用户、PID、IPC、UTS、挂载和网络命名空间。
- 使用 `--cap-drop ALL` 移除 Linux capabilities。
- 使用 `--new-session` 和 `--die-with-parent`，避免脚本脱离执行进程长期驻留。
- 异步执行超时时会向整个进程组发送终止信号，而不是只终止入口进程。

### 网络

当前配置使用 `--unshare-net`，空间脚本不能访问公网、宿主回环地址或局域网服务。

这意味着抓取网页、调用第三方 API、连接远程数据库等脚本会在 Linux 生产环境失败。需要联网的自动化应优先使用平台受控联网能力；若未来允许脚本联网，应增加显式的自动化权限字段和审计记录，不能通过删除全局断网配置直接开放。

### 环境变量

- `--clearenv` 清除宿主进程环境，服务器的 API Key、数据库连接和部署凭据不会自动进入脚本。
- 沙箱只设置固定运行变量：`HOME`、`TMPDIR`、`PATH`、`LANG`、`NODE_ENV`、`PYTHONIOENCODING`、`PYTHONDONTWRITEBYTECODE` 和 `WORKSPACE_PATH`。
- 自动化运行时可以显式注入执行级变量，例如 `SPACE_AUTOMATION_ID`、`SPACE_AUTOMATION_EXECUTION_ID` 和 `SPACE_AUTOMATION_RECEIPTS_PATH`。
- 固定运行变量不能被调用方覆盖，变量名和变量值中的非法字符会被拒绝。

## 执行限制

- 默认超时为 60 秒，调用方可调整，但最大不超过 180 秒。
- 标准输出和错误输出返回给运行时前会截断，默认上限为 30,000 字符。
- Bubblewrap 负责命名空间与文件系统隔离，不提供虚拟机级隔离，也不单独限制 CPU 和内存。生产环境仍应通过 systemd、容器或进程管理器为整个 Worker 设置资源上限。
- 沙箱共享宿主 Linux 内核；应持续安装内核和 Bubblewrap 安全更新。
- Python 包和 Node.js 包只有位于沙箱可见的只读系统目录或当前工作区时才能加载。依赖宿主用户目录中的包会失败。

## 服务器部署检查

检查 Bubblewrap 是否安装：

```bash
command -v bwrap
bwrap --version
```

Ubuntu/Debian 安装命令：

```bash
sudo apt update
sudo apt install -y bubblewrap
```

执行最小可用性测试：

```bash
bwrap \
  --ro-bind /usr /usr \
  --dev /dev \
  --proc /proc \
  --unshare-all \
  --die-with-parent \
  -- /usr/bin/true
echo $?
```

退出码为 `0` 表示当前部署用户可以启动沙箱。检查命令必须使用运行 Worker 的同一个 Linux 用户执行，因为 root、登录用户和进程管理器用户的权限可能不同。

Debian/Ubuntu 如果出现 `Operation not permitted`，检查非特权用户命名空间：

```bash
sysctl kernel.unprivileged_userns_clone
```

通常应返回：

```text
kernel.unprivileged_userns_clone = 1
```

修改内核安全策略前应结合服务器基线评估；不要为了让脚本运行而给 Worker 增加 root 权限。

## 常见故障

### `Linux bubblewrap 不可用`

`bwrap` 不在 `/usr/bin/bwrap`、`/bin/bwrap` 或 `/usr/local/bin/bwrap`，或者运行 Worker 的用户没有执行权限。安装 Bubblewrap并确认实际路径与权限。

### `Operation not permitted`

服务器、容器或云主机禁用了用户命名空间。先使用部署用户执行最小可用性测试，再检查内核参数、容器 seccomp/AppArmor 配置和宿主平台限制。

### 本地正常，Linux 上无法联网

这是当前设计行为。macOS/Windows 本地执行沿用宿主网络，而 Linux 生产沙箱强制断网。

### 本地正常，Linux 上找不到模块

依赖可能安装在宿主用户目录、项目目录或未挂载的虚拟环境中。将必要依赖安装到沙箱可见的系统运行时，或把可审计的依赖随脚本放入当前工作区。

## 代码与测试入口

- `lib/space-script-runner.mjs`：脚本路径校验、解释器选择、超时、输出限制和平台分流。
- `lib/linux-bubblewrap.mjs`：Linux Bubblewrap 参数与环境变量策略。
- `worker/runtime/sandbox-runner.mjs`：Skill Runner 对共享 Bubblewrap 配置的调用。
- `lib/linux-bubblewrap.test.mjs`：隔离参数、挂载方式和环境变量保护测试。
- `worker/runtime/sandbox-runner.test.mjs`：在支持沙箱的系统上验证密钥隔离、越界写入、断网和超时终止。

运行相关测试：

```bash
node --test \
  lib/linux-bubblewrap.test.mjs \
  worker/runtime/sandbox-runner.test.mjs \
  worker/runtime/space-automation-runtime.test.mjs
```

在不支持 `bwrap` 或 macOS Seatbelt 的开发机上，真实沙箱测试会跳过；参数测试和空间自动化回归仍会执行。生产发布前应至少在与服务器一致的 Linux 环境运行一次完整测试。
