import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

/* ------------------------------- 图标 ------------------------------- */
type IconProps = { size?: number; className?: string; strokeWidth?: number };
const S = (p: IconProps) => ({
  width: p.size ?? 20, height: p.size ?? 20, viewBox: '0 0 24 24', fill: 'none',
  stroke: 'currentColor', strokeWidth: p.strokeWidth ?? 1.7,
  strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, className: p.className, 'aria-hidden': true,
});

export const Icon = {
  Home: (p: IconProps) => <svg {...S(p)}><path d="M3 10.5 12 3l9 7.5" /><path d="M5.5 9.5V20h13V9.5" /><path d="M10 20v-5.5h4V20" /></svg>,
  Book: (p: IconProps) => <svg {...S(p)}><path d="M4 4.5A2 2 0 0 1 6 3h6v17H6a2 2 0 0 1-2-1.5z" /><path d="M20 4.5A2 2 0 0 0 18 3h-6v17h6a2 2 0 0 0 2-1.5z" /></svg>,
  Headphones: (p: IconProps) => <svg {...S(p)}><path d="M4 15v-3a8 8 0 0 1 16 0v3" /><path d="M4 15h2.5a1.5 1.5 0 0 1 1.5 1.5v2A1.5 1.5 0 0 1 6.5 20H6a2 2 0 0 1-2-2z" /><path d="M20 15h-2.5a1.5 1.5 0 0 0-1.5 1.5v2a1.5 1.5 0 0 0 1.5 1.5H18a2 2 0 0 0 2-2z" /></svg>,
  Users: (p: IconProps) => <svg {...S(p)}><circle cx="9" cy="8" r="3.2" /><path d="M3.5 19.5c0-3 2.5-5 5.5-5s5.5 2 5.5 5" /><path d="M16 5.6a3 3 0 0 1 0 5.8" /><path d="M20.5 19.5c0-2.3-1.4-4-3.5-4.6" /></svg>,
  Settings: (p: IconProps) => <svg {...S(p)}><circle cx="12" cy="12" r="3" /><path d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6" /></svg>,
  Play: (p: IconProps) => <svg {...S(p)} fill="currentColor" stroke="none"><path d="M8 5.6v12.8L19 12z" /></svg>,
  Pause: (p: IconProps) => <svg {...S(p)} fill="currentColor" stroke="none"><rect x="7" y="5.5" width="3.6" height="13" rx="1" /><rect x="13.4" y="5.5" width="3.6" height="13" rx="1" /></svg>,
  SkipBack: (p: IconProps) => <svg {...S(p)}><path d="M6 5v14" /><path d="M19 5.6v12.8L9.5 12z" /></svg>,
  SkipFwd: (p: IconProps) => <svg {...S(p)}><path d="M18 5v14" /><path d="M5 5.6v12.8L14.5 12z" /></svg>,
  Mic: (p: IconProps) => <svg {...S(p)}><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0" /><path d="M12 18v3" /></svg>,
  Volume: (p: IconProps) => <svg {...S(p)}><path d="M4 9.5h3L11.5 6v12L7 14.5H4z" /><path d="M15.5 9a4 4 0 0 1 0 6" /><path d="M18 6.5a7.5 7.5 0 0 1 0 11" /></svg>,
  Check: (p: IconProps) => <svg {...S(p)}><path d="m5 13 4.5 4.5L19 7" /></svg>,
  X: (p: IconProps) => <svg {...S(p)}><path d="M6 6l12 12M18 6 6 18" /></svg>,
  Chevron: (p: IconProps) => <svg {...S(p)}><path d="m9 6 6 6-6 6" /></svg>,
  Lock: (p: IconProps) => <svg {...S(p)}><rect x="5" y="10.5" width="14" height="9.5" rx="2" /><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" /></svg>,
  Unlock: (p: IconProps) => <svg {...S(p)}><rect x="5" y="10.5" width="14" height="9.5" rx="2" /><path d="M8.5 10.5V8a3.5 3.5 0 0 1 6.6-1.7" /></svg>,
  List: (p: IconProps) => <svg {...S(p)}><path d="M8 6.5h12M8 12h12M8 17.5h12" /><circle cx="4.2" cy="6.5" r="1.1" fill="currentColor" stroke="none" /><circle cx="4.2" cy="12" r="1.1" fill="currentColor" stroke="none" /><circle cx="4.2" cy="17.5" r="1.1" fill="currentColor" stroke="none" /></svg>,
  Text: (p: IconProps) => <svg {...S(p)}><path d="M5 6h14M5 12h14M5 18h9" /></svg>,
  Refresh: (p: IconProps) => <svg {...S(p)}><path d="M20 12a8 8 0 1 1-2.3-5.6" /><path d="M20 4v4.5h-4.5" /></svg>,
  Clock: (p: IconProps) => <svg {...S(p)}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></svg>,
  Trophy: (p: IconProps) => <svg {...S(p)}><path d="M8 4h8v4a4 4 0 0 1-8 0z" /><path d="M8 5.5H5.5V8A3.5 3.5 0 0 0 8 11.4" /><path d="M16 5.5h2.5V8a3.5 3.5 0 0 1-2.5 3.4" /><path d="M12 12v4" /><path d="M8.5 20h7l-.7-3.2h-5.6z" /></svg>,
  Spark: (p: IconProps) => <svg {...S(p)}><path d="M12 3.5 13.7 9l5.5 1.7-5.5 1.7L12 18l-1.7-5.6L4.8 10.7 10.3 9z" /></svg>,
  Info: (p: IconProps) => <svg {...S(p)}><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5" /><circle cx="12" cy="8" r="0.9" fill="currentColor" stroke="none" /></svg>,
  Warn: (p: IconProps) => <svg {...S(p)}><path d="M12 4.5 21 19.5H3z" /><path d="M12 10v4" /><circle cx="12" cy="16.8" r="0.9" fill="currentColor" stroke="none" /></svg>,
  Wifi: (p: IconProps) => <svg {...S(p)}><path d="M5 12.5a10 10 0 0 1 14 0" /><path d="M8 15.5a6 6 0 0 1 8 0" /><circle cx="12" cy="18.5" r="1.1" fill="currentColor" stroke="none" /></svg>,
  Download: (p: IconProps) => <svg {...S(p)}><path d="M12 4v11" /><path d="m7.5 10.5 4.5 4.5 4.5-4.5" /><path d="M5 19.5h14" /></svg>,
};

/* ------------------------------ Toast ------------------------------ */
type Toast = { id: number; text: string; kind?: 'ok' | 'err' | 'info' };
const ToastCtx = createContext<{ push: (t: string, kind?: Toast['kind']) => void }>({ push: () => {} });

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((text: string, kind: Toast['kind'] = 'info') => {
    const id = Date.now() + Math.random();
    setItems((prev) => [...prev, { id, text, kind }]);
    setTimeout(() => setItems((prev) => prev.filter((x) => x.id !== id)), 3600);
  }, []);
  const value = useMemo(() => ({ push }), [push]);
  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div aria-live="polite" aria-atomic="true">
        {items.map((t) => (
          <div key={t.id} className={`toast${t.kind === 'err' ? ' err' : ''}`}>{t.text}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

/* ------------------------------ 基础组件 ------------------------------ */
export function Card({ children, className = '', as: As = 'section', ...rest }: any) {
  return <As className={`card ${className}`} {...rest}>{children}</As>;
}

export function Tag({ children, kind, title }: { children: React.ReactNode; kind?: 'ok' | 'warn' | 'danger' | 'accent' | 'solid'; title?: string }) {
  return <span className={`tag${kind ? ' ' + kind : ''}`} title={title}>{children}</span>;
}

export function Bar({ value, max = 100, gold, thin }: { value: number; max?: number; gold?: boolean; thin?: boolean }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return <div className={`bar${thin ? ' thin' : ''}${gold ? ' gold' : ''}`} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${pct}%` }} /></div>;
}

export function Banner({ kind = 'info', children }: { kind?: 'ok' | 'warn' | 'danger' | 'info'; children: React.ReactNode }) {
  const I = kind === 'warn' || kind === 'danger' ? Icon.Warn : kind === 'ok' ? Icon.Check : Icon.Info;
  return <div className={`banner${kind !== 'info' ? ' ' + kind : ''}`}><I size={17} /><div>{children}</div></div>;
}

export function Empty({ title, hint, action }: { title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-ico" style={{ display: 'flex', justifyContent: 'center' }}><Icon.Book size={34} /></div>
      <div style={{ fontWeight: 600, color: 'var(--ink)' }}>{title}</div>
      {hint && <div className="small" style={{ marginTop: 4 }}>{hint}</div>}
      {action && <div style={{ marginTop: 12 }}>{action}</div>}
    </div>
  );
}

export function Skeleton({ h = 16, w = '100%' }: { h?: number; w?: string | number }) {
  return <div className="skeleton" style={{ height: h, width: w }} />;
}

/* ------------------------------ hooks ------------------------------ */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = [], opts: { immediate?: boolean } = {}) {
  const { immediate = true } = opts;
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<any>(null);
  const [loading, setLoading] = useState(immediate);
  const alive = useRef(true);
  const run = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await fn();
      if (alive.current) setData(r);
      return r;
    } catch (e) {
      if (alive.current) setError(e);
      throw e;
    } finally {
      if (alive.current) setLoading(false);
    }
  }, deps);
  useEffect(() => {
    alive.current = true;
    if (immediate) run().catch(() => {});
    return () => { alive.current = false; };
  }, [run, immediate]);
  return { data, error, loading, reload: run, setData };
}

export function useOnline() {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  return online;
}

export function fmtTime(sec: number | null | undefined) {
  if (sec === null || sec === undefined || !Number.isFinite(sec)) return '--:--';
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

export function fmtDuration(seconds: number) {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  if (h > 0) return `${h} 小时 ${m} 分`;
  return `${m} 分钟`;
}

export function fmtDate(iso: string | null, withTime = false) {
  if (!iso) return '—';
  const d = new Date(iso);
  const s = `${d.getMonth() + 1}月${d.getDate()}日`;
  return withTime ? `${s} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : s;
}

export function posZh(pos: string) {
  const m: Record<string, string> = {
    noun: '名词', verb: '动词', adjective: '形容词', adverb: '副词', phrase: '短语',
    preposition: '介词', conjunction: '连词', pronoun: '代词', interjection: '感叹词', determiner: '限定词',
  };
  return m[pos] || pos;
}

export function Avatar({ seed, name, size = 30 }: { seed?: string | null; name: string; size?: number }) {
  const hue = useMemo(() => {
    const key = String(seed || name || 'x');
    let h = 0;
    for (let i = 0; i < key.length; i += 1) h = (h * 31 + key.charCodeAt(i)) % 360;
    return h;
  }, [seed, name]);
  const ch = (name || '?').trim().slice(0, 1).toUpperCase();
  return (
    <span
      aria-hidden
      style={{
        width: size, height: size, borderRadius: '50%', flex: '0 0 auto',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        background: `hsl(${hue} 24% 88%)`, color: `hsl(${hue} 38% 26%)`,
        fontSize: size * 0.45, fontWeight: 700, border: '1px solid var(--line)',
      }}
    >{ch}</span>
  );
}
