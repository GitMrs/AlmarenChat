const REDACTION_MARK = '[REDACTED]';

/**
 * 从子进程输出中抹掉密钥，避免写入日志缓冲、SSE 流和前端终端。
 * 只做精确值匹配（长度 >= 6），不尝试猜测其他格式。
 */
export function redactSecrets(
  text: string,
  secrets: Array<string | null | undefined>
): string {
  if (!text) return text;

  let output = text;
  for (const secret of secrets) {
    const value = typeof secret === 'string' ? secret.trim() : '';
    if (value.length < 6) continue;
    output = output.split(value).join(REDACTION_MARK);
  }

  return output;
}
