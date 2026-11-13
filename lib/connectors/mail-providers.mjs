export const MAIL_URL = 'connector:personal-mail';
export const MAIL_PROVIDERS = Object.freeze({
  qq: { name: 'QQ / Foxmail', host: 'imap.qq.com', domains: ['qq.com', 'foxmail.com'] },
  '163': { name: '网易 163', host: 'imap.163.com', domains: ['163.com'] },
  '126': { name: '网易 126', host: 'imap.126.com', domains: ['126.com'] },
  yeah: { name: '网易 yeah', host: 'imap.yeah.net', domains: ['yeah.net'] },
  gmail: { name: 'Gmail', host: 'imap.gmail.com', domains: ['gmail.com', 'googlemail.com'] },
});
