function normalizedDeliverable(value) {
  return String(value || '')
    .trim()
    .toLocaleLowerCase()
    .replace(/\\/g, '/')
    .replace(/^workspace\//, '')
    .replace(/\s+/g, ' ');
}

function uniqueDeliverables(values) {
  const result = [];
  const seen = new Set();
  for (const value of values || []) {
    const text = String(value || '').trim();
    const normalized = normalizedDeliverable(text);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(text);
  }
  return result.slice(0, 8);
}

export function mergeOverlappingPlanTasks(tasks) {
  const merged = [];
  for (const task of tasks) {
    const deliverables = uniqueDeliverables(task.deliverables);
    const previous = merged.at(-1);
    const previousDeliverables = new Set((previous?.deliverables || []).map(normalizedDeliverable));
    const overlapsPrevious = deliverables.some((item) => previousDeliverables.has(normalizedDeliverable(item)));

    if (previous && previous.agentId === task.agentId && overlapsPrevious) {
      previous.instruction = `${previous.instruction}\n\n补充要求：\n${task.instruction}`;
      previous.deliverables = uniqueDeliverables([...previous.deliverables, ...deliverables]);
      continue;
    }
    merged.push({ ...task, deliverables });
  }
  return merged;
}
