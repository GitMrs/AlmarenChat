const PERSONAL_FACT_PATTERNS = [
  // 显式记忆与约定指令
  /(?:请|要|帮我)?(?:记住|别忘了|记下|牢记)|以后(?:都|请|尽量|统一|不要|别)|下次(?:记得|注意)|默认(?:使用|采用|按)|统一(?:使用|采用|按)/u,
  // 个人偏好、习惯与态度
  /我(?:一直|通常|平时|习惯|喜欢|偏好|倾向于|比较喜欢|更喜欢|不喜欢|讨厌|常用|主要用|一般用|是个|是一名|从事|住在|来自|生日|养了|有一只|看重|注重)/u,
  // 个人属性、技术栈与工作环境
  /我的(?:名字|生日|职业|工作|习惯|偏好|家人|宠物|技术栈|项目|团队|风格|要求|代码风格|电脑|系统|环境)/u,
  // 业务项目与团队约定
  /(?:我们|我这边|我项目|本项目)(?:正在做|是用|主要用|使用的是|技术栈是|基于|统一按|约定)/u,
  // 回答与交互规范要求
  /(?:回答|代码|方案|输出)(?:请尽量|尽量|必须|要|不要)(?:简短|精炼|带注释|中文注释|模块化|说废话|客套)/u,
  /(?:不要|禁止|别|请勿)(?:给我|输出|使用|写)(?:废话|客套|长篇大论|英文)/u,
  // 常见技术选型声明
  /(?:我用|我使用|我用的是|我主要是用|我们采用)(?:ts|typescript|js|javascript|react|vue|next|tailwind|python|golang|rust|docker|sqlite|postgres)/i,
  // 英文事实句式
  /\b(?:remember (?:that|this)|keep in mind|i (?:always|usually|prefer|like|dislike|tend to|work as|live in|am using|am from)|my (?:stack|project|preference|rule|habit))\b/i,
];

export function shouldExtractMemorySuggestion(message) {
  const text = typeof message === 'string' ? message.trim() : '';
  if (text.length < 3) return false;
  return PERSONAL_FACT_PATTERNS.some((pattern) => pattern.test(text));
}
