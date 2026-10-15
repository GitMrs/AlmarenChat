'use client';

import React, { useState } from 'react';
import styles from './AlmarenIslandScene.module.css';

export type TimePhase = 'dawn' | 'day' | 'dusk' | 'night';
export type WeatherType = 'clear' | 'overcast' | 'cloudy' | 'rain' | 'snow';
export type Season = 'spring' | 'summer' | 'autumn' | 'winter';

export interface AlmarenIslandSceneProps {
  timePhase: TimePhase;
  weatherType: WeatherType;
  isWindy?: boolean;
  windScale?: number;
  windDir?: string;
  season?: Season;
  className?: string;
}

export default function AlmarenIslandScene({
  timePhase,
  weatherType,
  isWindy = false,
  windScale = 0,
  windDir = '',
  season = 'spring',
  className = '',
}: AlmarenIslandSceneProps) {
  const [treeShake, setTreeShake] = useState(false);
  const [isTreeHovered, setIsTreeHovered] = useState(false);
  const [petals, setPetals] = useState<Array<{ id: number; cx: number; cy: number; delay: number }>>([]);

  const isNight = timePhase === 'night';
  const isDusk = timePhase === 'dusk';
  const isDawn = timePhase === 'dawn';
  const isDarkSky = isNight || isDusk;

  // 根据气象风向确定飘落航向：西风由西吹向东(右)，东风由东吹向西(左)
  const isBlowingRight = /西/.test(windDir);
  const driftAnimationClass = isBlowingRight
    ? isWindy
      ? styles.petalDriftRightWindy
      : styles.petalDriftRight
    : isWindy
    ? styles.petalDriftLeftWindy
    : styles.petalDriftLeft;

  const handleTreeClick = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    setTreeShake(true);
    setTimeout(() => setTreeShake(false), 750);
    const now = Date.now();
    // 生成姿态各异、节奏舒缓的落叶/落樱（舒缓延时错开）
    setPetals((prev) => [
      ...prev.slice(-4),
      { id: now + 1, cx: 215, cy: 116, delay: 0 },
      { id: now + 2, cx: 226, cy: 114, delay: 0.28 },
      { id: now + 3, cx: 206, cy: 122, delay: 0.62 },
      { id: now + 4, cx: 220, cy: 126, delay: 0.98 },
    ]);
  };

  // 综合底色类名
  let bgClass = styles.day_clear;
  if (timePhase === 'dawn') {
    bgClass = styles.dawn;
  } else if (timePhase === 'dusk') {
    bgClass = styles.dusk;
  } else if (timePhase === 'night') {
    if (weatherType === 'snow') bgClass = styles.night_snow;
    else if (weatherType === 'rain') bgClass = styles.night_rain;
    else if (weatherType === 'overcast') bgClass = styles.night_overcast;
    else if (weatherType === 'cloudy') bgClass = styles.night_cloudy;
    else bgClass = styles.night_clear;
  } else {
    if (weatherType === 'snow') bgClass = styles.day_snow;
    else if (weatherType === 'rain') bgClass = styles.day_rain;
    else if (weatherType === 'overcast') bgClass = styles.day_overcast;
    else if (weatherType === 'cloudy') bgClass = styles.day_cloudy;
    else bgClass = styles.day_clear;
  }

  // 四季树冠与草地配色
  const seasonPalette = {
    spring: {
      tree1: '#f472b6', // 樱粉
      tree2: '#fb7185',
      grass: '#4ade80',
      grassShadow: '#22c55e',
    },
    summer: {
      tree1: '#22c55e', // 苍翠
      tree2: '#16a34a',
      grass: '#22c55e',
      grassShadow: '#15803d',
    },
    autumn: {
      tree1: '#f59e0b', // 金橙
      tree2: '#ea580c',
      grass: '#eab308',
      grassShadow: '#ca8a04',
    },
    winter: {
      tree1: '#94a3b8', // 霜灰
      tree2: '#64748b',
      grass: '#cbd5e1',
      grassShadow: '#94a3b8',
    },
  }[season];

  // 海水渐变色彩
  const seaFill = isNight
    ? 'url(#seaNight)'
    : isDusk
    ? 'url(#seaDusk)'
    : isDawn
    ? 'url(#seaDawn)'
    : 'url(#seaDay)';

  // 是否覆雪（下雪或冬季）
  const hasSnow = weatherType === 'snow' || season === 'winter';

  // 气象流云系统：航向、航速因子与色彩调配（微缩卡片调速：宁静悠缓，不喧宾夺主）
  const isEastWind = /东/.test(windDir);
  const cloudDriftClass = isEastWind ? styles.cloudDriftLeft : styles.cloudDriftRight;
  const cloudSpeedMultiplier = isWindy ? (windScale >= 5 ? 0.8 : 0.88) : 1;

  // 云彩色彩配合昼夜流转与气象调色
  let cloudFill = '#ffffff';
  if (isNight) {
    cloudFill = '#64748b'; // 夜间月下深灰蓝
  } else if (isDusk) {
    cloudFill = '#fdba74'; // 黄昏落霞暖橙
  } else if (isDawn) {
    cloudFill = '#fbcfe8'; // 清晨晨曦粉樱
  } else if (weatherType === 'overcast' || weatherType === 'rain' || weatherType === 'snow') {
    cloudFill = '#cbd5e1'; // 阴雨沉稳青灰
  }

  // 远景雪山与山影色系（随昼夜流转与气象渲染：晨曦映粉雪、黄昏日照金山、夜幕冷月黛影、晴日蔚蓝青翠）
  const mountainPalette = (() => {
    if (isNight) {
      return {
        top: '#334155',
        base: '#0f172a',
        topOpacity: '0.55',
        baseOpacity: '0.25',
        farTop: '#1e293b',
        farOpacity: '0.35',
        snow: '#93c5fd', // 冷月微光淡蓝雪
        overallOpacity: 0.7,
      };
    }
    if (isDusk) {
      return {
        top: '#7c3aed',
        base: '#3b0764',
        topOpacity: '0.65',
        baseOpacity: '0.3',
        farTop: '#a855f7',
        farOpacity: '0.45',
        snow: '#fed7aa', // 落日熔金暖金顶 (日照金山)
        overallOpacity: 0.85,
      };
    }
    if (isDawn) {
      return {
        top: '#ec4899',
        base: '#4c1d95',
        topOpacity: '0.55',
        baseOpacity: '0.25',
        farTop: '#f472b6',
        farOpacity: '0.4',
        snow: '#fdf2f8', // 晨曦朝霞粉雪
        overallOpacity: 0.8,
      };
    }
    if (weatherType === 'overcast' || weatherType === 'rain' || weatherType === 'snow') {
      return {
        top: '#64748b',
        base: '#334155',
        topOpacity: '0.5',
        baseOpacity: '0.2',
        farTop: '#475569',
        farOpacity: '0.35',
        snow: '#ffffff',
        overallOpacity: 0.65,
      };
    }
    // 白昼晴朗 / 多云
    return {
      top: '#60a5fa',
      base: '#1e3a8a',
      topOpacity: '0.45',
      baseOpacity: '0.15',
      farTop: '#93c5fd',
      farOpacity: '0.35',
      snow: '#ffffff', // 晴空白雪
      overallOpacity: 0.75,
    };
  })();

  // 多层次流云参数配置：错落分布于不同高度，悠然缓行（88s~135s漫游天际）
  const cloudConfigs = [
    {
      id: 'cloud-high-cirrus',
      y: 26,
      scale: 0.85,
      baseDuration: 135,
      delay: -42,
      bobClass: styles.cloudBob1,
      // 柔和高空卷云
      path: 'M 8,16 C 2,16 0,13 3,10 C 8,6 18,7 26,4 C 36,0 52,2 62,6 C 72,5 82,8 86,12 C 88,15 84,17 78,17 C 65,17 50,15 35,16 Z',
      opacity: isDarkSky ? 0.32 : 0.45,
    },
    {
      id: 'cloud-sun-transit',
      y: 48,
      scale: 1.15,
      baseDuration: 105,
      delay: -72,
      bobClass: styles.cloudBob2,
      // 饱满积云：横穿日月光芒区间，透射晨曦与落日暖光，绝不刻意给太阳让路
      path: 'M 10,24 C 4,24 0,19 0,14 C 0,8 6,4 12,4 C 15,1 22,0 30,1 C 38,2 44,7 46,11 C 51,9 57,9 62,13 C 68,13 72,17 72,21 C 72,24 67,25 62,25 Z',
      opacity: isDarkSky ? 0.38 : 0.62,
    },
    {
      id: 'cloud-mid-breeze',
      y: 78,
      scale: 0.95,
      baseDuration: 88,
      delay: -41,
      bobClass: styles.cloudBob3,
      // 中空舒卷流云：在天海之间自由穿行
      path: 'M 6,15 C 1,15 0,11 4,8 C 8,5 16,5 22,3 C 30,1 38,4 42,7 C 48,8 52,12 50,15 C 46,16 35,15 25,15 Z',
      opacity: isDarkSky ? 0.30 : 0.52,
    },
    {
      id: 'cloud-horizon-wisp',
      y: 106,
      scale: 1.05,
      baseDuration: 120,
      delay: -98,
      bobClass: styles.cloudBob4,
      // 远洋低空长云：在海平面与浮岛后侧隐现，带来深远景深
      path: 'M 5,20 C 0,20 0,15 5,12 C 10,8 18,10 25,6 C 35,2 45,5 52,8 C 60,7 70,11 74,15 C 76,19 70,21 62,21 C 48,21 32,19 18,20 Z',
      opacity: isDarkSky ? 0.28 : 0.48,
    },
  ];

  // 气象动态丰富度：
  // 晴天：3朵流云纵跨高、中、拂日空域，开阔舒朗
  // 多云与阴雨：4层流云全空域覆盖，高低错落，气势盎然
  const activeClouds =
    weatherType === 'clear'
      ? [cloudConfigs[0], cloudConfigs[1], cloudConfigs[2]]
      : cloudConfigs;

  return (
    <div className={`${styles.container} ${bgClass} ${className}`}>
      <svg
        viewBox="0 0 360 220"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        preserveAspectRatio="xMidYMid slice"
        className="w-full h-full"
      >
        <defs>
          {/* 海水渐变 */}
          <linearGradient id="seaDay" x1="180" y1="165" x2="180" y2="220" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.75" />
            <stop offset="100%" stopColor="#0284c7" stopOpacity="0.95" />
          </linearGradient>
          <linearGradient id="seaDawn" x1="180" y1="165" x2="180" y2="220" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#f472b6" stopOpacity="0.65" />
            <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.9" />
          </linearGradient>
          <linearGradient id="seaDusk" x1="180" y1="165" x2="180" y2="220" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#c084fc" stopOpacity="0.65" />
            <stop offset="100%" stopColor="#1e1b4b" stopOpacity="0.95" />
          </linearGradient>
          <linearGradient id="seaNight" x1="180" y1="165" x2="180" y2="220" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#1e293b" stopOpacity="0.85" />
            <stop offset="100%" stopColor="#050811" stopOpacity="0.98" />
          </linearGradient>

          {/* 浮岛岩层渐变 */}
          <linearGradient id="rockGrad" x1="250" y1="150" x2="250" y2="200" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor={isDarkSky ? '#334155' : '#64748b'} />
            <stop offset="100%" stopColor={isDarkSky ? '#0f172a' : '#334155'} />
          </linearGradient>

          {/* 灯塔光柱渐变 */}
          <linearGradient id="beamGrad" x1="308" y1="126" x2="100" y2="175" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#fef08a" stopOpacity="0.75" />
            <stop offset="35%" stopColor="#fde047" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#fde047" stopOpacity="0" />
          </linearGradient>

          {/* 太阳暖金光晕 */}
          <radialGradient id="sunGlowGrad" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#fef08a" stopOpacity="0.9" />
            <stop offset="45%" stopColor="#f59e0b" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#f59e0b" stopOpacity="0" />
          </radialGradient>

          {/* 月光清辉 */}
          <radialGradient id="moonGlowGrad" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.9" />
            <stop offset="50%" stopColor="#93c5fd" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#93c5fd" stopOpacity="0" />
          </radialGradient>

          {/* 远景山影渐变 (主峰巍峨耸立于右侧 x=275, y=92) */}
          <linearGradient id="mountainGradMain" x1="275" y1="92" x2="275" y2="166" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor={mountainPalette.top} stopOpacity={mountainPalette.topOpacity} />
            <stop offset="100%" stopColor={mountainPalette.base} stopOpacity={mountainPalette.baseOpacity} />
          </linearGradient>
          <linearGradient id="mountainGradFar" x1="310" y1="104" x2="310" y2="166" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor={mountainPalette.farTop} stopOpacity={mountainPalette.farOpacity} />
            <stop offset="100%" stopColor={mountainPalette.base} stopOpacity="0.08" />
          </linearGradient>
        </defs>

        {/* ---------------- 1. 天体与云霄层 ---------------- */}
        {/* 星空（夜晚独占） */}
        {isNight && (
          <g className="starsLayer">
            {[
              [35, 25, 1.0, 0],
              [85, 38, 0.8, 0.4],
              [140, 20, 1.2, 1.1],
              [180, 42, 0.9, 0.7],
              [210, 18, 0.8, 1.5],
              [245, 32, 1.2, 0.2],
              [275, 15, 0.9, 1.8],
              [325, 28, 1.0, 0.9],
              [45, 65, 0.8, 1.3],
              [115, 75, 1.1, 0.5],
              [165, 60, 0.9, 2.1],
              [340, 60, 1.2, 1.6],
            ].map(([cx, cy, r, delay], i) => (
              <circle
                key={i}
                cx={cx}
                cy={cy}
                r={r}
                fill="#ffffff"
                className={styles.star}
                style={{ animationDelay: `${delay}s`, animationDuration: `${2.2 + (i % 3)}s` }}
              />
            ))}
          </g>
        )}

        {/* 太阳（白昼、清晨、黄昏） */}
        {!isNight && weatherType !== 'overcast' && (
          <g className={styles.sunGlow}>
            <circle
              cx={isDawn ? 295 : isDusk ? 290 : 295}
              cy={isDawn ? 60 : isDusk ? 65 : 42}
              r="40"
              fill="url(#sunGlowGrad)"
            />
            <circle
              cx={isDawn ? 295 : isDusk ? 290 : 295}
              cy={isDawn ? 60 : isDusk ? 65 : 42}
              r={isDusk ? 17 : 15}
              fill={isDusk ? '#ea580c' : isDawn ? '#f97316' : '#fef08a'}
            />
          </g>
        )}

        {/* 月牙与清辉（夜晚） */}
        {isNight && (
          <g className={styles.moonGlow}>
            <circle cx="290" cy="42" r="32" fill="url(#moonGlowGrad)" />
            {/* 月牙裁切 */}
            <path
              d="M 296,28 C 304,33 306,44 301,52 C 296,60 286,63 277,58 C 288,61 298,54 299,42 C 300,34 296,29 296,28 Z"
              fill="#fef08a"
              filter="drop-shadow(0 0 5px rgba(254, 240, 138, 0.8))"
            />
          </g>
        )}

        {/* ---------------- 1.5 动态海岛流云系统 (多层视差缓移与自然沉浮) ---------------- */}
        <g className="cloudsLayer">
          {activeClouds.map((c) => {
            const duration = Math.round(c.baseDuration * cloudSpeedMultiplier);
            return (
              <g
                key={c.id}
                className={`${cloudDriftClass} ${styles.cloudInteractive}`}
                style={{
                  animationDuration: `${duration}s`,
                  animationDelay: `${c.delay}s`,
                }}
              >
                <title>漫天流云 · 随风缓行</title>
                <g
                  className={c.bobClass}
                  transform={`translate(0, ${c.y}) scale(${c.scale})`}
                >
                  <path
                    d={c.path}
                    fill={cloudFill}
                    opacity={c.opacity}
                    filter={isDarkSky ? undefined : 'drop-shadow(0 1px 3px rgba(0, 0, 0, 0.05))'}
                  />
                </g>
              </g>
            );
          })}
        </g>

        {/* ---------------- 2. 远景海际雪山与黛色山峦 (主峰巍然耸立于右侧，左侧虚化留白避让文字) ---------------- */}
        <g id="distantMountains" opacity={mountainPalette.overallOpacity}>
          {/* 极远薄雾天际线山脊（右侧高耸，左侧平缓隐入水天） */}
          <path
            d="M 50,166 Q 100,158 140,150 Q 185,138 230,126 Q 275,110 310,104 Q 340,116 360,128 L 360,166 Z"
            fill="url(#mountainGradFar)"
          />

          {/* 中远景主雪峰：主峰高拔耸立于右方 (x=275, y=92)，次峰在 x=218，左侧低缓入海保全文字可读性 */}
          <path
            d="M 25,166 L 70,160 Q 120,152 165,138 L 195,125 Q 218,114 238,124 L 275,92 L 302,118 Q 328,132 355,144 L 360,148 L 360,166 Z"
            fill="url(#mountainGradMain)"
          />

          {/* 右侧巍峨主峰 · 银白/金顶积雪 (x=275, y=92) */}
          <path
            d="M 275,92 L 289,109 Q 281,113 275,110 Q 268,114 261,107 Z"
            fill={mountainPalette.snow}
            opacity="0.9"
          />

          {/* 次峰积雪点缀 (x=218, y=114) */}
          <path
            d="M 218,114 L 226,122 Q 220,125 214,123 L 209,120 Z"
            fill={mountainPalette.snow}
            opacity="0.78"
          />

          {/* 冬季或降雪天气：主峰雪线漫延整个右侧山腰 */}
          {hasSnow && (
            <path
              d="M 275,92 L 298,118 Q 284,124 275,118 Q 258,124 248,116 Z"
              fill="#ffffff"
              opacity="0.92"
            />
          )}
        </g>

        {/* ---------------- 3. 海水与波光层 ---------------- */}
        <g className="seaLayer">
          {/* 海水基底 */}
          <path
            d="M 0,165 C 60,162 120,168 180,164 C 240,160 300,166 360,163 L 360,220 L 0,220 Z"
            fill={seaFill}
          />
          {/* 后浪纹 */}
          <path
            d="M 10,175 Q 80,171 150,175 T 290,174"
            stroke="#ffffff"
            strokeWidth="0.8"
            strokeOpacity={isDarkSky ? '0.2' : '0.45'}
            fill="none"
            className={styles.seaWaveBack}
          />
          {/* 前浪纹 */}
          <path
            d="M 40,188 Q 120,184 200,189 T 340,187"
            stroke="#ffffff"
            strokeWidth="1.2"
            strokeOpacity={isDarkSky ? '0.25' : '0.55'}
            fill="none"
            className={styles.seaWaveFront}
          />
          {/* 水中月影/日影倒影 */}
          <ellipse
            cx="290"
            cy="176"
            rx="25"
            ry="2.5"
            fill={isNight ? '#fde047' : '#fdba74'}
            opacity={isNight ? 0.35 : 0.4}
            filter="blur(1.5px)"
          />
        </g>

        {/* ---------------- 3. 阿尔玛伦微缩浮岛 (The Isle) ---------------- */}
        <g id="isleGroup">
          {/* 浮岛岩体基座 */}
          <path
            d="M 160,170 C 172,156 198,148 230,146 C 275,143 318,146 345,155 C 352,165 345,178 325,188 C 295,200 240,202 195,196 C 170,192 155,182 160,170 Z"
            fill="url(#rockGrad)"
          />
          {/* 岩下倒悬阴影与棱角 */}
          <path
            d="M 180,178 L 198,198 L 225,188 L 260,202 L 295,186 L 330,194 L 340,175 C 305,190 230,194 180,178 Z"
            fill={isDarkSky ? '#020617' : '#1e293b'}
            opacity="0.8"
          />

          {/* 草甸地表 */}
          <path
            d="M 165,168 C 185,152 225,146 265,145 C 305,144 335,150 345,158 C 330,170 285,174 240,173 C 195,172 170,172 165,168 Z"
            fill={seasonPalette.grass}
          />
          <path
            d="M 200,165 C 240,160 290,162 335,164 C 300,173 250,173 200,165 Z"
            fill={seasonPalette.grassShadow}
            opacity="0.5"
          />

          {/* 冬季或雪天覆雪 */}
          {hasSnow && (
            <path
              d="M 170,164 C 190,152 230,147 268,146 C 305,145 330,150 342,156 C 328,162 290,160 250,159 C 200,158 175,164 170,164 Z"
              fill="#ffffff"
              opacity="0.9"
            />
          )}

          {/* 守望木屋 (Keeper's Cabin) */}
          <g transform="translate(255, 140)">
            {/* 烟囱 */}
            <rect x="13" y="1" width="3.5" height="7" rx="0.5" fill={isDarkSky ? '#334155' : '#475569'} />
            <rect x="12" y="0.5" width="5.5" height="1.5" rx="0.5" fill={isDarkSky ? '#1e293b' : '#334155'} />

            {/* 墙体 */}
            <rect x="0" y="8" width="18" height="12" rx="1" fill={isDarkSky ? '#475569' : '#94a3b8'} />
            {/* 屋顶 */}
            <polygon
              points="-2,8 9,0 20,8"
              fill={hasSnow ? '#ffffff' : isDarkSky ? '#1e293b' : '#64748b'}
            />
            {/* 温暖窗扉 */}
            <rect
              x="5"
              y="11"
              width="6"
              height="6"
              rx="0.8"
              fill={isDarkSky ? '#fbbf24' : '#bae6fd'}
              className={isDarkSky ? styles.windowWarm : undefined}
            />
          </g>

          {/* 灯塔 (The Lighthouse) */}
          <g transform="translate(295, 120)">
            {/* 塔身基座 */}
            <polygon
              points="6,34 18,34 15,10 9,10"
              fill={isDarkSky ? '#e2e8f0' : '#f8fafc'}
              stroke={isDarkSky ? '#334155' : '#cbd5e1'}
              strokeWidth="0.8"
            />
            {/* 塔顶灯房 */}
            <rect x="9" y="4" width="6" height="6" rx="0.5" fill={isDarkSky ? '#fbbf24' : '#bae6fd'} />
            {/* 塔尖圆顶 */}
            <polygon
              points="8,4 12,-1 16,4"
              fill={hasSnow ? '#ffffff' : '#ef4444'}
            />
            {/* 夜间与黄昏灯火光晕 */}
            {isDarkSky && (
              <circle
                cx="12"
                cy="7"
                r="7"
                fill="#fde047"
                opacity="0.6"
                className={styles.windowWarm}
              />
            )}
          </g>

          {/* 夜间灯塔旋转扫光光柱 */}
          {isDarkSky && (
            <polygon
              points="307,127 80,165 70,195 307,127"
              fill="url(#beamGrad)"
              className={styles.lighthouseBeam}
            />
          )}

          {/* 阿尔玛伦灵树 (The Sacred Tree - 支持点击与悬浮微交互) */}
          <g
            onClick={handleTreeClick}
            style={{
              filter: isTreeHovered ? 'brightness(1.18) drop-shadow(0 0 6px rgba(255, 255, 255, 0.7))' : undefined,
            }}
            className={styles.sacredTreeInteractive}
          >
            <title>轻触灵树 · 唤醒微风与落叶</title>

            {/* 灵树层级结构：树干腰部承载树冠 (Forward Kinematics 骨骼联动) */}
            <g
              className={
                treeShake ? styles.treeTrunkShake : isWindy ? styles.treeTrunkWindy : styles.treeTrunk
              }
            >
              {/* 主树干 (树根 215,158 紧固扎根，腰部柔韧屈伸) */}
              <path
                d="M 215,158 C 214,148 210,140 216,132 C 218,128 222,126 220,122"
                stroke="#78350f"
                strokeWidth="3.2"
                strokeLinecap="round"
              />
              {/* 侧枝分支 */}
              <path
                d="M 214,140 Q 206,134 204,128"
                stroke="#78350f"
                strokeWidth="1.8"
                strokeLinecap="round"
              />

              {/* 树冠子节点：生长于树梢(218, 122)，被树腰带动摆动，并叠加树叶的轻柔呼吸感 */}
              <g
                className={
                  treeShake ? styles.treeCanopyShake : isWindy ? styles.treeCanopyWindy : styles.treeCanopy
                }
              >
                {/* 树冠（三层蓬松圆弧，随四季换色） */}
                <circle cx="218" cy="116" r="16" fill={seasonPalette.tree1} opacity="0.95" />
                <circle cx="206" cy="124" r="12" fill={seasonPalette.tree2} opacity="0.92" />
                <circle cx="228" cy="122" r="13" fill={seasonPalette.tree1} opacity="0.88" />

                {/* 雪天在树冠顶部积上一层白雪 */}
                {hasSnow && (
                  <path
                    d="M 206,112 C 212,104 226,104 232,112 C 228,115 220,114 216,117 C 212,114 208,115 206,112 Z"
                    fill="#ffffff"
                  />
                )}
              </g>
            </g>
          </g>

          {/* 触碰灵树后结合风向与风速飘落的花瓣 / 枫叶 */}
          {petals.map((p) => (
            <g key={p.id} transform={`translate(${p.cx}, ${p.cy})`}>
              <g
                className={driftAnimationClass}
                style={{ animationDelay: `${p.delay}s` }}
              >
                <path
                  d="M 0,-2.6 C 2,-1.2 2,1.2 0,2.6 C -2,1.2 -2,-1.2 0,-2.6 Z"
                  fill={hasSnow ? '#ffffff' : seasonPalette.tree1}
                  opacity="0.95"
                />
              </g>
            </g>
          ))}
        </g>

        {/* ---------------- 4. 阴天浓云遮蔽层 ---------------- */}
        {(weatherType === 'overcast' || weatherType === 'cloudy') && (
          <g className={styles.cloudNear} opacity={weatherType === 'overcast' ? 0.75 : 0.45}>
            <path
              d="M 220,95 Q 240,75 265,78 Q 290,70 315,84 Q 340,84 355,100 L 220,100 Z"
              fill={isDarkSky ? '#334155' : '#ffffff'}
              filter="blur(1px)"
            />
          </g>
        )}
      </svg>

      {/* 灵树全域触控热区（覆盖在灵树坐标上，保障跨浏览器100%可点击与手势反馈） */}
      <button
        type="button"
        onClick={handleTreeClick}
        onMouseEnter={() => setIsTreeHovered(true)}
        onMouseLeave={() => setIsTreeHovered(false)}
        aria-label="轻触灵树 · 唤醒微风与落叶"
        title="轻触灵树 · 唤醒微风与落叶"
        className="absolute rounded-full outline-none transition-transform"
        style={{
          left: '52%',
          top: '43%',
          width: '18%',
          height: '30%',
          cursor: 'pointer',
          pointerEvents: 'auto',
          background: 'transparent',
          border: 'none',
          zIndex: 15,
        }}
      />

      {/* ---------------- 5. 降水与气流粒子层 ---------------- */}
      {/* 雨天 */}
      {weatherType === 'rain' && (
        <div className={styles.rainLayer} aria-hidden="true">
          {Array.from({ length: 16 }).map((_, i) => (
            <span
              key={i}
              className={isWindy ? styles.raindropWindy : styles.raindrop}
              style={{
                left: `${3 + i * 6.2}%`,
                animationDelay: `${-(i * 0.23)}s`,
                animationDuration: `${(isWindy ? 0.5 : 0.8) + (i % 3) * 0.15}s`,
              }}
            />
          ))}
        </div>
      )}

      {/* 雪天 */}
      {weatherType === 'snow' && (
        <div className={styles.snowLayer} aria-hidden="true">
          {Array.from({ length: 16 }).map((_, i) => (
            <span
              key={i}
              className={styles.snowflake}
              style={{
                left: `${4 + i * 6}%`,
                width: `${3 + (i % 3) * 1.5}px`,
                height: `${3 + (i % 3) * 1.5}px`,
                animationDelay: `${-(i * 0.37)}s`,
                animationDuration: `${3.5 + (i % 4) * 0.8}s`,
              }}
            />
          ))}
        </div>
      )}

      {/* 大风天流线 */}
      {isWindy && (
        <div className={styles.windLayer} aria-hidden="true">
          {[
            { top: '35%', width: '120px', delay: '0s', duration: '2.4s' },
            { top: '55%', width: '160px', delay: '0.8s', duration: '2.1s' },
            { top: '75%', width: '110px', delay: '1.4s', duration: '2.6s' },
          ].map((streak, i) => (
            <div
              key={i}
              className={styles.windStreak}
              style={{
                top: streak.top,
                width: streak.width,
                animationDelay: streak.delay,
                animationDuration: streak.duration,
              }}
            />
          ))}
        </div>
      )}

      {/* 夜间偶遇孤舟流星彩蛋 */}
      {isNight && weatherType !== 'rain' && weatherType !== 'snow' && (
        <div className={styles.shootingStar} aria-hidden="true" />
      )}
    </div>
  );
}
