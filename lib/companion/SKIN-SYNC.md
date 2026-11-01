# Nari / Yume 皮肤同步与本地改动记录

本文用于以后与 <https://nariyume.com/app/> 重新对齐资源。最近一次同步日期为 **2026-11-01**。这是本地项目的维护记录，不是官网的版本或授权声明。

## 本次结论

下载并解包了官网公开索引中的 8 个 HD 资源包。比较确认：**模型和贴图有更新，现有动作曲线没有变化**。官网两处额外的 `Nari_anim_09` 文件，是本地基础资源中已有的共用动作，不算新动作。

项目已同步部分服装骨骼、二进制、贴图及贴图索引；没有更改角色核心性格、聊天模型、音色或互动触发逻辑。官网 v2 台词的 Fish 预录库曾单独生成，后按用户要求删除，**当前不保留、不启用该 v2 语音库**。原有点击、拖动、入场和皮肤专属语音继续使用。

详细的本次变更和验证记录见 [2026-11-01 同步记录](./UPSTREAM-UPDATE-20261101.md)。

## 对比基线

[2026-11-01-baseline.json](./upstream/2026-11-01-baseline.json) 保存：

- 8 个官网资源包的文件名、SHA-256 和独立动作文件数。
- 10 个本地皮肤配置：两位角色各包含经典原版、猫耳原版和三套服装。
- 696 个本地资源及相关配置文件的路径、字节数和 SHA-256。

基线是**本次同步后本地状态**，包括保留的本地差异，不表示全部文件与官网一致，也不表示做过实际画面验收。它不依赖临时下载目录，建议随代码保存。

不能只比较压缩包文件名：包重新压缩、目录调整或单张贴图修正，都可能改变包哈希。应解包后分别比较动作、骨骼、二进制、物理、姿态、贴图和索引；JSON 先按结构比较，再判断内容差异。

## 角色和皮肤对应关系

模型资源使用 Nari / Yume 名称，产品中的聊天角色为 Sunny / Cora；不要因为名称不同而修改人设或声音。

|角色|本地皮肤 ID|本地资源目录|2026-11-01 处理|
|---|---|---|---|
|Nari / Sunny|`original`|`public/companion/models/nari/`|保留经典无猫耳原版|
|Nari / Sunny|`original-ears`|`public/companion/skins/nari/original-ears/`|现有模型保留|
|Nari / Sunny|`sakura-streetwear`|`public/companion/skins/nari/sakura-streetwear/`|对齐清单，补调校路径；模型和动作未作实质替换|
|Nari / Sunny|`rose-regalia`|`public/companion/skins/nari/rose-regalia/`|同步刚性部件配置及资源清单|
|Nari / Sunny|`sakura-reverie`|`public/companion/skins/nari/sakura-reverie/`|同步骨骼、二进制、手腿/皮肤/衣料贴图；贴图索引 26 → 34 项|
|Yume / Cora|`original`|`public/companion/models/yume/`|保留经典无猫耳原版及本地适配|
|Yume / Cora|`original-ears`|`public/companion/skins/yume/original-ears/`|同步差异贴图，补齐共用动作文件|
|Yume / Cora|`azure-streetwear`|`public/companion/skins/yume/azure-streetwear/`|同步差异贴图|
|Yume / Cora|`azure-reverie`|`public/companion/skins/yume/azure-reverie/`|同步骨骼、二进制及配套贴图|
|Yume / Cora|`sapphire-nocturne`|`public/companion/skins/yume/sapphire-nocturne/`|同步骨骼、二进制及配套贴图，补齐共用动作文件|

官网原版包含猫耳相关资源，因此上游 `original` 包主要与本地 `original-ears` 对齐比较。不能直接覆盖本地经典 `original`，否则可能改变现有外观与渲染适配。

## 本地适配必须保留

### Nari 混合服装的目录和动作映射

官网部分 Nari 服装包使用 Yume 骨骼目录，同时另有 Nari 身份、头部或贴图目录。不能把整个包当成单一 Yume 角色，也不能遇到 `Nari/` 已存在就直接重命名目录。

下载脚本会合并两目录，统一骨骼、物理和姿态引用到 `Nari/`，遇到同名目标文件不直接覆盖。骨骼 JSON 内的 `bin` 文件名也必须同步修改。

混合服装中的动作文件保留 `Yume_*` 名称。`catalog.ts` 使用 `nariHybridMotionPaths` 将 Nari 的逻辑动作 ID 映射到这些真实资源。不能批量替换所有 Yume 字符串，尤其不能改掉动作文件名。

### 贴图索引与模型必须成套同步

模型网格的 `texture` 是数组下标，`catalog.ts` 中 `textures` 的**顺序有意义**，不是文件集合。换骨骼后只补文件、不改数组，会让网格引用错误贴图。

Nari 梦境服装当前包含 34 个贴图槽位，有两个槽位引用同一占位文件，这是官网清单的结构，不能排序或去重。同步时同时核对：

- `catalog.ts` 的运行时贴图数组；
- 皮肤目录中的 `manifest.index.json`；
- `skins-manifest.json`；
- 模型 JSON、二进制和真实文件。

### 默认参数、物理和互动配置

保留 `nativeDefaults` 的服装选择、耳朵及本地调校参数，以及角色的 `physicsWindSettings`。这些设置不一定能从官网包完整推导。

`catalog.ts` 的 `interaction` 包含本地换装台词、入场/点击/拖动台词、粒子符号和聊天氛围 `promptHint`。它们不是模型贴图的一部分。当前皮肤提示只补充服装意象，不覆盖 Sunny / Cora 的核心人格。

`behaviors/nari.ts`、`behaviors/yume.ts`、`voice.ts`、`voice-dataset.json` 和已有音频为另一组维护对象。换装资源更新不自动意味着台词、触碰部位规则或配音更新；如需调整，应单独确认事件 → 动作/表情 → 字幕/音频的绑定。

## 下次同步流程

1. 记录 `git status`，备份将改动的 `public/companion/skins/` 与配置文件。保留当前基线，不先覆盖。
2. 获取官网页面实际引用的公开资源清单。目前索引为 <https://nariyume.com/testing/models/index.json>，以后路径可能变化，应从当期页面核对。
3. 下载到新的临时目录；保存日期、原始清单、资源包文件名及 SHA-256。只下载公开可访问资源，不在文档或 Git 中保存临时解包密钥、会话或账号凭据。
4. 解包后按角色和皮肤匹配。先消除本地目录归一化、经典无猫耳版本等已知差异，再列出真正新增、变化、删除的文件。不能仅凭包名变化认定新增动作。
5. 分别判断：动作曲线是否改变；骨骼/二进制是否配套；贴图槽位是否改变；当前渲染器是否支持新字段；哪些是本地定制。未知字段不能默认认为已有支持。
6. 仅同步确认需要的皮肤文件与配置。保留原有经典原版、互动规则和音色；不要直接重跑旧脚本整目录覆盖。
7. 完成下面的验证与浏览器验收，再部署代码和资源。将结果写入新的日期记录，并生成新基线；不要覆盖旧日期基线。

## 脚本、验证和画面验收

下载入口为 `scripts/download-and-unpack-all-skins.mjs`。2026-11-01 已修复混合目录合并、模型引用归一化、5 个资源包地址及缓存命名。**它仍是固定地址脚本，不会自动发现官网更新**，并且解包会重建目标皮肤目录。下次先核对其 URL、输出目录、代理地址以及 `--refresh` 行为，再决定是否运行。

模型检查：

```bash
node --test lib/companion/motion.test.mjs lib/companion/skin-assets.test.mjs
```

这些测试验证资源路径、贴图顺序及索引、动作/模型数值等，不等同于 GPU 实际渲染、视觉效果或音频内容验收。

浏览器至少检查：经典原版与猫耳版来回切换、每套更新服装、待机/说话/转头/眨眼/表情、手腕/膝盖/服装接缝/饰品遮挡、拖动和口型，以及 PC 与 H5 的构图和性能。聊天/界面测试若受过时 mock 阻塞，应记录具体失败，不能报告为全部通过。

## 部署和资料保存

当前 `.gitignore` 忽略 `public/**/*`，`git pull` 不会更新模型或音频。需同步代码及实际变化的资源目录，之后按项目部署方式构建、重启并刷新页面检查。

本次资源包、更新前备份和比较详情曾位于 `/tmp/almaren-nariyume-audit-20261101/`，增量包位置见日期记录。临时目录可能被清理；长期追踪以本文、日期记录和 Git 中的 JSON 基线为准，原始二进制如需留档应另行保存。
