export function formatWorkspaceInventory(files = [], limit = 200) {
  const visible = files.slice(0, limit).map((file) => {
    const path = String(file?.path || '').replace(/\s+/g, ' ').trim().slice(0, 300);
    return path ? `- ${path}` : '';
  }).filter(Boolean);
  if (visible.length === 0) return '当前空间工作区为空。';
  return [
    `当前空间工作区已有 ${files.length} 个文件：`,
    ...visible,
    ...(files.length > visible.length ? [`- 其余 ${files.length - visible.length} 个文件未展开`] : []),
  ].join('\n');
}
