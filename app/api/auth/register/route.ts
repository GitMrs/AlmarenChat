import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import prisma from '@/app/api/_lib/db';
import { signToken } from '@/app/api/_lib/auth';

export async function POST(request: Request) {
  try {
    const { email, password, name } = await request.json();

    if (!email || !password || !name) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return NextResponse.json({ error: 'Email already registered' }, { status: 409 });
    }

    const hashed = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { email, passwordHash: hashed, name },
    });

    const token = signToken(user.id);
    return NextResponse.json({
      token,
      user: { id: user.id, email: user.email, name: user.name, avatar: user.avatar },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
