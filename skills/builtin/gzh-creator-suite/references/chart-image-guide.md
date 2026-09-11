# 微信公众号专业图表配图绘制指南（10 类图表类型与 6 大视觉设计风格）

> 图表配图不仅是正文论据的高密度视觉化呈现，更是打破长文阅读疲劳、拉升文章专业质感与收藏率的关键武器。
> 本指南支持通过 AI 生图模型（工作区配置的图片模型或 Midjourney/SD）直接生成高质量配图，也支持作为矢量图代码指导。

---

## 一、10 大专业图表类型索引与适用场景

| # | 图表类型 | 英文名称 | 最佳适用场景 | 核心视觉特征 |
|---|---|---|---|---|
| 1 | **业务流程图** | Flowchart | 业务工作流、自动化流水线、逻辑决策树 | 起止椭圆、判断菱形、步骤圆角矩形、单向连线 |
| 2 | **系统架构图** | Architecture | 系统分层、模块解耦、前后端交互、技术栈蓝图 | 分层容器（Layered Containers）、数据总线、模块卡片 |
| 3 | **实体关系图** | ER Diagram | 数据库表结构设计、对象建模、多对多关联 | 实体框图、主外键标记、一对多关系连线 |
| 4 | **商业模式画布** | Business Model Canvas | 商业规划、价值主张、成本收益结构分析 | 9 宫格标准矩阵（核心伙伴、关键业务、价值主张等） |
| 5 | **用户旅程地图** | User Journey Map | 用户痛点分析、触点旅程、情绪曲线可视化 | 横向阶段时间轴、各阶段接触点卡片、上下起伏情绪波浪线 |
| 6 | **脑图与思维发散** | Mind Map | 知识体系梳理、发散性头脑风暴、类目清单 | 中心辐射型节点、多级分支发散、层级递进 |
| 7 | **竞品对比矩阵** | Competitive Analysis | 竞品横评、功能打分、四象限定位 | 功能对照表、雷达多维矩阵、定位象限图 |
| 8 | **SWOT 战略图** | SWOT Analysis | 组织战略定位、优劣势评估、内外部环境分析 | 2×2 四象限矩阵（优势 S、劣势 W、机会 O、威胁 T） |
| 9 | **产品演进路线图** | Product Roadmap | 版本里程碑迭代、季度技术规划、长期时间线 | 横向时间轴、泳道甘特图、里程碑旗帜标志 |
| 10 | **组织与团队架构** | Org Chart | 汇报关系、岗位权责矩阵、分工协同网络 | 树状层级派生、头像姓名卡片、虚实汇报连线 |

---

## 二、6 大商业视觉风格与提示词前缀库

针对公众号移动端视觉特点，提供 6 种可直接复用的专业设计风格词库：

### 1. blueprint 蓝图工程风（默认推荐：极客/技术架构首选）
- **视觉气质**：严谨工程图纸、极高科技专业感、线条克制清晰。
- **配色规范**：暖白/米灰底色（`#FAF8F5`）配合浅网格线；主色工程蓝（`#2563EB`）、深石板灰（`#334155`）、海军蓝（`#1E3A5F`）、淡蓝填充（`#BFDBFE`）。
- **英文提示词前缀模板**：
```text
A precise technical blueprint-style {chart_type} diagram.
Background: Off-white (#FAF8F5) with subtle technical grid lines.
Colors: Engineering Blue (#2563EB), Deep Slate (#334155), Navy (#1E3A5F), Light Blue (#BFDBFE).
Line art with clean geometric shapes, dimension lines, precise crisp connections.
Thin borders, subtle micro-shadows for depth. Professional engineering architectural drawing feel.
ALL text, labels, and annotations in the image MUST be in Chinese (Simplified Chinese, 中文).
Technical terms (e.g. AI, API, SQL, HTTP, Node, Docker) may remain in English.
No photography, no realistic human elements, no heavy gradients, no glossy 3D effects.
```

### 2. notion 简约极简风（万能百搭：观点/教程/方法首选）
- **视觉气质**：黑白灰素雅、现代 SaaS 设计感、高信息密度且呼吸通透。
- **配色规范**：纯白底色（`#FFFFFF`）配合淡点阵；文字深炭黑（`#37352F`）、卡片边框浅灰（`#E3E2E0`）、品牌蓝点缀（`#2383E2`）。
- **英文提示词前缀模板**：
```text
A clean minimal {chart_type} diagram in iconic Notion aesthetic style.
Background: Pure crisp white (#FFFFFF) with subtle delicate dot grid.
Colors: Dark text (#37352F), subtle thin borders (#E3E2E0), accent blue (#2383E2), light card fills (#F7F7F5).
Clean rectangular shapes with smooth rounded corners, thin 1px sharp borders.
Generous whitespace, geometric grid alignment, information-dense yet perfectly organized and readable.
ALL text, labels, and annotations in the image MUST be in Chinese (Simplified Chinese, 中文).
```

### 3. sketch-notes 手绘视觉笔记风（轻松亲切：个人经验/脑图/旅程首选）
- **视觉气质**：白板手绘涂鸦、暖心亲和、视觉思考手账感。
- **配色规范**：暖白纸张质感（`#FFF8F0`）；陶土红（`#C0562F`）、森林绿（`#2F7A5C`）、圆珠笔深灰（`#2D3748`）、琥珀黄（`#F6AD55`）。
- **英文提示词前缀模板**：
```text
A hand-drawn sketch-notes style {chart_type} diagram.
Background: Warm off-white (#FFF8F0) with subtle recycled paper texture.
Colors: Warm organic tones - terracotta (#C0562F), forest green (#2F7A5C), navy pen (#2D3748), amber highlight (#F6AD55).
Marker-style thick outlines, organic hand-drawn lines, doodle-style minimalist icons, sticky-note cards.
Friendly hand-drawn visual thinking feel.
ALL text, labels, and annotations in the image MUST be in Chinese (Simplified Chinese, 中文).
```

### 4. corporate 商务正装风（严肃重磅：研报/商业画布/SWOT首选）
- **视觉气质**：麦肯锡/高盛研报质感、董事会提案级严谨度、稳重投资级。
- **配色规范**：纯白底色、深海蓝顶部条（`#1E3A5F`）、尊贵雅金（`#C5A55A`）、碳素灰（`#4A4A4A`）。
- **英文提示词前缀模板**：
```text
A professional corporate-style {chart_type} diagram for executive business presentation.
Background: Crisp clean white (#FFFFFF) with refined navy (#1E3A5F) header structure.
Colors: Navy (#1E3A5F), Muted Gold (#C5A55A), Charcoal (#4A4A4A), Platinum Silver (#B0B0B0).
Sharp geometric alignment, gold accent dividers, executive dashboard feel, institutional research grade.
ALL text, labels, and annotations in the image MUST be in Chinese (Simplified Chinese, 中文).
```

### 5. dark-atmospheric 科技暗黑霓虹风（极客/前沿AI/路线图首选）
- **视觉气质**：深邃太空感、微光发光连线、赛博未来感。
- **配色规范**：极夜黑背景（`#0A0A0B`）；荧光青（`#00F5FF`）、电光紫（`#A855F7`）、霓虹亮粉（`#F472B6`）。
- **英文提示词前缀模板**：
```text
A dark atmospheric {chart_type} diagram with glowing luminous neon cyber aesthetics.
Background: Deep cosmic dark (#0A0A0B) with faint cyber grid overlay.
Colors: Neon cyan (#00F5FF), electric purple (#A855F7), hot pink (#F472B6), amber glow (#FBBF24).
Glowing delicate connection lines, luminous card borders, high-contrast futuristic tech UI dashboard feel.
ALL text, labels, and annotations in the image MUST be in Chinese (Simplified Chinese, 中文).
```

### 6. watercolor 清新水彩风（生活/人文/情感类首选）
- **视觉气质**：温柔晕染、艺术手作感、舒缓自然。
- **配色规范**：奶油白底（`#FEFCF8`）；淡玫瑰粉（`#FBBFCA`）、天水蓝（`#A3D5FF`）、鼠尾草绿（`#A7F3D0`）。

---

## 三、生图尺寸与工作区落地规范

在微信公众号文章中嵌入图表时，尺寸需遵循移动端适配原则：
1. **正文标准配图**：采用 **16:9**（1024×576 或 1280×720）或 **3:2**，横向展开，上下不会过多挤占垂直屏高。
2. **正方形局部聚焦图**：采用 **1:1**（1024×1024），适合单点矩阵或复杂思维导图局部。
3. **交付位置**：通过 `generate_images` 生成后，落入工作区 `assets/` 目录，并在 `article.md` 中按 Markdown 标准语法进行图文嵌入：`![业务架构拓扑图](assets/architecture-blueprint.png)`。
