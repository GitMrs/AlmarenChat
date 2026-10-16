'use client';

import { useEffect, useRef, useState } from 'react';
import WeatherLocationPicker from '@/components/shared/WeatherLocationPicker';
import { useWeatherLocation } from '@/lib/use-weather-location';

export default function WeatherLocationSettings() {
  const { location, loading, error, save } = useWeatherLocation();
  const [autoOpen, setAutoOpen] = useState<boolean | null>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const linked = window.location.hash === '#weather-location';
    setAutoOpen(linked);
    if (linked) root.current?.scrollIntoView({ block: 'center' });
  }, []);

  return (
    <div ref={root} id="weather-location" className="mt-4 flex scroll-mt-24 items-center justify-between gap-3 border-t border-black/[0.06] pt-3">
      <span className="shrink-0 text-sm font-bold text-slate-700">天气地点</span>
      {autoOpen !== null && <WeatherLocationPicker value={location} loading={loading} error={error} autoOpen={autoOpen} onChange={save} />}
    </div>
  );
}
