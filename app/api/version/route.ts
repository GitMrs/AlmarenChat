import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

type DeploymentInfo = {
  version: string;
  commit: string;
  branch: string;
  builtAt: string;
  buildId: string;
};

function isDeploymentInfo(value: unknown): value is DeploymentInfo {
  if (!value || typeof value !== 'object') return false;
  const info = value as Record<string, unknown>;
  return ['version', 'commit', 'branch', 'builtAt', 'buildId'].every(
    (field) => typeof info[field] === 'string' && info[field].length > 0,
  );
}

export async function GET() {
  const distDir = process.env.NEXT_DIST_DIR || '.next';
  const infoPath = path.resolve(process.cwd(), distDir, 'deploy-info.json');

  try {
    const info: unknown = JSON.parse(await readFile(infoPath, 'utf8'));
    if (!isDeploymentInfo(info)) throw new Error('Invalid deployment info');
    return NextResponse.json(info, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json(
      { error: 'Deployment version is unavailable' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
