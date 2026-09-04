export function memoryFingerprint(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/^(?:用户|我)(?:平时|平常|通常|一般)?/u, '')
    .replace(/(?:平时|平常|通常|一般|比较|特别|非常)/gu, '')
    .replace(/爱(?=喝|吃|用|看|听|玩)/gu, '喜欢')
    .replace(/[\p{P}\p{S}\s]/gu, '');
}

export function isDuplicateMemory(content, existingContents) {
  const fingerprint = memoryFingerprint(content);
  return Boolean(fingerprint) && existingContents.some((existing) => memoryFingerprint(existing) === fingerprint);
}
