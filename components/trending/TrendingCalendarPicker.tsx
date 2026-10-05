'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Calendar, ChevronLeft, ChevronRight, ChevronDown, Flame, Clock, Sparkles } from 'lucide-react';

interface DateOption {
  date: string; // 'today' or 'YYYY-MM-DD'
  label: string;
  isToday?: boolean;
  rawDate: string;
}

interface TrendingCalendarPickerProps {
  selectedDate: string;
  availableDates: DateOption[];
  onSelectDate: (date: string) => void;
}

function getLocalISODate(d = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

export default function TrendingCalendarPicker({
  selectedDate,
  availableDates,
  onSelectDate,
}: TrendingCalendarPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const todayStr = useMemo(() => getLocalISODate(), []);

  // 当前日历正在查看的年月（默认定位在选中日期或今天所在的月份）
  const [viewYear, setViewYear] = useState(() => {
    const target = selectedDate === 'today' ? todayStr : selectedDate;
    return parseInt(target.split('-')[0], 10) || 2026;
  });
  const [viewMonth, setViewMonth] = useState(() => {
    const target = selectedDate === 'today' ? todayStr : selectedDate;
    return (parseInt(target.split('-')[1], 10) || 10) - 1; // 0-indexed
  });

  // 记录所有拥有真实归档数据的日期集合（含今天）
  const archivedDateSet = useMemo(() => {
    const set = new Set<string>();
    set.add(todayStr);
    availableDates.forEach((d) => {
      if (d.rawDate) set.add(d.rawDate);
      if (d.date && d.date !== 'today') set.add(d.date);
    });
    return set;
  }, [availableDates, todayStr]);

  // 高频快捷日期选项（通常为今日实时、昨天、前天）
  const quickDates = useMemo(() => {
    return availableDates.slice(0, 3);
  }, [availableDates]);

  // 点击外部自动关闭
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // 当外部选中的日期改变时，同步更新日历查看视图
  useEffect(() => {
    const target = selectedDate === 'today' ? todayStr : selectedDate;
    const parts = target.split('-');
    if (parts.length === 3) {
      setViewYear(parseInt(parts[0], 10));
      setViewMonth(parseInt(parts[1], 10) - 1);
    }
  }, [selectedDate, todayStr]);

  // 月份切换
  const handlePrevMonth = () => {
    if (viewMonth === 0) {
      setViewYear((y) => y - 1);
      setViewMonth(11);
    } else {
      setViewMonth((m) => m - 1);
    }
  };

  const handleNextMonth = () => {
    if (viewMonth === 11) {
      setViewYear((y) => y + 1);
      setViewMonth(0);
    } else {
      setViewMonth((m) => m + 1);
    }
  };

  // 生成当前月份网格数据（星期一到星期日）
  const calendarCells = useMemo(() => {
    const cells: {
      day: number;
      dateStr: string;
      isCurrentMonth: boolean;
      hasArchive: boolean;
      isToday: boolean;
      isSelected: boolean;
      isFuture: boolean;
    }[] = [];

    const firstDayOfMonth = new Date(Date.UTC(viewYear, viewMonth, 1));
    const daysInCurrentMonth = new Date(Date.UTC(viewYear, viewMonth + 1, 0)).getUTCDate();
    const daysInPrevMonth = new Date(Date.UTC(viewYear, viewMonth, 0)).getUTCDate();

    // 0 = 周日, 1 = 周一, ..., 6 = 周六
    // 转化为周一为第一列: 0 -> 6 (周日), 1 -> 0 (周一), ..., 6 -> 5 (周六)
    const rawFirstDay = firstDayOfMonth.getUTCDay();
    const startOffset = (rawFirstDay + 6) % 7;

    // 1. 上月填充日
    for (let i = startOffset - 1; i >= 0; i--) {
      const day = daysInPrevMonth - i;
      const prevMonthNum = viewMonth === 0 ? 12 : viewMonth;
      const prevYearNum = viewMonth === 0 ? viewYear - 1 : viewYear;
      const dateStr = `${prevYearNum}-${String(prevMonthNum).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const isFuture = dateStr > todayStr;
      cells.push({
        day,
        dateStr,
        isCurrentMonth: false,
        hasArchive: archivedDateSet.has(dateStr),
        isToday: dateStr === todayStr,
        isSelected: selectedDate === 'today' ? dateStr === todayStr : selectedDate === dateStr,
        isFuture,
      });
    }

    // 2. 当月日期
    for (let day = 1; day <= daysInCurrentMonth; day++) {
      const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const isFuture = dateStr > todayStr;
      cells.push({
        day,
        dateStr,
        isCurrentMonth: true,
        hasArchive: archivedDateSet.has(dateStr),
        isToday: dateStr === todayStr,
        isSelected: selectedDate === 'today' ? dateStr === todayStr : selectedDate === dateStr,
        isFuture,
      });
    }

    // 3. 下月补齐至 35 或 42 格
    const remaining = (7 - (cells.length % 7)) % 7;
    const totalNeeded = cells.length + remaining < 35 ? 35 : cells.length + remaining;
    const finalNextCount = totalNeeded - cells.length;

    for (let day = 1; day <= finalNextCount; day++) {
      const nextMonthNum = viewMonth === 11 ? 1 : viewMonth + 2;
      const nextYearNum = viewMonth === 11 ? viewYear + 1 : viewYear;
      const dateStr = `${nextYearNum}-${String(nextMonthNum).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const isFuture = dateStr > todayStr;
      cells.push({
        day,
        dateStr,
        isCurrentMonth: false,
        hasArchive: archivedDateSet.has(dateStr),
        isToday: dateStr === todayStr,
        isSelected: selectedDate === 'today' ? dateStr === todayStr : selectedDate === dateStr,
        isFuture,
      });
    }

    return cells;
  }, [viewYear, viewMonth, todayStr, archivedDateSet, selectedDate]);

  // 获取胶囊按钮上展示的文本
  const getTriggerLabel = () => {
    if (selectedDate === 'today') {
      return `今日实时 · ${todayStr}`;
    }
    const opt = availableDates.find((d) => d.date === selectedDate);
    if (opt) return opt.label;
    const parts = selectedDate.split('-');
    if (parts.length === 3) return `${parts[0]}-${parts[1]}-${parts[2]}`;
    return selectedDate;
  };

  const isTodayActive = selectedDate === 'today';

  return (
    <div className="relative inline-block z-50" ref={containerRef}>
      {/* 唯一一体化时光机触发胶囊 */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-2 rounded-xl px-3.5 py-1.5 text-xs font-bold transition shadow-sm ${
          isOpen
            ? isTodayActive
              ? 'ring-2 ring-amber-400 bg-amber-500 text-white shadow-amber-500/25'
              : 'ring-2 ring-indigo-400 bg-indigo-600 text-white shadow-indigo-600/25'
            : isTodayActive
            ? 'bg-amber-500 text-white hover:bg-amber-600 shadow-amber-500/20'
            : 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-indigo-600/20'
        }`}
        title="点击展开时光机日历，穿梭任意历史热榜"
      >
        <div className="flex items-center gap-1.5">
          {isTodayActive ? (
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-300 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400"></span>
            </span>
          ) : (
            <Calendar size={13} className="text-white" />
          )}
          <span>{getTriggerLabel()}</span>
          {!isTodayActive && (
            <span className="rounded bg-white/20 px-1 py-0.2 text-[10px] text-white">
              历史
            </span>
          )}
        </div>
        <ChevronDown
          size={13}
          className={`transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {/* 优雅日历浮层 Popover */}
      {isOpen && (
        <div className="absolute left-0 top-full z-[100] mt-2 w-80 rounded-3xl border border-slate-200 bg-white p-4 shadow-2xl ring-1 ring-black/5 dark:border-slate-800 dark:bg-slate-900 dark:ring-white/10 animate-in fade-in zoom-in-95 duration-150">
          {/* 1. 顶部高频快捷直达：今日实时、昨天、前天 */}
          <div className="mb-3 border-b border-slate-100 pb-3 dark:border-slate-800">
            <div className="mb-1.5 flex items-center justify-between px-1 text-[11px] font-bold text-slate-400 dark:text-slate-500">
              <span>快捷直达</span>
              <span className="text-[10px] text-amber-600 dark:text-amber-400">一键穿梭</span>
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {quickDates.map((opt) => {
                const isAct = selectedDate === opt.date;
                return (
                  <button
                    key={opt.date}
                    onClick={() => {
                      onSelectDate(opt.date);
                      setIsOpen(false);
                    }}
                    className={`flex items-center justify-center gap-1 rounded-xl px-2 py-1.5 text-xs font-bold transition ${
                      isAct
                        ? opt.isToday
                          ? 'bg-amber-500 text-white shadow-sm shadow-amber-500/30'
                          : 'bg-indigo-600 text-white shadow-sm shadow-indigo-600/30'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
                    }`}
                  >
                    {opt.isToday && (
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 inline-block mr-0.5"></span>
                    )}
                    <span className="truncate">{opt.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 2. 月份头部控制栏 */}
          <div className="mb-3 flex items-center justify-between px-1">
            <button
              onClick={handlePrevMonth}
              className="flex h-7 w-7 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white transition"
              title="上一月"
            >
              <ChevronLeft size={16} />
            </button>

            <div className="flex items-center gap-1 text-sm font-black text-slate-800 dark:text-white">
              <span>{viewYear}年</span>
              <span>{viewMonth + 1}月</span>
            </div>

            <button
              onClick={handleNextMonth}
              className="flex h-7 w-7 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white transition"
              title="下一月"
            >
              <ChevronRight size={16} />
            </button>
          </div>

          {/* 3. 星期行 */}
          <div className="mb-2 grid grid-cols-7 text-center text-[11px] font-bold text-slate-400 dark:text-slate-500">
            <span>一</span>
            <span>二</span>
            <span>三</span>
            <span>四</span>
            <span>五</span>
            <span>六</span>
            <span>日</span>
          </div>

          {/* 4. 日期网格 */}
          <div className="grid grid-cols-7 gap-1">
            {calendarCells.map((cell, idx) => {
              const { day, dateStr, isCurrentMonth, hasArchive, isToday, isSelected, isFuture } = cell;

              return (
                <button
                  key={`${dateStr}-${idx}`}
                  disabled={isFuture}
                  onClick={() => {
                    if (isFuture) return;
                    if (isToday) {
                      onSelectDate('today');
                    } else {
                      onSelectDate(dateStr);
                    }
                    setIsOpen(false);
                  }}
                  className={`group relative flex h-9 flex-col items-center justify-center rounded-xl text-xs font-bold transition ${
                    isSelected
                      ? 'bg-gradient-to-br from-amber-500 to-orange-500 text-white shadow-md shadow-orange-500/25'
                      : isFuture
                      ? 'text-slate-200 dark:text-slate-800 cursor-not-allowed'
                      : !isCurrentMonth
                      ? 'text-slate-300 hover:bg-slate-50 dark:text-slate-600 dark:hover:bg-slate-800/40'
                      : 'text-slate-700 hover:bg-amber-50 hover:text-amber-600 dark:text-slate-200 dark:hover:bg-slate-800'
                  }`}
                  title={
                    isFuture
                      ? '未来的日期'
                      : hasArchive
                      ? `${dateStr}：已收录完整热榜，点击即刻穿越！`
                      : `${dateStr}：暂无热榜快照`
                  }
                >
                  {/* 日期数字 */}
                  <span className="leading-none">{day}</span>

                  {/* 核心亮点：归档标识小圆点 */}
                  {hasArchive && !isSelected && (
                    <span className="absolute bottom-1 flex h-1.5 w-1.5 items-center justify-center">
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-500 shadow-sm shadow-amber-500/50"></span>
                    </span>
                  )}
                  {hasArchive && isSelected && (
                    <span className="absolute bottom-1 h-1 w-1 rounded-full bg-white"></span>
                  )}
                </button>
              );
            })}
          </div>

          {/* 5. 底部贴心状态栏与图例 */}
          <div className="mt-3.5 flex items-center justify-between border-t border-slate-100 pt-3 text-[11px] dark:border-slate-800">
            {/* 快速回到今日实时 */}
            <button
              onClick={() => {
                onSelectDate('today');
                setIsOpen(false);
              }}
              className="flex items-center gap-1.5 font-bold text-amber-600 hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-300 transition"
            >
              <Clock size={12} />
              <span>回到今日实时</span>
            </button>

            {/* 图例标识说明 */}
            <div className="flex items-center gap-1.5 text-slate-400">
              <span className="inline-block h-2 w-2 rounded-full bg-amber-500"></span>
              <span>有热榜可穿越</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
