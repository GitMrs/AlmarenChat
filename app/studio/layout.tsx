'use client';

import React from 'react';

export default function StudioLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden bg-[#fbfaf7] text-slate-900">
      {children}
    </div>
  );
}
