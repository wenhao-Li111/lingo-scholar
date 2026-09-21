/**
 * @lingo/domain — 集中配置。
 * 数值来源：assets/DEFAULTS.json (rules-v1)。任何业务规则只从这里读取，
 * 不允许散落在组件里硬编码，以便规则版本可追溯。
 */

export const RULES_VERSION = 'rules-v1';
export const COURSE_VERSION = 'course-v1';

export const CONFIG = Object.freeze({
  product: {
    name: 'Lingo Scholar',
    nameZh: '听词研习室',
    locale: 'zh-CN',
    exam: 'IELTS General Training',
    overallTarget: 6.5,
    minimumComponentTarget: 6.0,
    maxGroupMembers: 10,
    defaultGroupTimezone: 'Asia/Shanghai',
  },
  plan: {
    mainWeeks: 16,
    bufferWeeks: 4,
    dailyMinutes: 120,
    newWordGroupSize: 20,
    newWordDaysIso: [1, 2, 3, 4, 5],
    groupsPerNewWordDay: 1,
    dailyAllocationMinutes: {
      review: 25,
      new_words: 30,
      listening_reading: 40,
      speaking: 20,
      reflection: 5,
    },
  },
  levels: [
    { id: 1, name: '生活信息辨认', groups: 10, words: 200, cumulativeWords: 200, suggestedWeeks: 2 },
    { id: 2, name: '日常交流理解', groups: 15, words: 300, cumulativeWords: 500, suggestedWeeks: 3 },
    { id: 3, name: '工作与学习交流', groups: 15, words: 300, cumulativeWords: 800, suggestedWeeks: 3 },
    { id: 4, name: '信息整合与观点', groups: 20, words: 400, cumulativeWords: 1200, suggestedWeeks: 4 },
    { id: 5, name: '综合听说巩固', groups: 20, words: 400, cumulativeWords: 1600, suggestedWeeks: 4 },
  ],
  vocabulary: {
    completionMode: 'first_test_then_wrong_items_only',
    correctedMasteryPercent: 100,
    retainFirstPassScore: true,
    learnReward: 10,
    manualPracticeReward: 0,
    highErrorMinimumWrongSubmissions: 4,
    /** 重要等级区间： [min, max|null]，对应常规/关注/重点/高频错/顽固错 */
    importanceErrorRanges: [[0, 0], [1, 1], [2, 3], [4, 6], [7, null]],
    importanceLabels: ['常规', '关注', '重点', '高频错', '顽固错'],
    acceptSynonyms: false,
    allowExplicitSpellingVariants: true,
    /** 展示答案后需间隔多少个其它条目才能再次无提示作答 */
    remediationGapItems: 2,
  },
  content: {
    coreWordsTarget: 1600,
    groupsTarget: 80,
    minMainMaterials: 80,
    maxMaterialsPerGroup: 3,
    articleTargetWordMinimum: 14,
    articleTargetWordRatio: 0.7,
    speakingScenariosPerGroup: 4,
    heldoutGateFormsPerLevel: 2,
    minDistinctGateMaterials: 20,
    existingBilingualMaterialRatioTarget: 0.6,
    preferHumanAudio: true,
    unknownRightsPublish: false,
    generatedTranslationCountsAsExistingBilingual: false,
  },
  listening: {
    hideEnglishFirstPass: true,
    hideChineseFirstPass: true,
    hideGlossaryFirstPass: true,
    coverageUnlockRatio: 0.98,
    requireNaturalEndEvidence: true,
    playbackRates: [0.75, 1, 1.25, 1.5, 2],
    timeUnit: 'wall_clock_union_per_user',
    lockedScreenAudioTimeCounts: true,
    /** 单次 playback 事件允许上报的最大墙钟时长（秒），超出标记待确认 */
    maxPlausibleEventSeconds: 3 * 3600,
  },
  review: {
    firstDueCalendarDays: 3,
    dueBeforeNewTask: true,
    weeklyIndependentOfFirstDue: true,
    completeCorrectedMasteryPercent: 100,
    rewardPerSystemGroup: 10,
    archiveAfter: ['day3_review_completed', 'weekly_group_review_completed'],
    longTermDaysAfterArchive: [14, 30, 60],
    wrongItemRepairNextDay: true,
  },
  weekly: {
    openIsoWeekday: 7,
    deadline: 'following_monday_00:00_group_timezone',
    include: 'all_completed_new_words_at_first_start_plus_carryover',
    freezeScopeAtFirstStart: true,
    maxExtraOldWords: 20,
    passPercent: 60,
    deductOnFailureOrAbsence: 10,
    deductAtMostOncePerUserWeek: true,
    refundOnceOnMakeupPass: 10,
    refundWeek: 'original_penalty_week',
    examParticipationBonus: 0,
    groupReviewBonus: 10,
    shortOldWordBatchBonus: 0,
    noEligibleWordsExempt: true,
  },
  gate: {
    initialLevel: 1,
    skipLevels: false,
    requiresAllLevelGroups: true,
    requiresNoOverdueReview: true,
    vocabQuestions: 20,
    vocabCorrectMin: 18,
    readingQuestions: 10,
    readingCorrectMin: 8,
    listeningQuestions: 10,
    listeningCorrectMin: 8,
    listenSpeed: 1,
    listenTranscript: false,
    requireUnseenDistinctReadingListening: true,
    reward: 0,
  },
  social: {
    weeklyAndTotalBoards: true,
    leaderboardRefreshTargetSeconds: 10,
    inviteExpiryDays: 7,
    inviteSingleUse: true,
    equalScoreSharedRank: true,
    defaultSharingScope: 'group_members_only',
    shareRawVoiceByDefault: false,
  },
  voice: {
    desiredMode: 'near_realtime_spoken_dialogue',
    paidRuntimeApiAllowed: false,
    thirdPartyBrowserAsrOptIn: true,
    rawAudioTempMaxHours: 24,
    targetWarmFirstAudioP50Seconds: 2.5,
    targetWarmFirstAudioP95Seconds: 5,
    benchmarkMinTurns: 20,
    baselineModelConcurrency: 1,
    targetServerCores: 2,
    targetServerRamGb: 4,
    gpuProven: false,
    newModelDownloadBudgetGb: 3,
    singleModelMaxGb: 1.5,
    /** VAD：判定用户说完的静音阈值 */
    vadSilenceMs: 1100,
    vadMinSpeechMs: 350,
    vadRmsThreshold: 0.012,
    maxTurnSeconds: 45,
    maxTurnBytes: 6 * 1024 * 1024,
  },
  delivery: {
    separateStatusDimensions: ['product_core', 'content_course', 'voice', 'device_verification'],
    pretendMockAsRealAllowed: false,
    nativeMobileDeviceTestCanBeReplacedByEmulation: false,
  },
});

export const LEVEL_BY_ID = new Map(CONFIG.levels.map((l) => [l.id, l]));

export function levelGroupCount(levelId) {
  const lv = LEVEL_BY_ID.get(Number(levelId));
  if (!lv) throw new Error(`未知级别: ${levelId}`);
  return lv.groups;
}

export function totalGroupCount() {
  return CONFIG.levels.reduce((sum, l) => sum + l.groups, 0);
}

export function totalWordCount() {
  return CONFIG.levels.reduce((sum, l) => sum + l.words, 0);
}

/**
 * 每个级别下的词组序号范围（含端点），组号从 1 开始全局连续。
 * L1: g001-g010, L2: g011-g025, L3: g026-g040, L4: g041-g060, L5: g061-g080
 */
export function levelGroupRange(levelId) {
  const id = Number(levelId);
  let start = 1;
  for (const lv of CONFIG.levels) {
    if (lv.id === id) return { start, end: start + lv.groups - 1 };
    start += lv.groups;
  }
  throw new Error(`未知级别: ${levelId}`);
}

export function groupCode(groupIndex) {
  return `g${String(groupIndex).padStart(3, '0')}`;
}

export function levelOfGroup(groupIndex) {
  let start = 1;
  for (const lv of CONFIG.levels) {
    if (groupIndex >= start && groupIndex < start + lv.groups) return lv.id;
    start += lv.groups;
  }
  throw new Error(`组号超出范围: ${groupIndex}`);
}
