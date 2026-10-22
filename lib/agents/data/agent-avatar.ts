import { Avatar as DiceBearAvatar, Style, type StyleDefinition } from '@dicebear/core';
import pixelArtDefinition from '@dicebear/styles/pixel-art.json';

const DICEBEAR_AVATAR_PREFIX = 'dicebear:pixel-art:';
const MAX_AVATAR_CACHE_SIZE = 256;
const MAX_AVATAR_SEED_LENGTH = 96;
const pixelArtStyle = new Style(pixelArtDefinition as unknown as StyleDefinition);
const avatarCache = new Map<string, string>();

export const DEFAULT_AGENT_AVATAR = `${DICEBEAR_AVATAR_PREFIX}almaren-agent-preview`;

export function createAgentAvatar(seed: string): string {
  const normalizedSeed = (seed.trim() || 'almaren-agent').slice(0, MAX_AVATAR_SEED_LENGTH);
  return `${DICEBEAR_AVATAR_PREFIX}${encodeURIComponent(normalizedSeed)}`;
}

function createRandomSuffix(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function createRandomAgentAvatar(seed = 'almaren-agent'): string {
  return createAgentAvatar(`${seed}-${createRandomSuffix()}`);
}

export function createRandomAgentAvatarOptions(count = 9): string[] {
  const batchSeed = createRandomSuffix();
  return Array.from({ length: count }, (_, index) =>
    createAgentAvatar(`almaren-${batchSeed}-${index + 1}`)
  );
}

export function resolveAgentAvatar(value: string): string | null {
  if (!value.startsWith(DICEBEAR_AVATAR_PREFIX)) return null;

  const encodedSeed = value.slice(DICEBEAR_AVATAR_PREFIX.length);
  let seed = encodedSeed;
  try {
    seed = decodeURIComponent(encodedSeed);
  } catch {
    // Keep malformed legacy seeds deterministic instead of failing rendering.
  }

  seed = (seed || 'almaren-agent').slice(0, MAX_AVATAR_SEED_LENGTH);
  const cached = avatarCache.get(seed);
  if (cached) return cached;

  const dataUri = new DiceBearAvatar(pixelArtStyle, {
    seed: seed || 'almaren-agent',
    backgroundColor: 'f1f5f9',
  }).toDataUri();
  avatarCache.set(seed, dataUri);
  if (avatarCache.size > MAX_AVATAR_CACHE_SIZE) {
    const oldestSeed = avatarCache.keys().next().value;
    if (oldestSeed) avatarCache.delete(oldestSeed);
  }
  return dataUri;
}
