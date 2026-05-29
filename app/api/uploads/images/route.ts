import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { requireAuth } from '@/app/api/_lib/auth';

const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES: Record<string, { ext: string; mimeType: string }> = {
  jpeg: { ext: '.jpg', mimeType: 'image/jpeg' },
  png: { ext: '.png', mimeType: 'image/png' },
  webp: { ext: '.webp', mimeType: 'image/webp' },
  gif: { ext: '.gif', mimeType: 'image/gif' },
};

function detectImageType(bytes: Buffer) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return ALLOWED_IMAGE_TYPES.jpeg;
  }

  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return ALLOWED_IMAGE_TYPES.png;
  }

  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return ALLOWED_IMAGE_TYPES.webp;
  }

  if (bytes.length >= 6) {
    const header = bytes.subarray(0, 6).toString('ascii');
    if (header === 'GIF87a' || header === 'GIF89a') {
      return ALLOWED_IMAGE_TYPES.gif;
    }
  }

  return null;
}

export async function POST(request: Request) {
  try {
    requireAuth(request);

    const formData = await request.formData();
    const file = formData.get('file');

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Missing image file' }, { status: 400 });
    }

    if (file.size > MAX_IMAGE_SIZE) {
      return NextResponse.json({ error: 'Image must be smaller than 5MB' }, { status: 400 });
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const imageType = detectImageType(bytes);

    if (!imageType) {
      return NextResponse.json({ error: 'Only valid JPG, PNG, WEBP and GIF images are supported' }, { status: 400 });
    }

    const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'images');
    await mkdir(uploadDir, { recursive: true });

    const fileName = `${randomUUID()}${imageType.ext}`;
    const filePath = path.join(uploadDir, fileName);
    await writeFile(filePath, bytes);

    return NextResponse.json({
      attachment: {
        type: 'image',
        url: `/uploads/images/${fileName}`,
        name: file.name,
        mimeType: imageType.mimeType,
        size: file.size,
      },
    });
  } catch (e: any) {
    if (e.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
