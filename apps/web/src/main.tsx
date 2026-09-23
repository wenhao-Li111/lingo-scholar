import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './app';
import { ToastProvider } from './ui';
import './styles.css';
import './study-finish.css';

// 一级错误边界：避免单页异常导致整站白屏
class Boundary extends React.Component<{ children: React.ReactNode }, { err: Error | null }> {
  constructor(p: any) { super(p); this.state = { err: null }; }
  static getDerivedStateFromError(err: Error) { return { err }; }
  componentDidCatch(err: Error, info: any) { console.error('[ui]', err, info?.componentStack); }
  render() {
    if (this.state.err) {
      return (
        <div className="app-main" style={{ maxWidth: 620, margin: '0 auto', paddingTop: 48 }}>
          <div className="card">
            <h1>页面出错了</h1>
            <p className="muted small">{String(this.state.err.message || this.state.err)}</p>
            <button className="btn primary" style={{ marginTop: 12 }} onClick={() => window.location.reload()}>重新加载</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Boundary>
      <ToastProvider>
        <App />
      </ToastProvider>
    </Boundary>
  </React.StrictMode>,
);

// Service Worker：离线壳与更新提示
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((reg) => {
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        w?.addEventListener('statechange', () => {
          if (w.state === 'installed' && navigator.serviceWorker.controller) {
            const bar = document.createElement('div');
            bar.className = 'toast';
            bar.textContent = '有新版本可用，点击这里刷新';
            bar.style.cursor = 'pointer';
            bar.onclick = () => window.location.reload();
            document.body.appendChild(bar);
          }
        });
      });
    }).catch(() => {});
  });
}
