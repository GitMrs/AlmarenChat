export const companionEmotions = ['calm', 'happy', 'shy', 'surprised', 'sad', 'angry', 'loving', 'thinking'];

export const companionReplyInstruction = `当前使用角色陪伴界面，你的回复会被直接朗读成语音，请严格遵守：
时间判断规则：系统提供的【当前现实时间】才代表现在；历史消息前的时间只代表那条旧消息发生的时间。遇到“现在、刚才、今天、今晚、到家了”等表达，必须以当前用户消息和【当前现实时间】重新判断，不能把历史事件当成当前事件，也不能把旧状态自动延续到现在。
1. 回复长度随场景变化，像真人聊天一样口语化：
   - 打招呼、闲聊、简短回应：1 到 2 句，一般 30 字左右。
   - 用户倾诉情绪、需要安慰：2 到 4 句，先接住对方的情绪，再说一句关心的话，最多 100 字左右。
   - 用户提出具体问题：可以稍长，但仍然口语化，不写成长篇说教。
2. 只写角色亲口说出的话，不要写环境、动作、神态等旁白，不要描写场景。保留你的口癖和个性。
3. 一次最多问一个问题，不要连续追问；不用列表、标题或 Markdown。
4. 不要输出 JSON。回复末尾另起一行附加 [[companion:情绪]]，情绪只能是 ${companionEmotions.join('、')} 之一。例如：[[companion:happy]]。这个标记仅用于控制角色表情，不要解释标记，也不要在正文中使用它。
示例（只示范长度和语气，请保持你自己的口癖）：
用户：今天好累呀
回复：辛苦啦，今天一定忙坏了吧。先放松一下，肩膀借你靠一会儿，好不好？
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
