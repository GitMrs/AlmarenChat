'use client';

export default function GomokuBoard({ board }: { board: number[] }) {
  if (board.length !== 225) return null;
  return (
    <div className="mt-3 w-full max-w-[360px] border border-[#9c6b2d] bg-[#d9a85d] p-[3.333%] shadow-sm" aria-label="当前五子棋棋盘">
      <div className="grid aspect-square grid-cols-[repeat(15,minmax(0,1fr))]">
        {board.map((cell, index) => (
          <div key={index} className="relative aspect-square before:absolute before:left-0 before:right-0 before:top-1/2 before:h-px before:-translate-y-1/2 before:bg-[#805a2f66] after:absolute after:bottom-0 after:left-1/2 after:top-0 after:w-px after:-translate-x-1/2 after:bg-[#805a2f66]">
            {cell !== 0 && <span className={`absolute left-1/2 top-1/2 z-10 aspect-square w-[88%] -translate-x-1/2 -translate-y-1/2 rounded-full shadow-sm ${cell === 1 ? 'bg-[#17191c]' : 'border border-[#b8c0ca] bg-[#f8fafc]'}`} />}
          </div>
        ))}
      </div>
    </div>
  );
}
