import { NextResponse } from 'next/server';
import { requireAuth } from '@/app/api/_lib/auth';
import { getSpaceForUser } from '@/app/api/_lib/spaces';
import {
  fetchSpaceSkillPackage,
  installSpaceSkillPackage,
  listSpaceSkills,
  parseSpaceSkillArchive,
  removeSpaceSkill,
  updateSpaceSkillExecution,
} from '@/lib/space-skills.mjs';

function errorStatus(error: Error) {
  if (error.message === 'Unauthorized') return 401;
  if (/not found/i.test(error.message)) return 404;
  if (/已安装/.test(error.message)) return 409;
  return 400;
}

async function scope(request: Request, params: Promise<{ spaceId: string }>) {
  const userId = requireAuth(request);
  const { spaceId } = await params;
  const space = await getSpaceForUser(spaceId, userId);
  if (!space) throw new Error('Space not found');
  return { projectRoot: process.cwd(), userId, spaceId };
}

function preview(packageData: any) {
  return {
    id: packageData.manifest.id,
    name: packageData.manifest.name,
    version: packageData.manifest.version,
    description: packageData.manifest.description,
    sourceUrl: packageData.manifest.sourceUrl,
    digest: packageData.manifest.digest,
    files: packageData.manifest.files,
    warnings: packageData.manifest.warnings,
  };
}

export async function GET(request: Request, { params }: { params: Promise<{ spaceId: string }> }) {
  try {
    const options = await scope(request, params);
    return NextResponse.json({ skills: await listSpaceSkills(options) });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: errorStatus(error) });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ spaceId: string }> }) {
  try {
    const options = await scope(request, params);
    const isUpload = request.headers.get('content-type')?.toLowerCase().startsWith('multipart/form-data');
    let action;
    let expectedDigest;
    let packageData;
    if (isUpload) {
      const formData = await request.formData();
      action = String(formData.get('action') || '');
      expectedDigest = String(formData.get('expectedDigest') || '');
      if (!['preview', 'install'].includes(action)) throw new Error('不支持的 Skill 操作');
      const file = formData.get('file');
      if (!(file instanceof File)) throw new Error('请选择 Skill ZIP');
      if (!file.name.toLowerCase().endsWith('.zip')) throw new Error('只支持上传 ZIP 格式的 Skill 包');
      packageData = parseSpaceSkillArchive({
        archive: Buffer.from(await file.arrayBuffer()),
        sourceName: file.name,
      });
    } else {
      const body = await request.json();
      action = body.action;
      expectedDigest = body.expectedDigest;
      if (!['preview', 'install'].includes(action)) throw new Error('不支持的 Skill 操作');
      packageData = await fetchSpaceSkillPackage(body.sourceUrl);
    }
    if (action === 'preview') {
      return NextResponse.json({ preview: preview(packageData) });
    }
    if (!expectedDigest || packageData.manifest.digest !== expectedDigest) {
      throw new Error('Skill 来源在确认后发生变化，请重新分析并确认');
    }
    const skill = await installSpaceSkillPackage({ ...options, packageData });
    return NextResponse.json({ skill }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: errorStatus(error) });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ spaceId: string }> }) {
  try {
    const options = await scope(request, params);
    const { skillId, approvedScripts } = await request.json();
    if (!skillId || !Array.isArray(approvedScripts)) throw new Error('Skill 脚本权限配置无效');
    const skill = await updateSpaceSkillExecution({ ...options, skillId, approvedScripts });
    return NextResponse.json({ skill });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: errorStatus(error) });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ spaceId: string }> }) {
  try {
    const options = await scope(request, params);
    const skillId = new URL(request.url).searchParams.get('skillId');
    if (!skillId) throw new Error('缺少 Skill ID');
    const removed = await removeSpaceSkill({ ...options, skillId });
    if (!removed) throw new Error('Skill not found');
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: errorStatus(error) });
  }
}
