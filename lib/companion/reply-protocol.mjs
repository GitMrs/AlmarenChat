export const companionEmotions = ['calm', 'happy', 'shy', 'surprised', 'sad', 'angry', 'loving', 'thinking'];

export const companionReplyInstruction = `当前使用角色陪伴界面，你的回复会被直接朗读成语音，请严格遵守：
1. 每次只回复 1 到 3 句，总共不超过 60 个字，像日常聊天一样口语化。
2. 只写角色亲口说出的话，不要写环境、动作、神态等旁白，不要描写场景。
3. 一次最多问一个问题，不要连续追问；不用列表、标题或 Markdown。
4. 用户只是打招呼或简短回应时，回复更短，一两句即可。
5. 不要输出 JSON。回复末尾另起一行附加 [[companion:情绪]]，情绪只能是 ${companionEmotions.join('、')} 之一。例如：[[companion:happy]]。这个标记仅用于控制角色表情，不要解释标记，也不要在正文中使用它。
示例（只示范长度和语气，请保持你自己的口癖）：
用户：今天好累呀
回复：辛苦啦，先放松一下，肩膀借你靠一会儿好不好？
[[companion:loving]]`;

const marker = '[[companion:';

// Keep an incomplete marker between chunks so presentation controls never enter the text stream.
export function createCompanionReplyParser() {
  let pending = '';
  let readingEmotion = false;
  let emotion = 'calm';
  return {
    get emotion() { return emotion; },
    push(text) {
      pending += text;
      let output = '';
      while (pending) {
        if (readingEmotion) {
          const end = pending.indexOf(']]');
          if (end < 0) break;
          const candidate = pending.slice(0, end).trim();
          if (companionEmotions.includes(candidate)) emotion = candidate;
          pending = pending.slice(end + 2);
          readingEmotion = false;
        } else {
          const start = pending.indexOf(marker);
          if (start >= 0) {
            output += pending.slice(0, start);
            pending = pending.slice(start + marker.length);
            readingEmotion = true;
          } else {
            let keep = Math.min(pending.length, marker.length - 1);
            while (keep && !marker.startsWith(pending.slice(-keep))) keep--;
            output += pending.slice(0, pending.length - keep);
            pending = pending.slice(pending.length - keep);
            break;
          }
        }
      }
      return output;
    },
    finish() {
      const tail = readingEmotion || (pending.length >= 3 && marker.startsWith(pending)) ? '' : pending;
      pending = '';
      readingEmotion = false;
      return tail;
    },
  };
}
