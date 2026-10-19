import type { CompanionCharacter } from './catalog';
import { companionEmotions } from './reply-protocol.mjs';

export interface CompanionReply {
  id: string;
  content: string;
  emotion: string;
}

const reactions: Record<string, Record<string, [string, string]>> = {
  nari: {
    calm: ['Nari_chat_01_attentive', ''],
    happy: ['Nari_mood_happy_sway', 'Stars'],
    shy: ['Nari_mood_shy_duck', 'Blushing'],
    surprised: ['Nari_mood_surprised_lean', 'Shocked'],
    sad: ['Nari_mood_sad_look_down', 'Crying'],
    angry: ['Nari_mood_angry_hmph', 'Angry'],
    loving: ['Nari_mood_loving_lean', 'Love'],
    thinking: ['Nari_chat_02_listen_tilt', ''],
  },
  yume: {
    calm: ['Yume_chat_01_attentive', ''],
    happy: ['Yume_mood_happy_pleased', ''],
    shy: ['Yume_mood_shy_fidget', 'Shy'],
    surprised: ['Yume_mood_surprised_wait_what', ''],
    sad: ['Yume_mood_sad_look_down', 'Crying'],
    angry: ['Yume_mood_angry_seriously', ''],
    loving: ['Yume_mood_loving_soft', 'HeartEye'],
    thinking: ['Yume_chat_05_readjust', ''],
  },
  lafei: {
    calm: ['Idle', ''], happy: ['Special_0', ''], shy: ['TapBody_1', ''],
    surprised: ['TapBody_0', ''], sad: ['Idle', ''], angry: ['TapBody_0', ''],
    loving: ['TapHead', ''], thinking: ['Idle', ''],
  },
  mao: {
    calm: ['Idle', ''], happy: ['TapBody_2', '开心'], shy: ['TapBody_1', '害羞'],
    surprised: ['TapBody_0', '惊讶'], sad: ['Idle', '委屈'], angry: ['TapBody_0', '生气'],
    loving: ['TapBody_1', '开心'], thinking: ['Idle', ''],
  },
};

export function getCompanionReplyReaction(character: CompanionCharacter, emotion: string) {
  const available = reactions[character.id];
  const [motion, expression] = (companionEmotions.includes(emotion) ? available?.[emotion] : null) || available?.calm || ['', ''];
  return {
    motionId: character.motions.find(item => item.id === motion)?.id,
    expressionId: character.expressions.some(item => item.id === expression) ? expression : '',
  };
}
