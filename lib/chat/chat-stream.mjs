export function decodeChatBody(response, onStatus, onCompanionCue, onReasoning) {
  if (response.headers.get('x-chat-stream-format') !== 'ndjson' || !response.body) return response.body;
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let pending = '';
  const consume = (line, controller) => {
    if (!line.trim()) return;
    const event = JSON.parse(line);
    if (event.type === 'text_delta' && typeof event.text === 'string') controller.enqueue(encoder.encode(event.text));
    else if (event.type === 'reasoning_delta' && typeof event.text === 'string') onReasoning?.(event.text);
    else if (event.type === 'status') onStatus?.(event.label || '');
    else if (event.type === 'companion_cue') onCompanionCue?.(event.emotion);
    else if (event.type === 'error') throw new Error(event.error || '回复失败');
  };
  return response.body.pipeThrough(new TransformStream({
    transform(chunk, controller) {
      pending += decoder.decode(chunk, { stream: true });
      const lines = pending.split('\n');
      pending = lines.pop() || '';
      for (const line of lines) consume(line, controller);
    },
    flush(controller) {
      pending += decoder.decode();
      consume(pending, controller);
      onStatus?.('');
    },
  }));
}
