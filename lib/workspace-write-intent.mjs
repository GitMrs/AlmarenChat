const NEGATED_WORKSPACE_WRITE_PATTERN = /(?:无需|不需要|不用|不要|不得|禁止|不允许|不必|避免|不(?:进行|执行)?)(?:(?!但|但是|不过|然而|仍需|还需|仍要|还要|而是).){0,18}(?:制作|创建|生成|编写|修改|编辑|写入|开发|搭建|产出)(?:(?!但|但是|不过|然而|仍需|还需|仍要|还要|而是).){0,18}(?:文件|目录|工作区|仓库|文档|报告|页面|网页|网站|代码|\.md\b|html)/i;
const CONTRAST_PATTERN = /(?=但(?:是)?|不过|然而|仍需|还需|仍要|还要|而是)/g;
const TASK_FILE_TARGET_PATTERN = /(?:文件|目录|工作区|仓库|文档|报告|页面|网页|网站|代码|(?:^|[/\\])?[^/\\\s]+\.(?:html?|md|json|txt|css|[cm]?[jt]sx?|ya?ml|csv|xml|sql|py|java|go|rs|sh|vue|svelte))/i;
const TASK_WRITE_VERB_PATTERN = /(?:制作|创建|新建|写入|保存|修改|编辑|更新|删除|重命名|移动|生成|编写|开发|搭建|产出|落盘|create|write|save|modify|edit|update|delete|rename|move|generate|build|develop|make)/i;

export function needsWorkspaceWrite(value) {
  const clauses = String(value || '')
    .replace(CONTRAST_PATTERN, '\n')
    .split(/[，,；;。！？!?\n]+/)
    .map((clause) => clause.trim())
    .filter(Boolean);

  return clauses.some((clause) => {
    if (NEGATED_WORKSPACE_WRITE_PATTERN.test(clause)) return false;
    return TASK_WRITE_VERB_PATTERN.test(clause) && TASK_FILE_TARGET_PATTERN.test(clause);
  });
}

export function taskRequiresWorkspaceWrite(value) {
  const clauses = String(value || '')
    .replace(CONTRAST_PATTERN, '\n')
    .split(/[，,；;。！？!?\n]+/)
    .map((clause) => clause.trim())
    .filter(Boolean);
  return clauses.some((clause) => {
    if (NEGATED_WORKSPACE_WRITE_PATTERN.test(clause)) return false;
    if (/预期可验收产物\s*[:：]/.test(clause) && TASK_FILE_TARGET_PATTERN.test(clause)) return true;
    return TASK_WRITE_VERB_PATTERN.test(clause) && TASK_FILE_TARGET_PATTERN.test(clause);
  });
}
