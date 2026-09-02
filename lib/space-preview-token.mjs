import jwt from 'jsonwebtoken';

const PREVIEW_SECRET = `${process.env.JWT_SECRET || 'almaren-chat-secret-key'}:space-preview:v1`;
const SAFE_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

function validId(value) {
  return typeof value === 'string' && SAFE_ID_PATTERN.test(value);
}

export function signSpacePreviewToken(payload) {
  return jwt.sign({ ...payload, tokenType: 'space-preview' }, PREVIEW_SECRET, {
    audience: 'space-preview',
    expiresIn: '5m',
  });
}

export function verifySpacePreviewToken(token) {
  try {
    const payload = jwt.verify(token, PREVIEW_SECRET, { audience: 'space-preview' });
    if (
      payload?.tokenType !== 'space-preview'
      || !validId(payload.userId)
      || !validId(payload.spaceId)
      || !['space', 'staging'].includes(payload.root)
    ) return null;
    if (payload.root === 'staging') {
      if (!validId(payload.taskId) || !Number.isSafeInteger(payload.attempt) || payload.attempt < 1) return null;
    }
    return {
      userId: payload.userId,
      spaceId: payload.spaceId,
      root: payload.root,
      externalImages: payload.externalImages === true,
      taskId: payload.root === 'staging' ? payload.taskId : undefined,
      attempt: payload.root === 'staging' ? payload.attempt : undefined,
    };
  } catch {
    return null;
  }
}
