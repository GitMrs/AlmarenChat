export const COMMON_SYMBOLS = new Set([
  'BTC', 'ETH', 'SOL', 'SUI', 'DOGE', 'XRP', 'BNB', 'PEPE', 'APT', 'AVAX',
  'LINK', 'NEAR', 'SHIB', 'ADA', 'TRX', 'DOT', 'ARB', 'OP', 'WIF', 'FET',
  'ORDI', 'SATS', 'TIA', 'SEI', 'TAO', 'RENDER', 'TON', 'AAVE', 'UNI', 'FIL'
]);

/**
 * 从用户消息中提取可能提及的加密代币 Symbol
 */
export function extractCryptoSymbolFromText(text) {
  if (!text || typeof text !== 'string') return null;
  const upper = text.toUpperCase();

  // 1. 优先匹配主流币代码
  for (const sym of COMMON_SYMBOLS) {
    const pattern = new RegExp(`(?:^|[^A-Z0-9])${sym}(?:[^A-Z0-9]|$)`, 'i');
    if (pattern.test(upper)) {
      return sym;
    }
  }

  // 2. 匹配通用的 XXX-USDT 或 XXXUSDT 形式
  const pairMatch = upper.match(/\b([A-Z0-9]{2,10})[-_/]?(?:USDT|USD)\b/);
  if (pairMatch && pairMatch[1]) {
    return pairMatch[1];
  }

  // 3. 常见中文别名
  if (text.includes('大饼') || text.includes('比特币')) return 'BTC';
  if (text.includes('以太') || text.includes('二饼')) return 'ETH';
  if (text.includes('索拉纳') || text.includes('阳光链')) return 'SOL';
  if (text.includes('狗狗币') || text.includes('狗币')) return 'DOGE';
  if (text.includes('佩佩')) return 'PEPE';

  return null;
}

/**
 * 格式化为 OKX 永续合约 ID 与币种代码
 */
export function normalizeSymbol(input) {
  const cleaned = String(input || '').toUpperCase().replace(/[-_/]?(?:USDT|USD)?(?:[-_]?SWAP)?$/, '').trim();
  const ccy = cleaned || 'BTC';
  return {
    ccy,
    instId: `${ccy}-USDT-SWAP`,
  };
}

/**
 * 估算多空清算压力区。
 * 这不是交易所清算热力图：OKX 公共接口不提供全网仓位的开仓价和杠杆分布。
 */
export function estimateLiquidationMagnet(snapshot) {
  const {
    price = 0,
    high24h = 0,
    low24h = 0,
    oiUsd = 0,
    longShortRatio,
    fundingRate = 0,
    nextFundingRate,
    dataQuality = {},
  } = snapshot || {};

  if (
    !Number.isFinite(price) || price <= 0 ||
    !Number.isFinite(oiUsd) || oiUsd <= 0 ||
    !Number.isFinite(longShortRatio) || longShortRatio <= 0 ||
    dataQuality.openInterest !== true ||
    dataQuality.longShortRatio !== true
  ) {
    return null;
  }

  // 多空账户比只能作为仓位倾斜的代理变量，不能当作真实多空持仓比例。
  const lsRatio = longShortRatio;
  const longShare = lsRatio / (1 + lsRatio);
  const shortShare = 1 - longShare;
  const totalOi = oiUsd;
  const longOi = totalOi * longShare;
  const shortOi = totalOi * shortShare;

  // 仅作为情景距离，不代表任何用户的真实爆仓价。
  const calcTiers = (direction) => {
    const isLong = direction === 'LONG';
    const pool = isLong ? longOi : shortOi;
    const tier50xPrice = isLong ? price * (1 - 0.016) : price * (1 + 0.016);
    const tier20xPrice = isLong ? price * (1 - 0.043) : price * (1 + 0.043);
    const tier10xPrice = isLong ? price * (1 - 0.088) : price * (1 + 0.088);

    return {
      tier50x: {
        leverage: 50,
        price: tier50xPrice,
        distancePercent: isLong ? -1.6 : 1.6,
        estVolumeUsd: Math.round(pool * 0.25),
      },
      tier20x: {
        leverage: 20,
        price: tier20xPrice,
        distancePercent: isLong ? -4.3 : 4.3,
        estVolumeUsd: Math.round(pool * 0.45),
      },
      tier10x: {
        leverage: 10,
        price: tier10xPrice,
        distancePercent: isLong ? -8.8 : 8.8,
        estVolumeUsd: Math.round(pool * 0.30),
      },
      denseMin: isLong ? tier20xPrice : tier50xPrice,
      denseMax: isLong ? tier50xPrice : tier20xPrice,
      totalAtRiskUsd: Math.round(pool),
    };
  };

  const longClusters = calcTiers('LONG');
  const shortClusters = calcTiers('SHORT');

  // 3. 磁铁引力方向与强度
  let magnetBias = 'BALANCED';
  let biasTitle = '⚖️ 多空账户偏向有限 · 双向风险区间';
  let intensityScore = 50;
  let targetPrice = price;
  let targetDescription = '当前账户比没有显示明显单边拥挤，暂不支持单方向清算压力判断。';

  const safeFundingRate = Number.isFinite(fundingRate) ? fundingRate : 0;
  const frPercent = safeFundingRate * 100;

  if (lsRatio >= 1.35 || (lsRatio >= 1.2 && frPercent >= 0.02)) {
    magnetBias = 'DOWN_SWEEP';
    intensityScore = Math.min(95, Math.round(55 + (lsRatio - 1.2) * 25 + Math.max(0, frPercent * 500)));
    biasTitle = '↓ 下方多头清算压力估算 · 需等待价格与 OI 验证';
    targetPrice = (low24h > 0 && low24h < price && low24h > longClusters.tier20x.price)
      ? low24h * 0.995
      : longClusters.tier20x.price;
    targetDescription = `多头账户占比估算 ${(longShare * 100).toFixed(1)}% (账户比 ${lsRatio.toFixed(2)})。这是下方风险区间的统计估算，不代表真实爆仓池，需结合深度、成交和爆仓流确认。`;
  } else if (lsRatio <= 0.8 || (lsRatio <= 0.88 && frPercent <= -0.01)) {
    magnetBias = 'UP_SWEEP';
    intensityScore = Math.min(95, Math.round(55 + (0.9 - lsRatio) * 35 + Math.max(0, -frPercent * 500)));
    biasTitle = '↑ 上方空头清算压力估算 · 需等待价格与 OI 验证';
    targetPrice = (high24h > 0 && high24h > price && high24h < shortClusters.tier20x.price)
      ? high24h * 1.005
      : shortClusters.tier20x.price;
    targetDescription = `空头账户占比估算 ${(shortShare * 100).toFixed(1)}% (账户比 ${lsRatio.toFixed(2)})。这是上方风险区间的统计估算，不代表真实爆仓池，需结合深度、成交和爆仓流确认。`;
  } else {
    targetPrice = price;
    targetDescription = `多空账户比 ${lsRatio.toFixed(2)} 处于相对平衡区间。下方和上方价格分别是杠杆情景距离估算，不代表真实防守位。`;
  }

  // 4. 下期资金费率预期趋势
  let fundingRateShift = null;
  if (typeof nextFundingRate === 'number' && Number.isFinite(nextFundingRate)) {
    const nextFrPercent = nextFundingRate * 100;
    const diff = nextFrPercent - frPercent;
    let trend = 'STABLE';
    let warning = '下期资金费率预期平稳';
    if (diff > 0.005) {
      trend = 'INCREASING';
      warning = `下期费率预计上升至 ${nextFrPercent.toFixed(4)}%，多头持仓成本进一步攀升`;
    } else if (diff < -0.005) {
      trend = 'DECREASING';
      warning = `下期费率预计下降至 ${nextFrPercent.toFixed(4)}%，空头拥挤度可能上升`;
    }
    fundingRateShift = {
      current: safeFundingRate,
      next: nextFundingRate,
      diff,
      trend,
      warning,
    };
  }

  // 5. 散户情绪与反向指标
  let crowdState = 'BALANCED';
  let contrarianSignal = '多空情绪均衡，无明显群体非理性偏差。';
  if (lsRatio >= 1.5) {
    crowdState = 'HEAVILY_LONG';
    contrarianSignal = `⚠️ 散户极度贪婪看多 (${(longShare * 100).toFixed(0)}% 散户持多)。经典反向指标：当散户全在做多时，往往预示洗盘下杀在即！`;
  } else if (lsRatio >= 1.2) {
    crowdState = 'MODERATELY_LONG';
    contrarianSignal = `散户偏向做多 (${(longShare * 100).toFixed(0)}% 散户持多)，警惕高位获利回吐。`;
  } else if (lsRatio <= 0.75) {
    crowdState = 'HEAVILY_SHORT';
    contrarianSignal = `⚠️ 散户极度恐慌看空 (${(shortShare * 100).toFixed(0)}% 散户持空)。经典反向指标：群体性看空是逼空燃料，警惕暴力反抽！`;
  } else if (lsRatio <= 0.88) {
    crowdState = 'MODERATELY_SHORT';
    contrarianSignal = `散户偏向做空 (${(shortShare * 100).toFixed(0)}% 散户持空)，下方具备一定支撑韧性。`;
  }

  return {
    magnetBias,
    biasTitle,
    intensityScore,
    targetPrice,
    targetDescription,
    longClusters,
    shortClusters,
    fundingRateShift,
    methodology: 'HEURISTIC_ACCOUNT_RATIO',
    crowdSentiment: {
      longShortRatio: lsRatio,
      longSharePercent: Math.round(longShare * 100),
      shortSharePercent: Math.round(shortShare * 100),
      crowdState,
      contrarianSignal,
    },
  };
}

/**
 * 多维共振量价背离、位置权重、资金费率与庄家陷阱排查算法
 */
export function analyzeCryptoTrap(snapshot) {
  const {
    price = 0,
    high24h = 0,
    low24h = 0,
    candles15m = [],
    fundingRate = 0,
    longShortRatio = 1,
    priceDelta1hPercent = 0,
    oiDelta1hPercent = 0,
    microstructure,
  } = snapshot || {};

  const range24h = high24h - low24h;
  const locationPercent = range24h > 0 ? Math.max(0, Math.min(100, ((price - low24h) / range24h) * 100)) : 50;

  // 1. 位置效应判定 (Key Location)
  const isAtHighResistance = locationPercent >= 82 || (high24h > 0 && price >= high24h * 0.985);
  const isAtLowSupport = locationPercent <= 18 || (low24h > 0 && price <= low24h * 1.015);
  const isMidRange = locationPercent >= 35 && locationPercent <= 65;

  let locationDesc = `箱体中轴平衡区 (${locationPercent.toFixed(1)}% 分位数)`;
  if (isAtHighResistance) locationDesc = `24H 顶部阻力/流动性池区 (${locationPercent.toFixed(1)}% 高位)`;
  else if (isAtLowSupport) locationDesc = `24H 底部支撑/流动性池区 (${locationPercent.toFixed(1)}% 低位)`;

  // 2. K线微观插针拒跌/拒涨形态
  // 未收盘 K 线只作为实时参考，不参与已确认的影线形态判断。
  const latest15m = candles15m.find((candle) => candle && candle.isClosed !== false);
  let upperWickPercent = 0;
  let lowerWickPercent = 0;
  if (latest15m && latest15m.high > latest15m.low) {
    const totalSpan = latest15m.high - latest15m.low;
    const upperWick = latest15m.high - Math.max(latest15m.open, latest15m.close);
    const lowerWick = Math.min(latest15m.open, latest15m.close) - latest15m.low;
    upperWickPercent = (upperWick / totalSpan) * 100;
    lowerWickPercent = (lowerWick / totalSpan) * 100;
  }
  const hasUpperWickRejection = upperWickPercent >= 32;
  const hasLowerWickAbsorption = lowerWickPercent >= 32;

  // 3. 资金费率过热度
  const frPercent = fundingRate * 100;
  let fundingRateAssessment = '中性正常';
  if (frPercent >= 0.03) {
    fundingRateAssessment = `极度偏多过热 (${frPercent.toFixed(4)}%)，多头每8小时需向空头支付高额费率，多头持仓成本极重`;
  } else if (frPercent >= 0.01) {
    fundingRateAssessment = `温和偏多 (${frPercent.toFixed(4)}%)`;
  } else if (frPercent <= -0.02) {
    fundingRateAssessment = `极度偏空/负费率 (${frPercent.toFixed(4)}%)，空头严重拥挤，极易触发逼空行情`;
  } else if (frPercent < 0) {
    fundingRateAssessment = `轻微偏空 (${frPercent.toFixed(4)}%)`;
  }

  const liquidationMagnet = estimateLiquidationMagnet(snapshot);
  if (liquidationMagnet && microstructure) {
    const flowTotal = microstructure.aggressiveBuyUsd + microstructure.aggressiveSellUsd;
    const flowBias = flowTotal > 0
      ? (microstructure.aggressiveBuyUsd - microstructure.aggressiveSellUsd) / flowTotal
      : 0;
    const directionalFlow = liquidationMagnet.magnetBias === 'UP_SWEEP' ? flowBias : -flowBias;
    const directionalDepth = liquidationMagnet.magnetBias === 'UP_SWEEP'
      ? microstructure.depthImbalance
      : -microstructure.depthImbalance;
    const liquidationTotal = microstructure.liquidationLongUsd + microstructure.liquidationShortUsd;
    const liquidationBias = liquidationTotal > 0
      ? (microstructure.liquidationShortUsd - microstructure.liquidationLongUsd) / liquidationTotal
      : 0;
    const directionalLiquidation = liquidationMagnet.magnetBias === 'UP_SWEEP'
      ? liquidationBias
      : -liquidationBias;
    const hasLiquidationSignal = microstructure.dataQuality?.liquidations === true && liquidationTotal > 0;
    const pressureSignal = hasLiquidationSignal
      ? directionalFlow * 0.35 + directionalDepth * 0.30 + directionalLiquidation * 0.35
      : (directionalFlow + directionalDepth) / 2;
    const pressureScore = Math.max(0, Math.min(100, Math.round(50 + pressureSignal * 50)));
    const confirmation = pressureSignal >= 0.15
      ? 'SUPPORTIVE'
      : pressureSignal <= -0.15
        ? 'UNCONFIRMED'
        : 'MIXED';
    const liquidationDirection = !hasLiquidationSignal
      ? 'UNAVAILABLE'
      : liquidationBias >= 0.15
        ? 'UP'
        : liquidationBias <= -0.15
          ? 'DOWN'
          : 'MIXED';
    const summary = confirmation === 'SUPPORTIVE'
      ? hasLiquidationSignal
        ? '盘口、主动成交与爆仓方向共同支持当前清算压力估算。'
        : '盘口与主动成交方向支持当前清算压力估算，暂无有效爆仓流确认。'
      : confirmation === 'UNCONFIRMED'
        ? '盘口、主动成交或爆仓方向没有支持当前清算压力估算。'
        : '盘口、主动成交与爆仓信号分歧，当前清算压力估算需要等待确认。';
    liquidationMagnet.microstructure = {
      pressureScore,
      confirmation,
      liquidationBias: liquidationDirection,
      liquidationLongUsd: microstructure.liquidationLongUsd,
      liquidationShortUsd: microstructure.liquidationShortUsd,
      liquidationCount: microstructure.liquidationCount,
      summary,
    };
  }

  // 4. 五大场景判定与多维共振打分 (Confidence Score)
  const checklist = [];

  // 场景 1: 顶背离诱多 (Bull Trap Divergence)
  if (priceDelta1hPercent >= 0.8 && oiDelta1hPercent <= -1.5) {
    let score = 75;
    checklist.push(`[√] 资金异动：1H 币价上涨 +${priceDelta1hPercent.toFixed(2)}% 但 OI 骤降 ${oiDelta1hPercent.toFixed(2)}% (显著顶背离)`);

    if (isAtHighResistance) {
      score += 15;
      checklist.push(`[√] 位置共振：发生在 24H 阻力位前高密集区 (${locationPercent.toFixed(1)}%)，诱多可信度激增`);
    } else if (isMidRange) {
      score -= 10;
      checklist.push(`[!] 位置提示：发生在箱体中间位置，部分空头平仓可能仅为正常换手`);
    }

    if (frPercent >= 0.02) {
      score += 10;
      checklist.push(`[√] 费率共振：资金费率处于过热高位 (${frPercent.toFixed(4)}%)，多头追多过于拥挤`);
    }

    if (hasUpperWickRejection) {
      score += 5;
      checklist.push(`[√] 形态共振：最新 15m 出现 ${upperWickPercent.toFixed(0)}% 上影线插针拒涨信号`);
    }

    if (liquidationMagnet?.magnetBias === 'DOWN_SWEEP' && liquidationMagnet.microstructure?.confirmation === 'SUPPORTIVE') {
      score += 5;
      checklist.push('[√] 压力共振：账户拥挤度与盘口/主动成交共同支持下方风险方向');
    }

    const confidenceScore = Math.min(98, score);
    return {
      trapType: 'BULL_TRAP_DIVERGENCE',
      trapTitle: isAtHighResistance
        ? '🚨 前高流动性掠夺 · 顶背离诱多陷阱高危预警 (Liquidity Sweep & Bull Trap)'
        : '🚨 顶背离诱多陷阱高危预警 (Bull Trap)',
      divergenceDescription: `过去 1H 币价上涨 +${priceDelta1hPercent.toFixed(2)}%，但持仓量 OI 骤降 ${oiDelta1hPercent.toFixed(2)}%！这说明本次拉升主要由空头平仓止损被动买盘推动，场外没有主力真金白银主动开多建仓。属于典型的冲高流动性陷阱。`,
      fundingRateAssessment,
      confidenceScore,
      locationDesc,
      checklist,
      sentimentRisk: frPercent >= 0.02 || isAtHighResistance ? 'CRITICAL' : 'HIGH',
      suggestedAction: isAtHighResistance
        ? '坚决禁止在前高阻力区市价追多！极可能是主力扫掉前高止损流动性后的诱多杀多局。密切盯防 15m 假突破收回跌破形态，可尝试轻仓高盈亏比右侧试空。'
        : '严禁在当前位置市价追多！谨防假突破收回后的大幅回撤，耐心等待 15m 级别的受阻翻阴右侧反转信号。',
      liquidationMagnet,
    };
  }

  // 场景 2: 去杠杆踩踏杀跌 (Deleveraging Cascade)
  if (priceDelta1hPercent <= -0.8 && oiDelta1hPercent <= -2.0) {
    let score = 80;
    checklist.push(`[√] 资金异动：1H 币价下跌 ${priceDelta1hPercent.toFixed(2)}% 且 OI 暴跌 ${oiDelta1hPercent.toFixed(2)}% (多头清算潮)`);
    if (isAtLowSupport) {
      checklist.push(`[!] 位置提示：跌入 24H 低位支撑区，但清算未止前切忌猜底`);
    }
    const confidenceScore = Math.min(95, score);
    return {
      trapType: 'DELEVERAGING_CASCADE',
      trapTitle: '🩸 多头爆仓踩踏去杠杆进行中 (Deleveraging Cascade)',
      divergenceDescription: `过去 1H 币价下跌 ${priceDelta1hPercent.toFixed(2)}%，伴随 OI 剧烈萎缩 ${oiDelta1hPercent.toFixed(2)}%！表明多头资金正在大批止损或遭遇强平清算，杠杆筹码在快速出清。`,
      fundingRateAssessment,
      confidenceScore,
      locationDesc,
      checklist,
      sentimentRisk: 'HIGH',
      suggestedAction: '飞刀切勿用手接！在清算潮彻底平息、OI 止跌企稳并出现放量长下影线拒跌之前，严禁左侧盲目猜底开多。',
      liquidationMagnet,
    };
  }

  // 场景 3: 增量资金对决 / 诱空 (Bear Trap Divergence)
  if (priceDelta1hPercent <= -0.8 && oiDelta1hPercent >= 2.0) {
    let score = 75;
    checklist.push(`[√] 资金异动：1H 币价下跌 ${priceDelta1hPercent.toFixed(2)}% 但 OI 逆势飙升 +${oiDelta1hPercent.toFixed(2)}% (巨量增仓对决)`);

    if (isAtLowSupport) {
      score += 15;
      checklist.push(`[√] 位置共振：发生在 24H 关键支撑区 (${locationPercent.toFixed(1)}%)，主力托单吸筹概率大`);
    }
    if (hasLowerWickAbsorption) {
      score += 10;
      checklist.push(`[√] 形态共振：最新 15m 出现 ${lowerWickPercent.toFixed(0)}% 长下影线探底拒跌信号`);
    }
    if (frPercent < 0) {
      score += 5;
      checklist.push(`[√] 费率共振：资金费率转负，空头极度拥挤，易诱发反抽轧空`);
    }
    if (liquidationMagnet?.magnetBias === 'UP_SWEEP' && liquidationMagnet.microstructure?.confirmation === 'SUPPORTIVE') {
      score += 5;
      checklist.push('[√] 压力共振：账户拥挤度与盘口/主动成交共同支持上方风险方向');
    }

    const confidenceScore = Math.min(95, score);
    return {
      trapType: 'BEAR_TRAP_DIVERGENCE',
      trapTitle: isAtLowSupport
        ? '⚡ 关键支撑区大资金托单吸筹 · 潜在诱空反转 (Support Absorption & Bear Trap)'
        : '⚡ 增量资金对决异动 / 潜在诱空或空头强袭',
      divergenceDescription: `过去 1H 币价下跌 ${priceDelta1hPercent.toFixed(2)}%，但持仓量 OI 逆势飙升 +${oiDelta1hPercent.toFixed(2)}%！说明有多空双方大资金在当前激烈交火建仓（增量做空 vs 主力挂单吸筹）。`,
      fundingRateAssessment,
      confidenceScore,
      locationDesc,
      checklist,
      sentimentRisk: 'MEDIUM',
      suggestedAction: isAtLowSupport
        ? '重点观察 1H/15m 支撑位是否出现长下影放量收回。若是，判定为主力假跌破扫止损吸筹（诱空陷阱），可配合严格止损轻仓博取右侧超跌反弹！'
        : '多空大资金激烈交火中，静待方向明确，切勿在多空争夺的肉搏区抢跑。',
      liquidationMagnet,
    };
  }

  // 场景 4: 量价齐升真实突破 (Genuine Breakout)
  if (priceDelta1hPercent >= 1.0 && oiDelta1hPercent >= 2.0) {
    let score = 80;
    checklist.push(`[√] 资金异动：1H 币价上涨 +${priceDelta1hPercent.toFixed(2)}% 且 OI 同步放量 +${oiDelta1hPercent.toFixed(2)}% (主力真金白银建仓)`);
    if (isAtHighResistance) {
      score += 10;
      checklist.push(`[√] 位置共振：放量增仓突破前高，属于健康单边趋势延续`);
    }
    const confidenceScore = Math.min(95, score);
    return {
      trapType: 'GENUINE_BREAKOUT',
      trapTitle: '🚀 量价协同 · 真实主力增量突破 (Genuine Breakout)',
      divergenceDescription: `过去 1H 币价上涨 +${priceDelta1hPercent.toFixed(2)}%，同时 OI 激增 +${oiDelta1hPercent.toFixed(2)}%！这表明大笔增量资金正在主动追高开多建立进攻仓位，属健康的量价齐升结构。`,
      fundingRateAssessment,
      confidenceScore,
      locationDesc,
      checklist,
      sentimentRisk: frPercent >= 0.03 ? 'MEDIUM' : 'LOW',
      suggestedAction: '顺势而为，不宜盲目左侧逆势摸顶做空；回踩 15m 突破点支撑位若企稳，是高盈亏比的右侧顺势上车点。',
      liquidationMagnet,
    };
  }

  // 场景 5: 常规中性震荡
  checklist.push(`[-] 资金异动：1H 价格波动与 OI 变化幅度平稳，无显著背离`);
  checklist.push(`[-] 位置状态：当前处于 ${locationDesc}`);
  if (liquidationMagnet?.crowdSentiment) {
    checklist.push(`[-] 筹码分布：多空账户比 ${liquidationMagnet.crowdSentiment.longShortRatio} (${liquidationMagnet.crowdSentiment.crowdState})`);
  }
  return {
    trapType: 'HEALTHY_CONSOLIDATION',
    trapTitle: '⚖️ 箱体中性筹码换手 (Consolidation)',
    divergenceDescription: `1H 价格波动与 OI 变动处于常态平衡区间（价格 ${priceDelta1hPercent >= 0 ? '+' : ''}${priceDelta1hPercent.toFixed(2)}%，OI ${oiDelta1hPercent >= 0 ? '+' : ''}${oiDelta1hPercent.toFixed(2)}%），未出现显著的量价背离信号。`,
    fundingRateAssessment,
    confidenceScore: 65,
    locationDesc,
    checklist,
    sentimentRisk: 'LOW',
    suggestedAction: '箱体震荡思路操作，高抛低吸，贴近边界限价挂单；若无突破信号，严防在箱体正中央频繁交易被磨损本金。',
    liquidationMagnet,
  };
}

/**
 * 格式化为注入 Agent System / Prompt 上下文的实盘行情摘要
 */
export function formatCryptoContextForPrompt(snapshot) {
  const trap = analyzeCryptoTrap(snapshot);
  const frPct = ((snapshot.fundingRate || 0) * 100).toFixed(4);
  const oiMillion = ((snapshot.oiUsd || 0) / 1_000_000).toFixed(2);
  const volMillion = ((snapshot.vol24hQuote || 0) / 1_000_000).toFixed(2);

  const formatCandleList = (candles) => {
    if (!Array.isArray(candles) || candles.length === 0) return '暂无数据';
    return candles.slice(0, 3).map((c) => `[${c.time}: 开${c.open}/高${c.high}/低${c.low}/收${c.close}${c.isClosed === false ? '/未收盘' : ''}]`).join(' ');
  };

  const formatFetchedAt = (value) => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '未知';
  const quality = snapshot.dataQuality || {};
  const available = (key) => quality[key] === true ? '可用' : '缺失';

  const checklistStr = Array.isArray(trap.checklist) && trap.checklist.length > 0
    ? trap.checklist.map((item) => `  • ${item}`).join('\n')
    : '  • 暂无详细指标';

  const magnet = trap.liquidationMagnet;
  const magnetStr = magnet ? `
【期货清算压力估算 (启发式模型，不是真实清算热力图)】:
- 引力偏向: ${magnet.biasTitle} (引力指数: ${magnet.intensityScore}/100)
- 估算优先观察价位: $${(magnet.targetPrice || snapshot.price).toLocaleString()} USDT
- 估算逻辑: ${magnet.targetDescription}
- 杠杆情景距离 (不是实际爆仓价):
  • 下方多头: 50x 约 $${Math.round(magnet.longClusters.tier50x.price).toLocaleString()} | 20x 约 $${Math.round(magnet.longClusters.tier20x.price).toLocaleString()} (账户比加权 OI 仅作代理)
  • 上方空头: 50x 约 $${Math.round(magnet.shortClusters.tier50x.price).toLocaleString()} | 20x 约 $${Math.round(magnet.shortClusters.tier20x.price).toLocaleString()} (账户比加权 OI 仅作代理)
- 多空散户情绪与反向指标:
  • 全网账户比: ${magnet.crowdSentiment.longShortRatio} (多头 ${magnet.crowdSentiment.longSharePercent}% vs 空头 ${magnet.crowdSentiment.shortSharePercent}%)
  • 反向指标告警: ${magnet.crowdSentiment.contrarianSignal}
${magnet.microstructure ? `- 微观结构确认: ${magnet.microstructure.confirmation} (${magnet.microstructure.pressureScore}/100) - ${magnet.microstructure.summary}` : '- 微观结构确认: 暂无盘口与主动成交数据'}
${magnet.microstructure?.liquidationBias !== 'UNAVAILABLE' ? `- 爆仓流确认: ${magnet.microstructure?.liquidationBias} | 多头爆仓约 $${((magnet.microstructure?.liquidationLongUsd || 0) / 1e6).toFixed(2)}M | 空头爆仓约 $${((magnet.microstructure?.liquidationShortUsd || 0) / 1e6).toFixed(2)}M | ${magnet.microstructure?.liquidationCount || 0} 笔` : '- 爆仓流确认: 暂无有效爆仓数据'}
${magnet.fundingRateShift ? `- 资金费率预期趋势: ${magnet.fundingRateShift.warning}` : ''}`.trim() : '';

  return `
---
【OKX 衍生品实盘盘面与量价雷达 (实盘真实数据)】
- 标的合约: ${snapshot.instId} (永续合约)
- 实时现价: $${(snapshot.price || 0).toLocaleString()} USDT
- 数据时间: 实时层 ${formatFetchedAt(snapshot.realtimeFetchedAt)} | 衍生层 ${formatFetchedAt(snapshot.derivativesFetchedAt)} | 结构层 ${formatFetchedAt(snapshot.structureFetchedAt)}
 - 数据完整性: ticker ${available('ticker')} | OI ${available('openInterest')} | 资金费率 ${available('fundingRate')} | 1H OI变化 ${available('oiDelta1h')} | 多空比 ${available('longShortRatio')} | 深度 ${available('orderBook')} | 成交 ${available('trades')} | 爆仓流 ${available('liquidations')} | K线 15m/1H/4H ${available('candles15m')}/${available('candles1h')}/${available('candles4h')}
- 24H 行情: 开 $${(snapshot.open24h || 0).toLocaleString()} | 最高 $${(snapshot.high24h || 0).toLocaleString()} | 最低 $${(snapshot.low24h || 0).toLocaleString()} | 24H 成交额字段: $${volMillion}M
- 价格位置: ${trap.locationDesc}
 - 周期涨跌: 15m ${snapshot.priceDelta15mPercent >= 0 ? '+' : ''}${(snapshot.priceDelta15mPercent || 0).toFixed(2)}% | 1H ${snapshot.priceDelta1hPercent >= 0 ? '+' : ''}${(snapshot.priceDelta1hPercent || 0).toFixed(2)}% | 4H ${snapshot.priceDelta4hPercent >= 0 ? '+' : ''}${(snapshot.priceDelta4hPercent || 0).toFixed(2)}%
- 持仓量 (OI): $${oiMillion}M USD (1H 变动: ${snapshot.oiDelta1hPercent >= 0 ? '+' : ''}${(snapshot.oiDelta1hPercent || 0).toFixed(2)}%)
- 资金费率: ${frPct}% (${trap.fundingRateAssessment})
${snapshot.longShortRatio ? `- 多空账户比: ${snapshot.longShortRatio} (全网账户)` : ''}
- K线走势摘要:
  • 15m 最近走势: ${formatCandleList(snapshot.candles15m)}
  • 1H 结构关键位: ${formatCandleList(snapshot.candles1h)}
  • 4H 宏观背景位: ${formatCandleList(snapshot.candles4h)}

【量价微观诊断与庄家陷阱排查】:
- 状态判定: ${trap.trapTitle}
- 置信度打分: ${trap.confidenceScore}% (${trap.sentimentRisk} 风险等级)
- 多维共振检验:
${checklistStr}
- 背离深度解析: ${trap.divergenceDescription}
- 操作指导纪律: ${trap.suggestedAction}
${magnetStr ? '\n' + magnetStr + '\n' : ''}---
`.trim();
}
