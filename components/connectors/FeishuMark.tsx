export default function FeishuMark({ small = false }: { small?: boolean }) {
  return <span aria-hidden="true" className={`inline-flex shrink-0 items-center justify-center ${small ? 'h-10 w-10' : 'h-12 w-12'}`}>
    <img src="/icons/feishu.svg" width={40} height={40} className="block object-contain" draggable={false} alt="" />
  </span>;
}
