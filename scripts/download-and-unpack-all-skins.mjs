import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';

const PROXY = 'http://127.0.0.1:7897';
const REFERER = 'https://nariyume.com/app/';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';
const REFRESH = process.argv.includes('--refresh');

function DM(t) {
  const e = t.length, n = e >>> 2, r = new Uint8Array(e);
  for (let s = 0; s < n; s++) {
    const i = s * 4;
    r[i] = t[s];
    r[i + 1] = t[n + s];
    r[i + 2] = t[2 * n + s];
    r[i + 3] = t[3 * n + s];
  }
  for (let s = 4 * n; s < e; s++) r[s] = t[s];
  return r;
}

function PM(t, e) {
  const n = DM(t);
  if (e === 's4d8') {
    for (let r = 8; r < n.length; r++) n[r] = (n[r] + n[r - 8]) & 255;
  }
  return n;
}

function fetchFile(url, destPath) {
  if (!REFRESH && fs.existsSync(destPath) && fs.statSync(destPath).size > 0) {
    console.log(`[Cached] ${path.basename(destPath)}`);
    return;
  }
  console.log(`[Downloading] ${url} -> ${destPath}`);
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  const tmpPath = `${destPath}.${process.pid}.tmp`;
  try {
    execFileSync('curl', [
      '-x', PROXY,
      '-fL', '--retry', '3', '--retry-all-errors',
      '--connect-timeout', '15', '--max-time', '180',
      '-sS',
      '-H', `User-Agent: ${USER_AGENT}`,
      '-H', `Referer: ${REFERER}`,
      '-o', tmpPath,
      url,
    ], { stdio: 'inherit' });
    if (!fs.existsSync(tmpPath) || fs.statSync(tmpPath).size === 0) {
      throw new Error(`Downloaded file is empty: ${url}`);
    }
    fs.renameSync(tmpPath, destPath);
  } finally {
    if (fs.existsSync(tmpPath)) fs.rmSync(tmpPath, { force: true });
  }
}

function getVaultSalt() {
  const cmd = `curl -x ${PROXY} -s -H "User-Agent: ${USER_AGENT}" -H "Referer: ${REFERER}" "https://nariyume.com/api/vault-key"`;
  const res = execFileSync('curl', [
    '-x', PROXY, '-fL', '--retry', '3', '--retry-all-errors',
    '--connect-timeout', '15', '--max-time', '30', '-sS',
    '-H', `User-Agent: ${USER_AGENT}`,
    '-H', `Referer: ${REFERER}`,
    'https://nariyume.com/api/vault-key',
  ]).toString();
  const data = JSON.parse(res);
  if (!data.salt) throw new Error('Failed to retrieve vault salt: ' + res);
  return data.salt;
}

function decryptAndUnpack(koroFilePath, charName, outDir, salt) {
  console.log(`\n=== Unpacking ${charName} pack: ${path.basename(koroFilePath)} ===`);
  const hash = crypto.createHash('sha256').update(salt + charName).digest();

  const buf = fs.readFileSync(koroFilePath);
  if (buf.length < 28) throw new Error(`Pack ${koroFilePath} too small`);

  const iv = buf.subarray(0, 12);
  const ciphertextWithTag = buf.subarray(12);
  const tag = ciphertextWithTag.subarray(ciphertextWithTag.length - 16);
  const ciphertext = ciphertextWithTag.subarray(0, ciphertextWithTag.length - 16);

  const decipher = crypto.createDecipheriv('aes-256-gcm', hash, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  let decompressed;
  try {
    decompressed = zlib.gunzipSync(decrypted);
  } catch (e1) {
    decompressed = zlib.brotliDecompressSync(decrypted);
  }

  if (decompressed.length < 4) throw new Error(`Pack ${koroFilePath} has no manifest header`);
  const manifestLen = decompressed.readUInt32LE(0);
  if (manifestLen <= 0 || manifestLen > decompressed.length - 4) {
    throw new Error(`Invalid manifest length in ${koroFilePath}: ${manifestLen}`);
  }
  const manifest = JSON.parse(decompressed.subarray(4, 4 + manifestLen).toString('utf8'));
  const baseOffset = 4 + manifestLen;
  if (!manifest || !Array.isArray(manifest.parts) || !manifest.index) {
    throw new Error(`Invalid manifest in ${koroFilePath}`);
  }

  // A rerun must not leave stale files from an older pack in the skin.
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  let count = 0;
  for (const part of manifest.parts) {
    if (!part || typeof part.p !== 'string' || part.p.startsWith('/') || part.p.includes('\\')) {
      throw new Error(`Invalid asset path in ${koroFilePath}`);
    }
    const destPath = path.resolve(outDir, part.p);
    const outputRoot = path.resolve(outDir) + path.sep;
    if (!destPath.startsWith(outputRoot)) throw new Error(`Asset path escapes output directory: ${part.p}`);
    if (!Number.isInteger(part.o) || !Number.isInteger(part.n) || part.o < 0 || part.n < 0 || baseOffset + part.o + part.n > decompressed.length) {
      throw new Error(`Invalid asset range for ${part.p}`);
    }
    const rawData = decompressed.subarray(baseOffset + part.o, baseOffset + part.o + part.n);
    const finalData = part.x ? PM(rawData, part.x) : rawData;
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.writeFileSync(destPath, finalData);
    count++;
  }

  // Nari's published hybrid packs historically used a Yume-named directory
  // and rig file even though the rig metadata identifies the model as Nari.
  // Normalize that layout at extraction time so Nari never depends on a
  // Yume-named skeleton path.
  if (charName === 'Nari' && manifest.index.korig?.startsWith('Yume/')) {
    const sourceDir = path.join(outDir, 'Yume');
    const targetDir = path.join(outDir, 'Nari');
    if (fs.existsSync(sourceDir)) fs.renameSync(sourceDir, targetDir);

    const replaceYumePrefix = value =>
      typeof value === 'string' ? value.replace(/^Yume\//, 'Nari/') : value;
    const rewritePaths = value => {
      if (Array.isArray(value)) return value.map(rewritePaths);
      if (value && typeof value === 'object') {
        for (const [key, child] of Object.entries(value)) value[key] = rewritePaths(child);
        return value;
      }
      return replaceYumePrefix(value);
    };
    rewritePaths(manifest.index);

    const oldRig = path.join(targetDir, 'Yume.korig.json');
    const newRig = path.join(targetDir, 'Nari.korig.json');
    if (fs.existsSync(oldRig)) {
      fs.renameSync(oldRig, newRig);
      const rig = JSON.parse(fs.readFileSync(newRig, 'utf8'));
      if (rig.bin === 'Yume.korig.bin') rig.bin = 'Nari.korig.bin';
      fs.writeFileSync(newRig, JSON.stringify(rig, null, 2));
    }
    const oldBin = path.join(targetDir, 'Yume.korig.bin');
    const newBin = path.join(targetDir, 'Nari.korig.bin');
    if (fs.existsSync(oldBin)) fs.renameSync(oldBin, newBin);
  }

  fs.writeFileSync(path.join(outDir, 'manifest.index.json'), JSON.stringify(manifest.index, null, 2));
  console.log(`Extracted ${count} files to ${outDir}`);
  return manifest.index;
}

async function main() {
  if (REFRESH) console.log('Refresh mode enabled: existing downloads and unpacked skin directories will be replaced.');
  console.log('--- Step 1: Getting Vault Key Salt ---');
  const salt = getVaultSalt();
  console.log('Vault salt:', salt);

  console.log('\n--- Step 2: Downloading Backgrounds ---');
  const backgrounds = [
    { url: 'https://nariyume.com/app/assets/nari_room_day.jpg?v=20261007b', dest: 'public/companion/backgrounds/nari_room_day.jpg' },
    { url: 'https://nariyume.com/app/assets/yume_room_day.jpg?v=20261007b', dest: 'public/companion/backgrounds/yume_room_day.jpg' },
    { url: 'https://nariyume.com/testing/backgrounds/nari/rose-regalia-day-v003.webp', dest: 'public/companion/backgrounds/rose-regalia-day-v003.webp' },
    { url: 'https://nariyume.com/testing/backgrounds/nari/sakura-reverie-day-v003.webp', dest: 'public/companion/backgrounds/sakura-reverie-day-v003.webp' },
    { url: 'https://nariyume.com/testing/backgrounds/nari/sakura-streetwear-day-v003.webp', dest: 'public/companion/backgrounds/sakura-streetwear-day-v003.webp' },
    { url: 'https://nariyume.com/testing/backgrounds/yume/garden-day-v003.webp', dest: 'public/companion/backgrounds/garden-day-v003.webp' },
    { url: 'https://nariyume.com/testing/backgrounds/yume/reverie-day-v003.webp', dest: 'public/companion/backgrounds/reverie-day-v003.webp' },
    { url: 'https://nariyume.com/testing/backgrounds/yume/streetwear-day-v003.webp', dest: 'public/companion/backgrounds/streetwear-day-v003.webp' },
    { url: 'https://nariyume.com/testing/backgrounds/yume/nocturne-day-v003.webp', dest: 'public/companion/backgrounds/nocturne-day-v003.webp' },
  ];
  for (const bg of backgrounds) {
    fetchFile(bg.url, bg.dest);
  }

  console.log('\n--- Step 3: Downloading Portraits and Wardrobe Cards ---');
  const wardrobeCards = [
    { url: 'https://nariyume.com/testing/wardrobe/portraits/Nari.original.portrait.4b1b669d5a94.webp', dest: 'public/companion/wardrobe/portraits/Nari.original.webp' },
    { url: 'https://nariyume.com/testing/wardrobe/portraits/Nari.rose-regalia.base.portrait.838723ab3273.webp', dest: 'public/companion/wardrobe/portraits/Nari.rose-regalia.webp' },
    { url: 'https://nariyume.com/testing/wardrobe/portraits/Nari.sakura-reverie.base.portrait.b3249f73f30b.webp', dest: 'public/companion/wardrobe/portraits/Nari.sakura-reverie.webp' },
    { url: 'https://nariyume.com/testing/wardrobe/portraits/Nari.sakura-streetwear.base.portrait.e7d9860b985e.webp', dest: 'public/companion/wardrobe/portraits/Nari.sakura-streetwear.webp' },
    { url: 'https://nariyume.com/testing/wardrobe/portraits/Yume.original.portrait.5077d990b13a.webp', dest: 'public/companion/wardrobe/portraits/Yume.original.webp' },
    { url: 'https://nariyume.com/testing/wardrobe/portraits/Yume.azure-reverie.base.portrait.e942d2f3bb64.webp', dest: 'public/companion/wardrobe/portraits/Yume.azure-reverie.webp' },
    { url: 'https://nariyume.com/testing/wardrobe/portraits/Yume.azure-streetwear.base.portrait.4e3fe24bf265.webp', dest: 'public/companion/wardrobe/portraits/Yume.azure-streetwear.webp' },
    { url: 'https://nariyume.com/testing/wardrobe/portraits/Yume.sapphire-nocturne.base.portrait.1451b4b9b14a.webp', dest: 'public/companion/wardrobe/portraits/Yume.sapphire-nocturne.webp' },
    { url: 'https://nariyume.com/testing/wardrobe/cards/Nari.ears.card.f19ea321893b.webp', dest: 'public/companion/wardrobe/cards/Nari.ears.webp' },
    { url: 'https://nariyume.com/testing/wardrobe/cards/Nari.rose-regalia.base.card.12f52cf50d3f.webp', dest: 'public/companion/wardrobe/cards/Nari.rose-regalia.webp' },
    { url: 'https://nariyume.com/testing/wardrobe/cards/Nari.sakura-reverie.base.card.46b83a982da9.webp', dest: 'public/companion/wardrobe/cards/Nari.sakura-reverie.webp' },
    { url: 'https://nariyume.com/testing/wardrobe/cards/Nari.sakura-streetwear.base.card.86522a787888.webp', dest: 'public/companion/wardrobe/cards/Nari.sakura-streetwear.webp' },
    { url: 'https://nariyume.com/testing/wardrobe/cards/Yume.ears.card.937030405ad0.webp', dest: 'public/companion/wardrobe/cards/Yume.ears.webp' },
    { url: 'https://nariyume.com/testing/wardrobe/cards/Yume.azure-reverie.base.card.a9d4a5146ff6.webp', dest: 'public/companion/wardrobe/cards/Yume.azure-reverie.webp' },
    { url: 'https://nariyume.com/testing/wardrobe/cards/Yume.azure-streetwear.base.card.96eec2ffac6c.webp', dest: 'public/companion/wardrobe/cards/Yume.azure-streetwear.webp' },
    { url: 'https://nariyume.com/testing/wardrobe/cards/Yume.sapphire-nocturne.base.card.97277579c1b5.webp', dest: 'public/companion/wardrobe/cards/Yume.sapphire-nocturne.webp' },
  ];
  for (const card of wardrobeCards) {
    fetchFile(card.url, card.dest);
  }

  console.log('\n--- Step 4: Downloading and Decrypting Model Packs ---');
  const skins = [
    {
      char: 'Nari',
      skinId: 'sakura-streetwear',
      label: '樱花机能潮服',
      url: 'https://nariyume.com/testing/models/Nari.sakura-streetwear.base.hd.ba44fd8ff9e4449c.koro',
      outDir: 'public/companion/skins/nari/sakura-streetwear',
      background: '/companion/backgrounds/sakura-streetwear-day-v003.webp',
      card: '/companion/wardrobe/cards/Nari.sakura-streetwear.webp',
      portrait: '/companion/wardrobe/portraits/Nari.sakura-streetwear.webp'
    },
    {
      char: 'Nari',
      skinId: 'rose-regalia',
      label: '玫瑰华服礼服',
      url: 'https://nariyume.com/testing/models/Nari.rose-regalia.base.hd.fe808dea54bdf2b0.koro',
      outDir: 'public/companion/skins/nari/rose-regalia',
      background: '/companion/backgrounds/rose-regalia-day-v003.webp',
      card: '/companion/wardrobe/cards/Nari.rose-regalia.webp',
      portrait: '/companion/wardrobe/portraits/Nari.rose-regalia.webp'
    },
    {
      char: 'Nari',
      skinId: 'sakura-reverie',
      label: '樱花梦境泳装',
      url: 'https://nariyume.com/testing/models/Nari.sakura-reverie.base.hd.1ea6e5f6fd799366.koro',
      outDir: 'public/companion/skins/nari/sakura-reverie',
      background: '/companion/backgrounds/sakura-reverie-day-v003.webp',
      card: '/companion/wardrobe/cards/Nari.sakura-reverie.webp',
      portrait: '/companion/wardrobe/portraits/Nari.sakura-reverie.webp'
    },
    {
      char: 'Nari',
      skinId: 'original-ears',
      label: '猫耳兽耳萌态',
      url: 'https://nariyume.com/testing/models/Nari.original.hd.bdde1453fec020c5.koro',
      outDir: 'public/companion/skins/nari/original-ears',
      background: '/companion/backgrounds/nari_room_day.jpg',
      card: '/companion/wardrobe/cards/Nari.ears.webp',
      portrait: '/companion/wardrobe/portraits/Nari.original.webp'
    },
    {
      char: 'Yume',
      skinId: 'azure-streetwear',
      label: '蔚蓝机能潮服',
      url: 'https://nariyume.com/testing/models/Yume.azure-streetwear.base.hd.2cfde4ee7752460d.koro',
      outDir: 'public/companion/skins/yume/azure-streetwear',
      background: '/companion/backgrounds/streetwear-day-v003.webp',
      card: '/companion/wardrobe/cards/Yume.azure-streetwear.webp',
      portrait: '/companion/wardrobe/portraits/Yume.azure-streetwear.webp'
    },
    {
      char: 'Yume',
      skinId: 'sapphire-nocturne',
      label: '蓝宝石晚宴夜曲',
      url: 'https://nariyume.com/testing/models/Yume.sapphire-nocturne.base.hd.9d0c099b5a6f5f8e.koro',
      outDir: 'public/companion/skins/yume/sapphire-nocturne',
      background: '/companion/backgrounds/nocturne-day-v003.webp',
      card: '/companion/wardrobe/cards/Yume.sapphire-nocturne.webp',
      portrait: '/companion/wardrobe/portraits/Yume.sapphire-nocturne.webp'
    },
    {
      char: 'Yume',
      skinId: 'azure-reverie',
      label: '蔚蓝梦境泳装',
      url: 'https://nariyume.com/testing/models/Yume.azure-reverie.base.hd.550e270322be9e2e.koro',
      outDir: 'public/companion/skins/yume/azure-reverie',
      background: '/companion/backgrounds/reverie-day-v003.webp',
      card: '/companion/wardrobe/cards/Yume.azure-reverie.webp',
      portrait: '/companion/wardrobe/portraits/Yume.azure-reverie.webp'
    },
    {
      char: 'Yume',
      skinId: 'original-ears',
      label: '猫耳兽耳萌态',
      url: 'https://nariyume.com/testing/models/Yume.original.hd.699728ba6501a550.koro',
      outDir: 'public/companion/skins/yume/original-ears',
      background: '/companion/backgrounds/yume_room_day.jpg',
      card: '/companion/wardrobe/cards/Yume.ears.webp',
      portrait: '/companion/wardrobe/portraits/Yume.original.webp'
    },
  ];

  const tmpDir = '/tmp/nariyume-packs';
  fs.mkdirSync(tmpDir, { recursive: true });

  const skinCatalog = [];

  for (const s of skins) {
    const tmpPack = path.join(tmpDir, `${s.char}.${s.skinId}.koro`);
    fetchFile(s.url, tmpPack);
    const index = decryptAndUnpack(tmpPack, s.char, s.outDir, salt);
    
    // Normalize rig and bin path
    // In manifest.index, check if rig or bin exists
    const rigFile = index.korig;
    const binFile = rigFile?.replace(/\.json$/i, '.bin');
    if (!rigFile || !binFile || !fs.existsSync(path.join(s.outDir, rigFile)) || !fs.existsSync(path.join(s.outDir, binFile))) {
      throw new Error(`Pack ${s.skinId} does not contain the rig declared by its manifest`);
    }

    skinCatalog.push({
      characterId: s.char.toLowerCase(),
      skinId: s.skinId,
      label: s.label,
      card: s.card,
      portrait: s.portrait,
      background: s.background,
      dir: s.outDir.replace(/^public\//, '/'),
      ...(s.char === 'Nari' ? { assetDir: 'Nari' } : {}),
      rig: rigFile,
      binary: binFile,
      textures: index.textures || [],
      tuning: index.tuning || null,
      physics: index.physics || null,
      pose: index.pose || null,
    });
  }

  fs.writeFileSync('lib/companion/skins-manifest.json', JSON.stringify(skinCatalog, null, 2));
  console.log('\nSaved skins catalog to lib/companion/skins-manifest.json!');
  console.log('ALL SKINS AND ASSETS SUCCESSFULLY DOWNLOADED AND UNPACKED!');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
