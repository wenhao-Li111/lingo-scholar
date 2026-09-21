#!/usr/bin/env node
/** 开发模式：同时启动后端（5173）与 Vite 热更新（5174，代理 /api 与 /media 到 5173）。 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

const server = spawn(process.execPath, [path.join(ROOT, 'apps', 'server', 'src', 'start.js')], { stdio: 'inherit' });
const web = spawn(npx, ['vite'], { cwd: path.join(ROOT, 'apps', 'web'), stdio: 'inherit', shell: process.platform === 'win32' });

console.log('\n开发模式：打开 http://127.0.0.1:5174/ （热更新）或 http://127.0.0.1:5173/ （构建产物）\n');

const stop = () => { try { server.kill(); } catch {} try { web.kill(); } catch {} process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
server.on('exit', (c) => { console.log(`后端退出（${c}）`); stop(); });
web.on('exit', (c) => { console.log(`前端退出（${c}）`); stop(); });
