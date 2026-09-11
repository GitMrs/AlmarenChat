# 微信公众号 2.35:1 封面头图制作指南（分享安全区几何算法与提示词配方）

> 微信公众号封面是文章在信息流中被读者看见的第一眼，也是决定图文打开率的生死线。
> **最致命的行业认知陷阱**：横画幅设计的常规直觉是“左右分栏”（左边大标题，右边放配图）。但在微信生态里，**这种做法是 100% 的设计灾难**！

---

## 一、公众号封面会被裁切两次（核心几何原理）

公众号封面在微信生态内面临两种截然不同的展示场景：

| 显示场景 | 实际展示画幅 | 裁切机制与视觉结果 |
|---|---|---|
| **订阅号消息列表 / 展开文章顶部** | **完整 2.35:1 超宽横幅**（如 1175×500 或 900×383） | 完整展示全部画面、两翼背景与左右装饰。 |
| **转发到微信聊天 / 转发到朋友圈** | **正中央 1:1 正方形小缩略图** | **左右两翼被微信强行暴力裁剪！仅保留画布中央的 42.6% 宽度！** |

### 42.6% 中央安全区数学算法

以标准推荐画布 **1175 × 500 px**（2.35:1）为例：
```
|←────── 左翼 28.7% ──────→|←──── 中央安全区 42.6% ────→|←────── 右翼 28.7% ──────→|
       x: 0 ~ 337 px              x: 337 ~ 837 px               x: 837 ~ 1175 px
      （分享时彻底切掉）           （分享时唯一保留的 500×500）         （分享时彻底切掉）
```

- **真实惨案**：一个 12 字的大标题如果横向居中铺满全宽，分享到朋友圈后，左边切掉 3 个字，右边切掉 3 个字，中间只剩 6 个不知所云的残缺碎词。
- **铁律原则**：**所有主标题文字、主体形象（人物/Logo/核心物体）、决定性信息，必须全部严密锁定在中央 42.6%（x 337–837）的正方形区域内！**
- 左右两翼只允许放置背景氛围延伸、微弱颗粒质感、非必要辅助线条等丢弃后完全不影响阅读的装饰。

---

## 二、三大安全区版式库（分享安全性评级）

### 1. ★★★ 绝对安全：中央大字聚焦版（默认首选）
- **结构**：主标题 1–2 行居中，严格落在中央 42.6% 安全区内；两翼纯留白或浅淡柔光背景延伸。
- **适合**：重大行业判断、深度观点、战略趋势类推文。
- **文字控制**：主标题 6–12 汉字，最多分 2 行（横画幅垂直高度紧凑，3 行必拥挤）。

### 2. ★★★ 绝对安全：中央圆角卡片版（现代科技感）
- **结构**：画布正中央放置一块大圆角纯白或微淡卡片（`border-radius: 16px`），主标题置于卡片正中，卡片边缘恰好贴合中央安全区边界；卡片下方透出精致浅阴影。
- **适合**：工具测评、技术干货、版本发布。

### 3. ★★★ 绝对安全：中字翼饰版（层次最丰富）
- **结构**：核心标题在中央安全区稳如泰山，左右两翼放线性图标、流程节点连线、数据散点等“可牺牲装饰”。
- **适合**：系统架构、实战方案、教程指南。完整展开时画面极为饱满，分享裁剪后核心信息毫发无损。

---

## 三、视觉设计系统（Style Lock 提示词锁定规范）

为保证封面具有国际顶级科技产品的现代审美，统一采用**轻盈 AI 现代信息图**设计语言：
- **墨黑主字**：`#181A24` —— 高对比度、清晰利落的现代无衬线粗体。
- **品牌强调色**：科技紫 `#6C35E8`（深邃前沿）、电光蓝 `#4563F2`（过渡色）、青柠绿 `#A4E927`（破局提速、增长）。
- **底色氛围**：`#FCFBFF`（微泛薰衣草浅紫的纯净白底），杜绝脏乱复杂的多层暗黑杂乱背景。

### 生产级生图提示词模板（英文 Style Lock 直接调用）
当调用图片生成模型（如 `generate_images`）时，直接使用以下结构化提示词进行组装：

```text
Create an original premium AI-product cover banner for a WeChat article in a 2.35:1 ultra-wide horizontal canvas (1175x500).
Use a clean white to very pale lavender background with generous margins and breathable negative space.
CRITICAL COMPOSITION: Place the headline and all critical visual elements strictly inside the central square safe area (the middle 42.6% of the canvas width, centered horizontally), because this banner will be center-cropped to a 1:1 square when shared on WeChat moments and chats.
Left and right wings (28.7% width each) must only contain subtle background extensions, faint ambient glow, or minimal decorative linear geometric lines that can be safely cropped.
Typography: Modern simplified-Chinese bold sans-serif lettering in near-black (#181A24). Headline: "{主标题内容}".
Highlight key phrases with a controlled violet-to-electric-blue gradient (#6C35E8 to #4563F2) or vivid lime green (#A4E927).
Style: Polished, minimalist, ultra-clean SaaS product visual identity, highly legible at small thumbnail size in a mobile chat list.
Negative constraints: No photorealistic human faces, no messy clutter, no busy 3D renders, no text placed near left or right borders.
```

---

## 四、安全区自检与验证脚本

若需在代码层面验证生成的封面图片安全区，可参考如下几何坐标校验逻辑：
```python
def check_cover_safety(image_width, image_height):
    # 微信 2.35:1 比例验证
    aspect_ratio = image_width / image_height
    assert 2.2 <= aspect_ratio <= 2.45, f"非标准 2.35:1 比例: {aspect_ratio}"
    
    # 中央正方形 1:1 安全区坐标计算
    safe_left = image_width * 0.287
    safe_right = image_width * 0.713
    safe_width = image_width * 0.426
    safe_top = 0
    safe_bottom = image_height
    
    return {
        "safe_box": (safe_left, safe_top, safe_right, safe_bottom),
        "safe_width": safe_width,
        "aspect_ratio": aspect_ratio
    }
```
通过上述标准，生成的 `assets/cover.<模型返回扩展名>` 无论是在微信公众号后台上传、在常读列表中以大图展示，还是被读者随手转发到好友群聊或朋友圈，都能保持 100% 的标题完整度与视觉专业度！
