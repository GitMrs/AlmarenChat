const ROLES = new Set(['report', 'notification', 'asset', 'source']);

function safeRelativePath(value) {
  const path = String(value || '').trim().replaceAll('\\', '/');
  if (!path || path.startsWith('/') || /^[A-Za-z]:\//.test(path)) return null;
  const parts = path.split('/');
  if (parts.some((part) => !part || part === '..')) return null;
  return parts.join('/');
}

export function normalizeDeliveryManifest(value) {
  const input = value && typeof value === 'object' ? value : {};
  const artifacts = Array.isArray(input.artifacts) ? input.artifacts : [];
  return {
    artifacts: artifacts.map((item) => {
      const entry = item && typeof item === 'object' ? item : {};
      const path = safeRelativePath(entry.path);
      const role = ROLES.has(entry.role) ? entry.role : 'source';
      const deliver = Array.isArray(entry.deliver)
        ? entry.deliver.map((target) => String(target || '').trim().toLowerCase()).filter(Boolean)
        : [];
      return {
        path,
        role,
        share: entry.share === true,
        renderTheme: typeof entry.renderTheme === 'string' ? entry.renderTheme : null,
        deliver,
      };
    }).filter((entry) => entry.path),
  };
}

export function findDeliveryArtifact(manifest, relativePath) {
  const target = safeRelativePath(relativePath);
  if (!target) return null;
  return (manifest?.artifacts || []).find((entry) => entry.path === target) || null;
}

