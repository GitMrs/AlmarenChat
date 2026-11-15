import { encryptQQCredential, decryptQQCredential } from '../qq-assistant/credentials.mjs';

const secret = () => process.env.SPACE_CONNECTOR_SECRET || process.env.QQ_ASSISTANT_SECRET;
export const encryptPlatformToken = value => encryptQQCredential(value, secret());
export const decryptPlatformToken = value => decryptQQCredential(value, secret());

export function normalizePlatformConfig(input) {
  let url;
  try { url = new URL(input.baseUrl); } catch { throw new Error('请输入有效的机器人服务地址'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('服务地址仅支持不含账号、查询参数的 HTTP / HTTPS 地址');
  }
  if (!['PRIVATE', 'GROUP'].includes(input.targetType)) throw new Error('请选择私聊或群聊');
  const targetId = String(input.targetId || '').trim();
  if (!/^\d{5,20}$/.test(targetId)) throw new Error('请输入有效的 QQ 号或群号');
  return { baseUrl: url.toString().replace(/\/+$/, ''), targetType: input.targetType, targetId, enabled: input.enabled !== false };
}

export async function sendPlatformQQ(config, message, fetcher = fetch) {
  const group = config.targetType === 'GROUP';
  const url = new URL(`${config.baseUrl}/${group ? 'send_group_msg' : 'send_private_msg'}`);
  url.searchParams.set(group ? 'group_id' : 'user_id', config.targetId);
  url.searchParams.set('message', message);
  let response;
  try {
    response = await fetcher(url, { method: 'GET', headers: { 'X-Auth-Key': decryptPlatformToken(config.tokenCiphertext) }, redirect: 'error', signal: AbortSignal.timeout(15_000) });
  } catch { throw new Error('连接通知机器人失败或超时，请检查服务地址和网络'); }
  if (response.status !== 200) throw new Error(`通知机器人返回 HTTP ${response.status}`);
  let result;
  try { result = await response.json(); } catch { throw new Error('通知机器人未返回有效 JSON'); }
  if (!result || typeof result !== 'object' || Array.isArray(result) || result.status === 'failed' || (result.retcode != null && result.retcode !== 0)) {
    throw new Error('通知机器人拒绝发送消息，请检查鉴权和接收目标');
  }
  return { messageId: result.data?.message_id == null ? null : String(result.data.message_id) };
}
