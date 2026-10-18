'use client';

import React, { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import MotionStudio from '@/components/companion/studio/MotionStudio';
import './studio.css';

function StudioPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [authed, setAuthed] = useState<boolean | null>(null);

  useEffect(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    if (!token) {
      router.replace('/login?redirect=/companion/studio');
      return;
    }
    setAuthed(true);
  }, [router]);

  const character = searchParams.get('character') || 'nari';
  const motion = searchParams.get('motion') || '';

  if (authed !== true) {
    return <div style={{ padding: 20, color: '#fff' }}>正在验证访问权限…</div>;
  }

  return <MotionStudio initialCharacter={character} initialMotion={motion} />;
}

export default function StudioPage() {
  return (
    <Suspense fallback={<div style={{ padding: 20, color: '#fff' }}>动作工坊载入中…</div>}>
      <StudioPageContent />
    </Suspense>
  );
}
