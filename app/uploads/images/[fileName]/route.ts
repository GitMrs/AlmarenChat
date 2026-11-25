import { readFile } from 'node:fs/promises';
import path from 'node:path';

const imageTypes = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
} as const;

export async function GET(_request: Request, { params }: { params: Promise<{ fileName: string }> }) {
  const { fileName } = await params;
  const extension = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp|gif)$/.exec(fileName)?.[1];
  if (!extension) return new Response(null, { status: 404 });

  try {
    const file = await readFile(path.join(process.cwd(), 'public', 'uploads', 'images', fileName));
    return new Response(file, {
      headers: {
        'Content-Type': imageTypes[extension as keyof typeof imageTypes],
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Response(null, { status: 404 });
    throw error;
  }
}
