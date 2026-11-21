import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import * as monitor from './eagle-monitor.mjs';

const require = createRequire(import.meta.url);
export function loadEagleMonitorUI() {
  const source = readFileSync(new URL('../../components/spaces/FollowUpEagleMonitor.tsx', import.meta.url), 'utf8');
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, { exports, Date, setInterval, clearInterval, require: name => name === '@/lib/space/eagle-monitor.mjs' ? monitor : require(name) });
  return exports;
}
