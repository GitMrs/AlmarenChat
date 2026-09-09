const API_ROOT = 'https://api.weixin.qq.com/cgi-bin';

export class WechatConnectorError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'WechatConnectorError';
    this.code = options.code || 'WECHAT_REQUEST_FAILED';
    this.retryable = Boolean(options.retryable);
    this.providerCode = options.providerCode ?? null;
  }
}

function requiredText(value, label) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new WechatConnectorError(`${label}不能为空`, { code: 'INVALID_INPUT' });
  return text;
}

function providerError(payload) {
  const code = Number(payload?.errcode || 0);
  if (!code) return null;
  const providerMessage = typeof payload?.errmsg === 'string' ? payload.errmsg : '微信接口返回错误';
  const friendlyMessages = {
    40013: 'AppID 无效，请检查公众号开发设置',
    40125: 'AppSecret 无效，请重新填写',
    40164: '当前服务器 IP 不在微信公众号白名单中，请先在公众号后台添加 IP 白名单',
  };
  const message = friendlyMessages[code] || providerMessage;
  const retryable = [-1, 40001, 40014, 42001, 45009].includes(code);
  return new WechatConnectorError(`微信接口错误 ${code}: ${message}`, {
    code: code === 40001 || code === 40014 || code === 42001 ? 'WECHAT_TOKEN_INVALID' : 'WECHAT_API_ERROR',
    providerCode: code,
    retryable,
  });
}

async function parseResponse(response) {
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new WechatConnectorError(`微信接口返回了无效响应（HTTP ${response.status}）`, {
      code: 'WECHAT_INVALID_RESPONSE',
      retryable: response.status >= 500,
    });
  }
  if (!response.ok) {
    throw providerError(payload) || new WechatConnectorError(`微信接口请求失败（HTTP ${response.status}）`, {
      retryable: response.status >= 500,
    });
  }
  const error = providerError(payload);
  if (error) throw error;
  return payload;
}

function articlePayload(article) {
  const title = requiredText(article?.title, '文章标题');
  const content = requiredText(article?.content, '文章正文');
  const thumbMediaId = requiredText(article?.thumbMediaId, '封面素材 ID');
  return {
    title: title.slice(0, 64),
    author: typeof article.author === 'string' ? article.author.trim().slice(0, 16) : '',
    digest: typeof article.digest === 'string' ? article.digest.trim().slice(0, 120) : '',
    content,
    content_source_url: typeof article.contentSourceUrl === 'string' ? article.contentSourceUrl.trim() : '',
    thumb_media_id: thumbMediaId,
    need_open_comment: article.openComment ? 1 : 0,
    only_fans_can_comment: article.fansOnlyComment ? 1 : 0,
  };
}

export function createWechatOfficialAccountConnector(options) {
  const appId = requiredText(options?.appId, '微信公众号 AppID');
  const appSecret = requiredText(options?.appSecret, '微信公众号 AppSecret');
  const fetchImpl = options?.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('当前运行时不支持 fetch');
  const now = options?.now || (() => Date.now());
  const tokenCache = options?.tokenCache || null;

  async function accessToken(forceRefresh = false) {
    if (!forceRefresh && tokenCache?.get) {
      const cached = await tokenCache.get();
      if (cached?.token && Number(cached.expiresAt) > now() + 60_000) return cached.token;
    }
    const query = new URLSearchParams({ grant_type: 'client_credential', appid: appId, secret: appSecret });
    const response = await fetchImpl(`${API_ROOT}/token?${query}`, { method: 'GET' });
    const payload = await parseResponse(response);
    const token = requiredText(payload.access_token, '微信 Access Token');
    const expiresAt = now() + Math.max(300, Number(payload.expires_in) || 7200) * 1000;
    await tokenCache?.set?.({ token, expiresAt });
    return token;
  }

  async function validateConnection() {
    await accessToken(true);
    return { validated: true };
  }

  async function authorizedRequest(path, init, retry = true) {
    const token = await accessToken(false);
    const separator = path.includes('?') ? '&' : '?';
    try {
      return await parseResponse(await fetchImpl(`${API_ROOT}${path}${separator}access_token=${encodeURIComponent(token)}`, init));
    } catch (error) {
      if (retry && error?.code === 'WECHAT_TOKEN_INVALID') {
        const refreshed = await accessToken(true);
        return parseResponse(await fetchImpl(`${API_ROOT}${path}${separator}access_token=${encodeURIComponent(refreshed)}`, init));
      }
      throw error;
    }
  }

  async function uploadImage({ bytes, fileName = 'image.png', mimeType = 'image/png', permanent = false }) {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
      throw new WechatConnectorError('图片内容不能为空', { code: 'INVALID_INPUT' });
    }
    const form = new FormData();
    form.append('media', new Blob([bytes], { type: mimeType }), fileName);
    const path = permanent ? '/material/add_material?type=image' : '/media/uploadimg';
    const result = await authorizedRequest(path, { method: 'POST', body: form });
    return permanent
      ? { mediaId: requiredText(result.media_id, '微信素材 ID'), url: result.url || null }
      : { url: requiredText(result.url, '微信图片地址') };
  }

  async function createDraft(articles) {
    if (!Array.isArray(articles) || articles.length === 0 || articles.length > 8) {
      throw new WechatConnectorError('微信草稿必须包含 1 至 8 篇文章', { code: 'INVALID_INPUT' });
    }
    const result = await authorizedRequest('/draft/add', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ articles: articles.map(articlePayload) }),
    });
    return { mediaId: requiredText(result.media_id, '微信草稿 ID') };
  }

  async function publish(mediaId) {
    const result = await authorizedRequest('/freepublish/submit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ media_id: requiredText(mediaId, '微信草稿 ID') }),
    });
    return { publishId: requiredText(result.publish_id, '微信发布任务 ID'), messageId: result.msg_data_id || null };
  }

  async function publicationStatus(publishId) {
    const result = await authorizedRequest('/freepublish/get', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ publish_id: requiredText(publishId, '微信发布任务 ID') }),
    });
    const items = Array.isArray(result.article_detail?.item) ? result.article_detail.item : [];
    const urls = items.map((item) => item?.article_url).filter((url) => typeof url === 'string' && /^https:\/\//i.test(url));
    return {
      status: result.publish_status,
      articleId: result.article_id || null,
      urls,
      url: urls[0] || null,
      failIndex: result.fail_idx ?? null,
    };
  }

  return { accessToken, validateConnection, uploadImage, createDraft, publish, publicationStatus };
}
