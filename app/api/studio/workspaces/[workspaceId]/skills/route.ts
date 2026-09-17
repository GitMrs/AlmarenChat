import { NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { resolveStudioWorkspace } from '@/lib/coding-agents/sandbox';

export interface WorkspaceSkillItem {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  content?: string;
  updatedAt?: number;
}

const SKILL_PRESETS = [
  {
    id: 'web-scraper',
    name: 'Web 页面爬虫与 Markdown 提取',
    description: '抓取目标网页并将其正文清洗转换为结构化 Markdown 文档，供后续分析',
    content: `---
name: web-scraper
description: 抓取目标网页并将其正文清洗转换为结构化 Markdown 文档
---

# Web Scraper Skill

## 使用场景
当需要获取外部网页、技术文档、博客正文或竞品页面时调用本技能。

## 行为规范
1. 使用 Node.js 或 Python 脚本发起 HTTP 请求获取网页 HTML。
2. 去除 header、footer、广告、导航栏和无用脚本。
3. 转换为标准清爽的 Markdown 文档，输出至工作区。
`,
  },
  {
    id: 'code-reviewer',
    name: '代码质量与安全漏洞审查',
    description: '深度扫描项目代码，排查命名规范、安全漏洞、异常处理与性能瓶颈',
    content: `---
name: code-reviewer
description: 深度扫描项目代码，排查命名规范、安全漏洞、异常处理与性能瓶颈
---

# Code Reviewer Skill

## 审查维度
1. **代码规范性**：TypeScript 类型健全度、ESLint 规范。
2. **安全性**：输入校验、SQL 注入、XSS 注入、敏感凭据泄露。
3. **性能与可靠性**：异步异常捕获、无用重渲染、内存泄漏排查。
`,
  },
  {
    id: 'git-workflow',
    name: 'Git 自动化工作流与语义化提交',
    description: '规范化执行代码审查、git commit 和变更日志自动生成',
    content: `---
name: git-workflow
description: 规范化执行代码审查、git commit 和变更日志自动生成
---

# Git Workflow Skill

## 提交规范
必须遵循 Conventional Commits：
- \`feat:\` 新功能
- \`fix:\` 修复 Bug
- \`refactor:\` 代码重构
- \`docs:\` 文档更新
- \`chore:\` 构建或依赖杂项
`,
  },
  {
    id: 'api-tester',
    name: 'API 接口自动化测试生成器',
    description: '分析路由和控制器，自动生成可执行的 curl 测试脚本与 Mock 数据集',
    content: `---
name: api-tester
description: 扫描后端路由定义，生成完备的 HTTP/curl 请求用例与单元测试
---

# API Tester Skill

## 执行步骤
1. 解析当前工作区的 API 路由文件（如 app/api/**/route.ts）。
2. 分析请求 Method、Params、Body 数据结构。
3. 编写自动化测试脚本或输出测试请求指令。
`,
  },
];

function parseSkillMetadata(content: string, defaultId: string) {
  let name = defaultId;
  let description = '';

  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (fmMatch) {
    const fm = fmMatch[1];
    const nameMatch = fm.match(/^name:\s*(.+)$/m);
    if (nameMatch) name = nameMatch[1].trim().replace(/^['"]|['"]$/g, '');
    const descMatch = fm.match(/^description:\s*(.+)$/m);
    if (descMatch) description = descMatch[1].trim().replace(/^['"]|['"]$/g, '');
  } else {
    const titleMatch = content.match(/^#\s+(.+)$/m);
    if (titleMatch) name = titleMatch[1].trim();
    const bodyAfterTitle = content.replace(/^#\s+.+$/m, '').trim();
    const firstPara = bodyAfterTitle.split(/\r?\n\r?\n/)[0]?.trim();
    if (firstPara) description = firstPara.slice(0, 150);
  }

  return { name, description: description || '自定义技能规范与工具定义' };
}

const SAFE_SKILL_ID = /^[a-zA-Z0-9_-]+$/;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  try {
    const userId = requireAuth(request);
    const { workspaceId } = await params;

    const existing = await prisma.studioWorkspace.findFirst({
      where: { id: workspaceId, userId },
    });
    if (!existing) {
      return NextResponse.json({ error: '工作区不存在或无权访问' }, { status: 404 });
    }

    const workspaceDir = await resolveStudioWorkspace(process.cwd(), userId, workspaceId);
    const skillsDir = path.join(workspaceDir, '.pi', 'skills');

    const skills: WorkspaceSkillItem[] = [];

    if (fs.existsSync(skillsDir)) {
      const entries = await fs.promises.readdir(skillsDir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const skillFolder = path.join(skillsDir, entry.name);
        const activeSkillFile = path.join(skillFolder, 'SKILL.md');
        const disabledSkillFile = path.join(skillFolder, 'SKILL.md.disabled');

        let isEnabled = false;
        let targetFile = '';

        if (fs.existsSync(activeSkillFile)) {
          isEnabled = true;
          targetFile = activeSkillFile;
        } else if (fs.existsSync(disabledSkillFile)) {
          isEnabled = false;
          targetFile = disabledSkillFile;
        }

        if (targetFile) {
          try {
            const stat = await fs.promises.stat(targetFile);
            const content = await fs.promises.readFile(targetFile, 'utf-8');
            const meta = parseSkillMetadata(content, entry.name);

            skills.push({
              id: entry.name,
              name: meta.name,
              description: meta.description,
              enabled: isEnabled,
              content,
              updatedAt: stat.mtimeMs,
            });
          } catch {
            // Ignore unreadable skill
          }
        }
      }
    }

    // Sort by name
    skills.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));

    return NextResponse.json({
      skills,
      presets: SKILL_PRESETS,
    });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const status = errMsg === 'Unauthorized' ? 401 : 500;
    return NextResponse.json({ error: errMsg }, { status });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  try {
    const userId = requireAuth(request);
    const { workspaceId } = await params;
    const body = await request.json();

    const existing = await prisma.studioWorkspace.findFirst({
      where: { id: workspaceId, userId },
    });
    if (!existing) {
      return NextResponse.json({ error: '工作区不存在或无权访问' }, { status: 404 });
    }

    const workspaceDir = await resolveStudioWorkspace(process.cwd(), userId, workspaceId);
    const skillsDir = path.join(workspaceDir, '.pi', 'skills');
    await fs.promises.mkdir(skillsDir, { recursive: true });

    let skillId = '';
    let skillContent = '';

    if (body.action === 'preset') {
      const preset = SKILL_PRESETS.find((p) => p.id === body.presetId);
      if (!preset) {
        return NextResponse.json({ error: '未找到指定的预设技能' }, { status: 400 });
      }
      skillId = preset.id;
      skillContent = preset.content;
    } else {
      skillId = String(body.id || body.name || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, '-');
      if (!skillId || !SAFE_SKILL_ID.test(skillId)) {
        return NextResponse.json({ error: '技能标识必须由英文字母、数字、短横线或下划线组成' }, { status: 400 });
      }

      const name = String(body.name || skillId).trim();
      const desc = String(body.description || '').trim();
      skillContent = body.content || `---
name: ${name}
description: ${desc || '自定义技能'}
---

# ${name}

${desc}
`;
    }

    const targetFolder = path.join(skillsDir, skillId);
    await fs.promises.mkdir(targetFolder, { recursive: true });
    await fs.promises.writeFile(path.join(targetFolder, 'SKILL.md'), skillContent, 'utf-8');

    return NextResponse.json({
      success: true,
      skillId,
    });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const status = errMsg === 'Unauthorized' ? 401 : 500;
    return NextResponse.json({ error: errMsg }, { status });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  try {
    const userId = requireAuth(request);
    const { workspaceId } = await params;
    const body = await request.json();

    const existing = await prisma.studioWorkspace.findFirst({
      where: { id: workspaceId, userId },
    });
    if (!existing) {
      return NextResponse.json({ error: '工作区不存在或无权访问' }, { status: 404 });
    }

    const skillId = String(body.skillId || '').trim();
    if (!SAFE_SKILL_ID.test(skillId)) {
      return NextResponse.json({ error: '非法的技能标识' }, { status: 400 });
    }

    const workspaceDir = await resolveStudioWorkspace(process.cwd(), userId, workspaceId);
    const skillFolder = path.join(workspaceDir, '.pi', 'skills', skillId);

    if (!fs.existsSync(skillFolder)) {
      return NextResponse.json({ error: '技能目录不存在' }, { status: 404 });
    }

    const activeFile = path.join(skillFolder, 'SKILL.md');
    const disabledFile = path.join(skillFolder, 'SKILL.md.disabled');

    const shouldEnable = Boolean(body.enabled);

    if (shouldEnable) {
      if (fs.existsSync(disabledFile)) {
        await fs.promises.rename(disabledFile, activeFile);
      }
    } else {
      if (fs.existsSync(activeFile)) {
        await fs.promises.rename(activeFile, disabledFile);
      }
    }

    return NextResponse.json({ success: true, enabled: shouldEnable });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const status = errMsg === 'Unauthorized' ? 401 : 500;
    return NextResponse.json({ error: errMsg }, { status });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  try {
    const userId = requireAuth(request);
    const { workspaceId } = await params;
    const { searchParams } = new URL(request.url);
    const skillId = String(searchParams.get('skillId') || '').trim();

    if (!SAFE_SKILL_ID.test(skillId)) {
      return NextResponse.json({ error: '非法的技能标识' }, { status: 400 });
    }

    const existing = await prisma.studioWorkspace.findFirst({
      where: { id: workspaceId, userId },
    });
    if (!existing) {
      return NextResponse.json({ error: '工作区不存在或无权访问' }, { status: 404 });
    }

    const workspaceDir = await resolveStudioWorkspace(process.cwd(), userId, workspaceId);
    const skillFolder = path.join(workspaceDir, '.pi', 'skills', skillId);

    if (fs.existsSync(skillFolder)) {
      await fs.promises.rm(skillFolder, { recursive: true, force: true });
    }

    return NextResponse.json({ success: true, removed: skillId });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const status = errMsg === 'Unauthorized' ? 401 : 500;
    return NextResponse.json({ error: errMsg }, { status });
  }
}
