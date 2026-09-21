/**
 * 时区感知的时间工具 + 可注入 Clock。
 * 规则：所有业务日期都用小组时区的“日历日”，严禁用固定毫秒差模拟“第三天”。
 */

const partsFormatterCache = new Map();

function partsFormatter(timeZone) {
  let f = partsFormatterCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    });
    partsFormatterCache.set(timeZone, f);
  }
  return f;
}

/** 把某一时刻换算为指定时区的日历字段 */
export function zonedParts(date, timeZone) {
  const parts = partsFormatter(timeZone).formatToParts(date);
  const map = {};
  for (const p of parts) if (p.type !== 'literal') map[p.type] = p.value;
  let hour = Number(map.hour);
  if (hour === 24) hour = 0;
  const weekdayMap = { Sun: 7, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour,
    minute: Number(map.minute),
    second: Number(map.second),
    /** ISO 星期：周一=1 ... 周日=7 */
    isoWeekday: weekdayMap[map.weekday],
  };
}

function offsetMsAt(date, timeZone) {
  const p = zonedParts(date, timeZone);
  const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUTC - Math.floor(date.getTime() / 1000) * 1000;
}

/** 把“某时区的本地日历时间”换算为绝对时刻。处理 DST 时做一次修正迭代。 */
export function zonedTimeToUtc(year, month, day, hour = 0, minute = 0, second = 0, timeZone = 'Asia/Shanghai') {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  let ts = guess - offsetMsAt(new Date(guess), timeZone);
  ts = guess - offsetMsAt(new Date(ts), timeZone);
  return new Date(ts);
}

/** 当地日历日 00:00 的绝对时刻 */
export function startOfZonedDay(date, timeZone) {
  const p = zonedParts(date, timeZone);
  return zonedTimeToUtc(p.year, p.month, p.day, 0, 0, 0, timeZone);
}

/** 按“当地日历日”加减天数，跨 DST 也返回当地 00:00 */
export function addZonedDays(date, days, timeZone) {
  const p = zonedParts(date, timeZone);
  // 用 UTC 做纯日历运算，避免 23/25 小时日带来的偏移
  const base = new Date(Date.UTC(p.year, p.month - 1, p.day, 12, 0, 0));
  base.setUTCDate(base.getUTCDate() + days);
  return zonedTimeToUtc(
    base.getUTCFullYear(),
    base.getUTCMonth() + 1,
    base.getUTCDate(),
    0, 0, 0,
    timeZone,
  );
}

export function addZonedMonths(date, months, timeZone) {
  const p = zonedParts(date, timeZone);
  const base = new Date(Date.UTC(p.year, p.month - 1 + months, p.day, 12, 0, 0));
  return zonedTimeToUtc(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate(), 0, 0, 0, timeZone);
}

/** 当地日期键 YYYY-MM-DD */
export function dayKey(date, timeZone) {
  const p = zonedParts(date, timeZone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

export function parseDayKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return { year: y, month: m, day: d };
}

/** 两个日历日之间的整天差（b - a，按当地日历日计算） */
export function calendarDayDiff(a, b, timeZone) {
  const pa = zonedParts(a, timeZone);
  const pb = zonedParts(b, timeZone);
  const ua = Date.UTC(pa.year, pa.month - 1, pa.day);
  const ub = Date.UTC(pb.year, pb.month - 1, pb.day);
  return Math.round((ub - ua) / 86400000);
}

/** ISO 周：返回 { year, week, key }，key 形如 2026-W39 */
export function isoWeek(date, timeZone) {
  const p = zonedParts(date, timeZone);
  // 以当地日期构造 UTC 正午做 ISO 计算
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day, 12, 0, 0));
  const dayNum = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const isoYear = d.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1, 12, 0, 0));
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return { year: isoYear, week, key: `${isoYear}-W${String(week).padStart(2, '0')}` };
}

export function weekKeyOf(date, timeZone) {
  return isoWeek(date, timeZone).key;
}

/** 该时刻所在 ISO 周的周一当地 00:00 */
export function startOfIsoWeek(date, timeZone) {
  const p = zonedParts(date, timeZone);
  return addZonedDays(zonedTimeToUtc(p.year, p.month, p.day, 0, 0, 0, timeZone), -(p.isoWeekday - 1), timeZone);
}

/** 从 weekKey 还原该 ISO 周的周一绝对时刻 */
export function weekKeyToMonday(weekKey, timeZone) {
  const [yStr, wStr] = weekKey.split('-W');
  const isoYear = Number(yStr);
  const week = Number(wStr);
  const jan4 = zonedTimeToUtc(isoYear, 1, 4, 0, 0, 0, timeZone);
  const p = zonedParts(jan4, timeZone);
  const mondayOfWeek1 = addZonedDays(jan4, -(p.isoWeekday - 1), timeZone);
  return addZonedDays(mondayOfWeek1, (week - 1) * 7, timeZone);
}

export function weekKeyAdd(weekKey, weeks, timeZone) {
  const monday = weekKeyToMonday(weekKey, timeZone);
  const next = addZonedDays(monday, weeks * 7, timeZone);
  return weekKeyOf(next, timeZone);
}

/** 该 ISO 周的周一 00:00（= 上一周周考的截止时刻） */
export function weekDeadline(weekKey, timeZone) {
  return weekKeyToMonday(weekKey, timeZone);
}

/** 周考开放时刻：该周周日 00:00（当地） */
export function weekExamOpen(weekKey, timeZone) {
  const monday = weekKeyToMonday(weekKey, timeZone);
  return addZonedDays(monday, 6, timeZone);
}

export function formatZoned(date, timeZone, opts = {}) {
  const p = zonedParts(date, timeZone);
  return `${dayKey(date, timeZone)} ${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}${opts.zone ? ' ' + timeZone : ''}`;
}

/** 可注入 Clock —— 测试里绝不允许真的等三天。 */
class SystemClock {
  now() {
    return new Date();
  }
  get timeZone() {
    return 'UTC';
  }
}

class FixedClock {
  constructor(iso, timeZone = 'Asia/Shanghai') {
    this._t = new Date(iso);
    this._tz = timeZone;
  }
  now() {
    return new Date(this._t);
  }
  set(iso) {
    this._t = new Date(iso);
  }
  advanceDays(days) {
    this._t = new Date(this._t.getTime() + days * 86400000);
  }
  get timeZone() {
    return this._tz;
  }
}

export function systemClock() {
  return new SystemClock();
}

export function fixedClock(iso, timeZone = 'Asia/Shanghai') {
  return new FixedClock(iso, timeZone);
}
