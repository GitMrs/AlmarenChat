function normalizePath(value) {
  return String(value || '').trim().replaceAll('\\', '/').replace(/^\.\//, '');
}

export function explicitlyAllowsFullRewrite(value) {
  return /(?:重写|整体覆盖|完全替换|从头重做|重新生成(?:整个|全部)?|overwrite|replace\s+the\s+entire|rewrite)/i.test(String(value || ''));
}

export function blocksUnapprovedFullOverwrite(path, existingPaths, approvedRequest) {
  const normalized = normalizePath(path);
  if (!normalized || explicitlyAllowsFullRewrite(approvedRequest)) return false;
  return existingPaths.has(normalized);
}
