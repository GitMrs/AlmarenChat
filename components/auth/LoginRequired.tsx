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
    <section className="rounded-[32px] border border-dashed border-slate-200 bg-white p-10 text-center shadow-sm">
      <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-3xl bg-[#fbfaf7] text-slate-500">
        <ShieldCheck size={26} />
      </div>
      <h2 className="text-2xl font-black text-slate-950">{title}</h2>
      <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-slate-500">{description}</p>
      <button
        onClick={() => router.push('/login')}
        className="mt-6 inline-flex items-center gap-2 rounded-full bg-slate-950 px-5 py-3 text-sm font-black text-white shadow-sm"
      >
        登录 / 注册
        <ArrowRight size={16} />
      </button>
    </section>
  );
}
