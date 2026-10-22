'use client';

import { useState } from 'react';

// 五子棋 15×15 标准星位坐标 (1-indexed)
const STAR_POINTS = new Set(['4,4', '4,12', '8,8', '12,4', '12,12']);

export interface GomokuBoardProps {
  board: number[];
  interactive?: boolean;
  disabled?: boolean;
  lastMove?: { row: number; col: number } | null;
  winningLine?: Array<{ row: number; col: number }> | null;
  hintCell?: { row: number; col: number } | null;
  onCellClick?: (row: number, col: number) => void;
  className?: string;
}

export default function GomokuBoard({
  board,
  interactive = false,
  disabled = false,
  lastMove,
  winningLine,
  hintCell,
  onCellClick,
  className = '',
}: GomokuBoardProps) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  // 保证棋盘数据非空且有效，防御性处理
  const safeBoard = Array.isArray(board) && board.length === 225 ? board : Array(225).fill(0);
  const winningSet = new Set(winningLine?.map((p) => `${p.row},${p.col}`) || []);

  const handleClick = (row: number, col: number, cellValue: number) => {
    if (!interactive || disabled || cellValue !== 0 || !onCellClick) return;
    onCellClick(row, col);
  };

  return (
    <div
      className={`relative select-none rounded-md border-2 p-3 shadow-lg ${className}`}
      aria-label="五子棋棋盘"
      style={{
        backgroundColor: '#e6b972',
        borderColor: '#8b5a2b',
        boxShadow: 'inset 0 0 24px rgba(120, 70, 20, 0.3), 0 8px 24px rgba(0,0,0,0.18)',
        width: '100%',
        maxWidth: '440px',
        aspectRatio: '1 / 1',
      }}
    >
      <div
        className="w-full h-full"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(15, minmax(0, 1fr))',
          gridTemplateRows: 'repeat(15, minmax(0, 1fr))',
          width: '100%',
          height: '100%',
          aspectRatio: '1 / 1',
        }}
      >
        {safeBoard.map((cell, index) => {
          const row = Math.floor(index / 15) + 1;
          const col = (index % 15) + 1;
          const key = `${row},${col}`;
          const isStarPoint = STAR_POINTS.has(key);
          const isLastMove = lastMove && lastMove.row === row && lastMove.col === col;
          const isWinningStone = winningSet.has(key);
          const isHint = hintCell && hintCell.row === row && hintCell.col === col;
          const isHovered = interactive && !disabled && hoverIndex === index && cell === 0;

          // 网格线边界处理（最外层边缘线不溢出）
          const leftLine = col > 1;
          const rightLine = col < 15;
          const topLine = row > 1;
          const bottomLine = row < 15;

          return (
            <div
              key={index}
              onClick={() => handleClick(row, col, cell)}
              onMouseEnter={() => setHoverIndex(index)}
              onMouseLeave={() => setHoverIndex(null)}
              className="relative flex items-center justify-center"
              style={{
                width: '100%',
                height: '100%',
                cursor: interactive && !disabled && cell === 0 ? 'pointer' : 'default',
              }}
            >
              {/* 水平十字网格线 */}
              <div
                className="absolute pointer-events-none"
                style={{
                  top: '50%',
                  transform: 'translateY(-50%)',
                  height: '1px',
                  backgroundColor: '#704214',
                  opacity: 0.85,
                  left: !leftLine ? '50%' : '0',
                  right: !rightLine ? '50%' : '0',
                }}
              />

              {/* 垂直十字网格线 */}
              <div
                className="absolute pointer-events-none"
                style={{
                  left: '50%',
                  transform: 'translateX(-50%)',
                  width: '1px',
                  backgroundColor: '#704214',
                  opacity: 0.85,
                  top: !topLine ? '50%' : '0',
                  bottom: !bottomLine ? '50%' : '0',
                }}
              />

              {/* 星位小圆点 */}
              {isStarPoint && cell === 0 && (
                <span
                  className="absolute pointer-events-none rounded-full z-0"
                  style={{
                    left: '50%',
                    top: '50%',
                    transform: 'translate(-50%, -50%)',
                    width: '6px',
                    height: '6px',
                    backgroundColor: '#5a320c',
                  }}
                />
              )}

              {/* 军师提示高亮 (绿圈脉冲) */}
              {isHint && cell === 0 && (
                <span
                  className="absolute pointer-events-none z-20 rounded-full animate-ping border-2"
                  style={{
                    left: '50%',
                    top: '50%',
                    transform: 'translate(-50%, -50%)',
                    width: '90%',
                    height: '90%',
                    borderColor: '#10b981',
                    backgroundColor: 'rgba(16, 185, 129, 0.35)',
                  }}
                />
              )}

              {/* 鼠标悬停半透明预览落子 */}
              {isHovered && (
                <span
                  className="pointer-events-none absolute z-10 rounded-full"
                  style={{
                    left: '50%',
                    top: '50%',
                    transform: 'translate(-50%, -50%)',
                    width: '85%',
                    height: '85%',
                    backgroundColor: 'rgba(23, 25, 28, 0.45)',
                    boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
                  }}
                />
              )}

              {/* 真实落下的棋子 */}
              {cell !== 0 && (
                <div
                  className="absolute z-10 flex items-center justify-center rounded-full transition-transform"
                  style={{
                    left: '50%',
                    top: '50%',
                    transform: `translate(-50%, -50%) ${isWinningStone ? 'scale(1.08)' : 'scale(1)'}`,
                    width: '88%',
                    height: '88%',
                    background:
                      cell === 1
                        ? 'radial-gradient(circle at 35% 35%, #4b5563, #1f2937 60%, #030712 100%)'
                        : 'radial-gradient(circle at 35% 35%, #ffffff, #f3f4f6 60%, #d1d5db 100%)',
                    boxShadow:
                      cell === 1
                        ? '1px 2px 5px rgba(0, 0, 0, 0.65), inset 0 1px 1px rgba(255,255,255,0.2)'
                        : '1px 2px 5px rgba(0, 0, 0, 0.3), inset 0 1px 1px rgba(255,255,255,0.8)',
                    border: cell === 2 ? '1px solid #cbd5e1' : 'none',
                    outline: isWinningStone ? '3px solid #f59e0b' : 'none',
                  }}
                >
                  {/* 最后一手指示红点标记 */}
                  {isLastMove && (
                    <span
                      className="rounded-full shadow-sm"
                      style={{
                        width: '7px',
                        height: '7px',
                        backgroundColor: '#ef4444',
                        boxShadow: '0 0 4px #ef4444',
                      }}
                    />
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
