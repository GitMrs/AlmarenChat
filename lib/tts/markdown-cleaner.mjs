/**
 * Strips markdown syntax and converts text into natural spoken format for TTS engines.
 * Prevents TTS from pronouncing asterisks (**bold**), hash marks (###), links, pipes, etc.
 * Pure JavaScript with zero Node dependencies so it can be safely used in both browser and server.
 */
export function cleanMarkdownForTTS(text) {
  if (!text) return '';
  let s = String(text);

  // 1. Remove reasoning / think blocks (e.g. DeepSeek-R1 / QwQ)
  s = s.replace(/<think>[\s\S]*?<\/think>/gi, '');

  // 2. Remove code blocks ```lang ... ```
  s = s.replace(/```[\w-]*\n?([\s\S]*?)```/g, '');

  // 3. Remove HTML comments and tags
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(/<[^>]+>/g, '');

  // 4. Remove data URLs (e.g. data:image/png;base64,...)
  s = s.replace(/data:image\/[^\s)"]+/gi, '');

  // 5. Remove image tags: ![alt](url) -> "" (also handles incomplete or multiline urls)
  s = s.replace(/!\[([^\]]*)\](?:\([^)]*\)?)?/g, '');

  // 6. Replace markdown links: [link text](url) -> link text
  s = s.replace(/\[([^\]]+)\](?:\([^)]*\)?)?/g, '$1');

  // 7. Remove raw URLs (http://... or https://...)
  s = s.replace(/https?:\/\/[^\s<]+[^<.,:;"')\]\s]/g, '');

  // 7. Inline code: `code` -> code
  s = s.replace(/`([^`]+)`/g, '$1');

  // 8. Headers: # Title -> Title
  s = s.replace(/^#{1,6}\s+(.*)$/gm, '$1');

  // 9. Filter out table separator lines (|---|---|) and horizontal rules (---, ***)
  s = s.split('\n')
    .filter((line) => !/^[\s]*\|?[\s:|-]+\|?[\s]*$/.test(line))
    .filter((line) => !/^[\s]*[-*_]{3,}[\s]*$/.test(line))
    .join('\n');

  // 10. Tables: clean row | a | b | c | -> a，b，c
  s = s.replace(/^[\s]*\|(.*)\|[\s]*$/gm, (_, content) => {
    return content.split('|').map((c) => c.trim()).filter(Boolean).join('，');
  });

  // 11. Blockquotes: > quote -> quote
  s = s.replace(/^[\s]*>\s*/gm, '');

  // 12. Bold, italic, strikethrough markdown
  // ***bold-italic*** or ___bold-italic___
  s = s.replace(/\*\*\*([^*]+)\*\*\*/g, '$1');
  s = s.replace(/___([^_]+)___/g, '$1');
  // **bold** or __bold__ (resolves user's issue with **xxx**)
  s = s.replace(/\*\*([^*]+)\*\*/g, '$1');
  s = s.replace(/__([^_]+)__/g, '$1');
  // *italic* or _italic_
  s = s.replace(/\*([^*\n]+)\*/g, '$1');
  s = s.replace(/(^|[\s\p{P}])_([^_]+)_([\s\p{P}]|$)/gu, '$1$2$3');
  // ~~strikethrough~~
  s = s.replace(/~~([^~]+)~~/g, '$1');

  // 13. Unordered list bullets: - item, * item, + item
  s = s.replace(/^[\s]*[-*+]\s+/gm, '');

  // 14. Ordered lists: 1. item -> 1、item (pronounced naturally in Chinese TTS)
  s = s.replace(/^[\s]*(\d+)\.\s+/gm, '$1、');

  // 15. Agent mentions: @AgentName -> AgentName
  s = s.replace(/(^|[\s，。！？、])@([\p{L}\p{N}_-]+)/gu, '$1$2');

  // 16. Clean up remaining standalone markdown symbols: *, #, ~, `, ^, etc.
  s = s.replace(/[*#~`^]/g, '');

  // 17. Clean up repeated punctuation and excess whitespace
  s = s.replace(/，{2,}/g, '，');
  s = s.replace(/。{2,}/g, '。');
  s = s.replace(/[ \t]+/g, ' ');
  s = s.replace(/\n{3,}/g, '\n\n');

  return s.trim();
}
