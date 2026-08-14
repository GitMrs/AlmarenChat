'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export default function ComposerShell({
  toolbar,
  rowClassName,
  children,
}: {
  toolbar?: ReactNode;
  rowClassName?: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-[24px] border border-black/[0.08] bg-[#fbfaf7] p-2 shadow-sm sm:rounded-[28px]">
      {toolbar && <div className="mb-1 flex px-1">{toolbar}</div>}
      <div className={cn('flex items-end gap-2', rowClassName)}>{children}</div>
    </div>
  );
}

