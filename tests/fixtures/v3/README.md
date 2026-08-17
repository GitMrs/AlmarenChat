# V3 Runtime Replay Fixtures

这里的七份 JSON 来自 `V3-REAL-MODEL-CHECKLIST.md` 中 01–07 场景的成功 Run，由 `tests/integration/v3-runtime-replay.test.mjs` 离线重放。

- 数据已经移除数据库 UUID、时间戳和本机绝对路径。
- 夹具保留用户输入、目标授权、任务、Coordinator 决策、关键事件、Manifest 和验收结果。
- `yarn v3:check` 会把每份夹具重放到临时 SQLite，并验证已验收的状态流转。
- 重放测试不读取 `dev.db`、不调用模型，也不产生模型费用。

只有完成一轮新的真实模型验收并确认结果正确后，才重新导出：

```bash
yarn v3:fixtures
```

导出命令默认读取 `DATABASE_URL` 指向的 SQLite 数据库；没有配置时读取项目根目录的 `dev.db`。
