'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { user } from './api';
import type { WeatherLocation } from '@/types/weather';

const LOCATION_CHANGED = 'almaren-weather-location-change';

export function useWeatherLocation() {
  const [location, setLocation] = useState<WeatherLocation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const version = useRef(0);

  useEffect(() => {
    let active = true;
    async function load() {
      const current = ++version.current;
      setLocation(null);
      setError('');
      if (!localStorage.getItem('token')) { setLoading(false); return; }
      setLoading(true);
      try {
        const result = await user.get();
        if (active && current === version.current) setLocation(result.user.defaultWeatherLocation || null);
      } catch {
        if (active && current === version.current) setError('读取天气地点失败，请刷新后重试');
      } finally {
        if (active && current === version.current) setLoading(false);
      }
    }
    function changed(event: Event) {
      version.current++;
      setLocation((event as CustomEvent<WeatherLocation | null>).detail);
      setLoading(false);
      setError('');
    }
    void load();
    window.addEventListener(LOCATION_CHANGED, changed);
    window.addEventListener('almaren-auth-change', load);
    return () => {
      active = false;
      version.current++;
      window.removeEventListener(LOCATION_CHANGED, changed);
      window.removeEventListener('almaren-auth-change', load);
    };
  }, []);

  const save = useCallback(async (selected: WeatherLocation | null) => {
    const token = localStorage.getItem('token');
    if (!token) throw new Error('请先登录后设置天气地点');
    const result = await user.update({ defaultWeatherLocation: selected });
    if (localStorage.getItem('token') !== token) return;
    window.dispatchEvent(new CustomEvent(LOCATION_CHANGED, { detail: result.user.defaultWeatherLocation || null }));
  }, []);

  return { location, loading, error, save };
}
