# 微信公众号文本逻辑关系图渲染指南（6 大逻辑关系与自包含 SVG/HTML 规范）

> 文本逻辑关系图将复杂的长篇大论、繁琐的论据推导与抽象系统，转化为结构严谨、极具视觉冲击力的逻辑关系图。
> 本指南支持输出纯净、自包含的 HTML/SVG 矢量图代码，可在浏览器中直接预览、截图转成 PNG，或直接作为排版插图。

---

## 一、六大核心逻辑关系类型与视觉表征

| 逻辑关系类型 | 核心适用场景 | 关键视觉布局与节点设计 |
|---|---|---|
| **1. 递进关系** | 认知层层深入、技术能力升级、难度阶梯攀升 | **阶梯式 / 漏斗式排列**：节点从左向右或从上向下逐级增大，带有显性递进箭头与步长标记。 |
| **2. 流程关系** | 步骤顺序推进、SOP 执行标准、生命周期演进 | **线性单向流 / 蛇形流**：带序号圆形徽章（01, 02, 03），清晰的流向指示，前置条件与分支判定。 |
| **3. 循环闭环** | 飞轮效应、PDCA 迭代、数据回流闭环系统 | **环形环绕布局**：首尾无缝咬合的封闭圆环，动态箭头引导顺时针或逆时针流动。 |
| **4. 层次结构** | 组织架构、知识体系树、模块包含与派生关系 | **树形 / 倒金字塔 / 嵌套容器**：根节点居中置顶，子节点向下辐射展开，带有层级连线。 |
| **5. 对比关系** | 新旧范式颠覆、优劣得失评估、竞品横向对抗 | **双栏左右对称 / 上下镜像布局**：中轴线隔开，红绿/冷暖对照色标明对比维度。 |
| **6. 矩阵关系** | 四象限战略定位、二维坐标系归类、优先级筛选 | **四象限十字坐标网格**：X轴与Y轴定义明确变量，节点散布于不同象限并配说明。 |

---

## 二、双主题专业调色盘（Cursor 深黑底 + Claude 羊皮暖底）

为杜绝普通图表千篇一律的冷蓝与刺眼纯白，设计系统采用两大知名 AI 产品的经典视觉语言：

### 1. 深色暗调主题（默认推荐：科技感、极客高级感）
融合 Cursor 温暖深黑底色与 Claude 经典赭石强调色：
- 页面背景 `var(--bg-page)`: `#141413`（温润极夜黑）
- 容器卡片背景 `var(--bg-card)`: `#1a1a18`
- 节点填充主色 `var(--bg-node)`: `#1e1e1c` → `#282825` 细微渐变
- 节点边框 `var(--node-stroke)`: `#7a6e5e`（暖棕金）
- 核心强调高亮 `var(--node-stroke-accent)`: `#c96442`（Claude 专属陶土赭石）
- 主文字颜色 `var(--text-primary)`: `#faf9f5`（象牙暖白）
- 次要说明文字 `var(--text-secondary)`: `#b0aea5`（温润银灰）
- 连线与箭头 `var(--arrow-fill)`: `#8a8377`

### 2. 浅色典雅主题（知性人文、阅读舒适度最佳）
融合 Claude 羊皮纸温润底色与印刷级排版质感：
- 页面背景: `#f5f4ed`（经典羊皮纸底色）
- 卡片容器: `#faf9f5`（象牙白）
- 节点边框: `#8a7e6e`（沉稳暖灰）
- 核心文字: `#141413`（高对比度深碳黑）
- 重点强调: `#c96442`（赭石红）

---

## 三、自包含 HTML/SVG 代码生成模板规范

当为文章生成逻辑图时，必须遵循自包含代码结构（无需外部脚本，开箱即用）：

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>核心逻辑架构图</title>
  <style>
    :root {
      --bg-page: #141413;
      --bg-card: #1a1a18;
      --node-stroke: #7a6e5e;
      --accent: #c96442;
      --text-main: #faf9f5;
      --text-sub: #b0aea5;
      --line: rgba(138, 131, 119, 0.4);
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: var(--bg-page); color: var(--text-main); font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Segoe UI", sans-serif; padding: 24px; }
    .diagram-card { max-width: 800px; margin: 0 auto; background: var(--bg-card); border-radius: 12px; border: 1px solid rgba(122, 110, 94, 0.25); padding: 28px; box-shadow: 0 8px 24px rgba(0,0,0,0.3); }
    .diagram-title { font-size: 18px; font-weight: 600; color: var(--text-main); margin-bottom: 8px; display: flex; align-items: center; gap: 8px; }
    .diagram-title::before { content: ""; display: inline-block; width: 8px; height: 8px; background: var(--accent); border-radius: 50%; }
    .diagram-desc { font-size: 13px; color: var(--text-sub); margin-bottom: 24px; line-height: 1.6; }
    svg { width: 100%; height: auto; display: block; }
  </style>
</head>
<body>
  <div class="diagram-card">
    <div class="diagram-title">【逻辑关系标题】</div>
    <div class="diagram-desc">核心论点推导说明：清晰表达前置因果与递进流向。</div>
    <!-- 此处嵌入高质量的专业 SVG 矢量图形，节点文字全部使用中文，字号适中 -->
    <svg viewBox="0 0 740 320" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 1 L 10 5 L 0 9 z" fill="#8a8377" />
        </marker>
      </defs>
      <!-- 节点与连线精确绘制 -->
    </svg>
  </div>
</body>
</html>
```

### 规范红线
1. **文字必须凝练**：SVG 节点内部的文字标题严禁长篇大论，每个节点主文案控制在 **4–12 汉字以内**，副标题 ≤16 汉字。
2. **移动端宽度自适应**：SVG 必须设置全局 `viewBox`，不要写死不可缩放的绝对像素宽高，保证在手机屏幕上完整铺开、不溢出屏幕边界。
