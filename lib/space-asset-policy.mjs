const ROLE_LABELS = Object.freeze({
  FOUNDATION: '基础资料',
  INPUT: '待处理资料',
  SHARED: '共享资产',
  OUTPUT: '当前成果',
  ARCHIVE: '归档内容',
  SKILL: 'Space Skill',
  LOG: '运行记录',
});

export function spaceAssetRole(relativePath, workId = null) {
  const normalized = String(relativePath || '').replaceAll('\\', '/').replace(/^\/+/, '');
  if (normalized.startsWith('.space/skills/')) return 'SKILL';
  if (normalized.startsWith('workspace/foundation/')) return 'FOUNDATION';
  if (normalized.startsWith('workspace/inbox/')) return 'INPUT';
  if (normalized.startsWith('workspace/shared/')) return 'SHARED';
  if (normalized.startsWith('workspace/archive/')) return 'ARCHIVE';
  if (normalized.startsWith('workspace/logs/')) return 'LOG';
  if (normalized.startsWith('workspace/works/') || workId) return 'OUTPUT';
  if (normalized.startsWith('files/') || normalized.startsWith('workspace/uploads/')) return 'INPUT';
  return 'OUTPUT';
}

export function spaceAssetRoleLabel(role) {
  return ROLE_LABELS[role] || '空间文件';
}

export function decorateSpaceFile(file) {
  return { ...file, assetRole: spaceAssetRole(file.relativePath, file.workId) };
}

export { ROLE_LABELS as SPACE_ASSET_ROLE_LABELS };
