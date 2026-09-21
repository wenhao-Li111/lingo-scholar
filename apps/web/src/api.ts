/** API 客户端：统一携带 Cookie 与 CSRF；错误抛成带 code 的对象。 */

export type ApiError = { error: string; message?: string; status: number; [k: string]: unknown };

let csrfToken: string | null = null;

export function setCsrf(t: string | null) {
  csrfToken = t;
  if (t) sessionStorage.setItem('lingo.csrf', t);
  else sessionStorage.removeItem('lingo.csrf');
}

export function getCsrf() {
  if (!csrfToken) csrfToken = sessionStorage.getItem('lingo.csrf');
  return csrfToken;
}

async function request<T>(method: string, url: string, body?: unknown, opts: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { ...(opts.headers as Record<string, string> | undefined) };
  if (body !== undefined && !(body instanceof ArrayBuffer) && !(body instanceof Blob)) {
    headers['content-type'] = 'application/json';
  }
  const csrf = getCsrf();
  if (csrf && method !== 'GET') headers['x-csrf-token'] = csrf;
  const res = await fetch(url, {
    method,
    headers,
    credentials: 'same-origin',
    body: body === undefined ? undefined : (body instanceof ArrayBuffer || body instanceof Blob ? (body as BodyInit) : JSON.stringify(body)),
    ...opts,
  });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
  if (!res.ok) {
    const err: ApiError = { status: res.status, error: json?.error || 'HTTP_ERROR', message: json?.message || `请求失败 (${res.status})`, ...(json || {}) };
    throw err;
  }
  return json as T;
}

export const api = {
  get: <T>(u: string, o?: RequestInit) => request<T>('GET', u, undefined, o),
  post: <T>(u: string, b?: unknown, o?: RequestInit) => request<T>('POST', u, b, o),
  patch: <T>(u: string, b?: unknown, o?: RequestInit) => request<T>('PATCH', u, b, o),
};

/* ------------------------------- 类型 ------------------------------- */
export type Question = {
  index: number;
  wordId: string;
  type: 'definition' | 'cloze';
  prompt: string;
  hintZh?: string;
  hint?: string | null;
  phase?: string;
  position?: number;
  total?: number;
  queueRemaining?: number;
  wordImportance?: string;
};

export type TaskView = {
  id: string;
  groupId: string;
  groupTitle: string | null;
  taskType: string;
  status: 'first_test' | 'remediation' | 'completed';
  firstPassCorrect: number | null;
  firstPassTotal: number;
  correctedMastery: number;
  progress: { answered: number; total: number; demonstrated: number; demonstratedTotal: number };
  wrongWordIds: string[];
  currentQuestion: Question | null;
  ruleVersion: string;
  courseVersion: string;
};

export type TodayView = {
  serverTime: string;
  timezone: string;
  user: { level: number; displayName: string };
  points: { total: number; weekKey: string; points: number };
  tasks: {
    overdueReviews: ReviewBrief[];
    upcomingReviews: ReviewBrief[];
    openTask: { id: string; groupId: string; status: string; taskType: string } | null;
    nextGroup: { id: string; title: string; idx: number; level: number } | null;
  };
  weekly: {
    weekKey: string; state: string; reason: string; openAt: string; deadlineAt: string;
    eligibleWords: number; score: number | null; firstScore: number | null; bestMakeup: number | null;
    penaltyApplied: boolean; penaltyRefunded: boolean; completedGroupsThisWeek: number; weeklyGroupReviewsDone: number;
  };
  study: { totalSeconds: number; todaySeconds: number; days: { dayKey: string; seconds: number }[]; method: string };
  plan: Record<string, unknown>;
  dailyAllocation: Record<string, number>;
  newWordDaysIso: number[];
  weeklyGroupReview: { eligible: boolean; reason: string; missing?: string[] };
};

export type ReviewBrief = { id: string; groupId: string; groupTitle: string; kind: string; dueAt: string; overdue: boolean };

export type ArticleView = {
  id: string; groupId: string; title: string; type: string; level: number; role: string;
  topics: string[]; authors: string[]; attribution: string | null; licenseNote: string | null;
  textOrigin: string; translationOrigin: string; rightsStatus: string; wordCount: number;
  locked: boolean;
  paragraphs: { index: number; en: string; zh: string | null }[] | null;
  comprehension: { id: string; prompt: string; choices: string[]; answerIndex: number; explanation: string; evidence: string }[] | null;
  occurrences?: { wordId: string; paragraph: number; sentence: string; form: string }[];
  coverage?: { covered: number; total: number; note: string };
  media: {
    id: string; url: string; durationSeconds: number; human: boolean; synthetic: boolean;
    voice: string | null; provider: string | null; license: string; sha256: string | null; format: string;
    verifiedPlayable: boolean; alignmentSource: string; alignmentPrecision: string;
  } | null;
  firstListen: { hideEnglish: boolean; hideChinese: boolean; hideGlossary: boolean; unlocked: boolean; unlockedAt: string | null; unlockRule: string };
  policy: { rates: number[]; coverageUnlockRatio: number; requireNaturalEndEvidence: boolean; timeUnit: string; note: string };
  progress: { position: number; rate: number; listenSeconds: number } | null;
};

export type WordDetail = {
  id: string; lemma: string; partOfSpeech: string; coreMeaningZh: string; phonetic: string | null;
  collocations: string[]; confusionPairs: { word: string; note: string }[]; cloze: { en: string; answer: string; hintZh: string };
  topic: string; level: number;
};
