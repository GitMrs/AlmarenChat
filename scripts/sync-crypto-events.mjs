#!/usr/bin/env node
/**
 * 命令行一键同步运维脚本 (CLI Helper)
 * 用于开发调试、服务器部署前冷启动预热或手动执行宏观大事件日历同步。
 * 底层直接复用 lib/workspace/crypto/event-sync.ts 的生产级数据管道，无任何冗余代码。
 */
import { syncMacroEvents } from '../lib/workspace/crypto/event-sync.ts';

async function main() {
  console.log('🌐 [cli-sync] 正在从 FairEconomy / ForexFactory 同步本周 USD 重点日历...');
  try {
    const res = await syncMacroEvents();
    console.log('✨ [cli-sync] 同步成功！');
    console.log(`   • 上游原始抓取: ${res.fetchedRawCount} 条`);
    console.log(`   • 过滤清洗核心: ${res.filteredCount} 条重点宏观事件`);
    console.log(`   • 采集时间: ${res.fetchedAt}`);
    console.log(`   • 清理改期/撤下: ${res.removedCount} 项未发布记录`);
    console.log(`   • 库内事件总数: ${res.total} 项 (新增 ${res.addedCount} 项, 增量更新 ${res.updatedCount} 项)`);
  } catch (err) {
    console.error('❌ [cli-sync] 同步失败:', err?.message || err);
    process.exit(1);
  }
}

void main();
