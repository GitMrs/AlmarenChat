# CSV Skill 验收样例

这个目录是完整可执行 Skill 的首个固定验收资产，目前不接入生产 Worker，也不代表已经获得沙箱能力。

## 手工测试提示词

> 分析工作区中的 sales.csv，统计总销售额、各产品销售额、最近两个月环比变化和异常数据，在 outputs 下生成 analysis.md 和 report.html。本次不联网。

预期申请的权限：

- 读取当前空间
- 写入当前空间
- 运行 Python
- 禁止联网

预期入口参数：

```json
{
  "entrypoint": "analyze",
  "input": "sales.csv",
  "markdownOutput": "outputs/analysis.md",
  "htmlOutput": "outputs/report.html"
}
```

## 隔离执行验收

后续 Sandbox Runner 接入后，必须自动覆盖以下测试：

1. 正常执行生成两个非空产物。
2. 输入或输出使用 `../` 逃离工作区时拒绝执行。
3. 未授权联网时，运行环境无法连接公网。
4. 运行环境不能读取 Worker 的 API Key 或其他宿主机环境变量。
5. 超时后终止整个进程树。
6. 标准输出和错误输出超过上限时截断。
7. OS 沙箱后端不可用时失败关闭，不降级为普通 `spawn`。
