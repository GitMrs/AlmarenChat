'use client';

import { useRouter } from 'next/navigation';
import { ArrowRight, ShieldCheck } from 'lucide-react';

interface LoginRequiredProps {
  title: string;
  description: string;
}

export default function LoginRequired({ title, description }: LoginRequiredProps) {
  const router = useRouter();

  return (
    <section className="rounded-[32px] border border-dashed border-white/18 bg-white/[0.04] p-10 text-center">
      <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-3xl bg-white/[0.08] text-white/54">
        <ShieldCheck size={26} />
      </div>
      <h2 className="text-2xl font-black text-white">{title}</h2>
      <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-white/54">{description}</p>
      <button
        onClick={() => router.push('/login')}
        className="mt-6 inline-flex items-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-black text-[#19172a] shadow-sm"
      >
        登录 / 注册
        <ArrowRight size={16} />
      </button>
    </section>
  );
}
