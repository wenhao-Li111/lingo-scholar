#!/usr/bin/env node
/** 构建前端：生成图标 → 运行 vite build → 输出到 apps/web/dist（由后端静态托管）。 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { generateIcons } from './gen-icons.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB = path.join(ROOT, 'apps', 'web');

generateIcons();
console.log('图标已生成');

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const child = spawn(npx, ['vite', 'build'], { cwd: WEB, stdio: 'inherit', shell: process.platform === 'win32' });

child.on('close', (code) => {
  if (code !== 0) { process.exit(code ?? 1); }
  const dist = path.join(WEB, 'dist');
  const assets = existsSync(path.join(dist, 'assets')) ? readdirSync(path.join(dist, 'assets')) : [];
  let total = 0;
  for (const f of assets) total += statSync(path.join(dist, 'assets', f)).size;
  console.log(`\n构建完成 → ${path.relative(ROOT, dist)}`);
  console.log(`  资源文件 ${assets.length} 个，共 ${(total / 1024).toFixed(1)} KB`);
});
