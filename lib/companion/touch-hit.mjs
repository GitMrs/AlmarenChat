// Uses the current render projection and deformed triangles, not screen thirds.
export function hitCharacter(point, projection, bounds, meshes) {
  if (!projection || !bounds || !Number.isFinite(point.x) || !Number.isFinite(point.y)
    || point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1
    || !projection[0] || !projection[5]) return null;
  const x = (point.x * 2 - 1 - projection[12]) / projection[0];
  const y = (1 - point.y * 2 - projection[13]) / projection[5];
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  for (const mesh of meshes) {
    if (mesh._opacity <= 0.05 || !mesh._world || !mesh._idx) continue;
    const vertices = mesh._world, indices = mesh._idx;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < vertices.length; i += 2) {
      minX = Math.min(minX, vertices[i]); maxX = Math.max(maxX, vertices[i]);
      minY = Math.min(minY, vertices[i + 1]); maxY = Math.max(maxY, vertices[i + 1]);
    }
    if (x < minX || x > maxX || y < minY || y > maxY) continue;
    for (let i = 0; i + 2 < indices.length; i += 3) {
      const a = (indices[i] & 65535) * 2, b = (indices[i + 1] & 65535) * 2, c = (indices[i + 2] & 65535) * 2;
      if (a + 1 >= vertices.length || b + 1 >= vertices.length || c + 1 >= vertices.length) continue;
      const ax = vertices[a], ay = vertices[a + 1], bx = vertices[b], by = vertices[b + 1], cx = vertices[c], cy = vertices[c + 1];
      const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      if (!Number.isFinite(area) || Math.abs(area) < 1e-10) continue;
      const u = ((bx - ax) * (y - ay) - (by - ay) * (x - ax)) / area;
      const v = ((x - ax) * (cy - ay) - (y - ay) * (cx - ax)) / area;
      if (u >= -1e-7 && v >= -1e-7 && u + v <= 1 + 1e-7) {
        const height = bounds.maximumY - bounds.minimumY;
        if (!(height > 0)) return null;
        const ratio = (y - bounds.minimumY) / height;
        return ratio < 0.14 ? 'head' : ratio < 0.29 ? 'face' : 'body';
      }
    }
  }
  return null;
}
