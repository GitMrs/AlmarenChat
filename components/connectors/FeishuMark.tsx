export default function FeishuMark({ small = false }: { small?: boolean }) {
  return <span aria-hidden="true" className={`inline-flex shrink-0 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-sm ${small ? 'h-10 w-10' : 'h-12 w-12'}`}>
    <svg width={small ? 23 : 28} height={small ? 23 : 28} viewBox="0 0 32 32" fill="none"><path d="M5 8l10 5 12-6-8 12L5 8Z" fill="white" /><path d="m5 8 14 11-4 7L5 8Z" fill="#93C5FD" /><path d="m19 19 8-12-4 17-8 2 4-7Z" fill="#5EEAD4" /></svg>
  </span>;
}
