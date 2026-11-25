import { shiftDateStr } from './timezone.ts';
import type {
  DailyJournal,
  SessionEvent,
  Trade,
  TradingAccount,
  TradingSession,
} from './types.ts';

export interface EquityPoint {
  index: number;
  date: string;
  tradeId: string;
  instrument: string;
  tradeReturnPercent: number;
  cumulativePercent: number;
  cumulativeNetPnl: number | null;
}

export interface FinancialMetrics {
  totalTrades: number;
  openTradesCount: number;
  closedTradesCount: number;
  winCount: number;
  lossCount: number;
  breakevenCount: number;
  winRate: number | null; // 0..100
  profitFactor: number | null; // null if 0 losing trades -> display "N/A — No losing trades yet."
  hasLosingTrades: boolean;
  netProfitPercent: number;
  grossWinPercent: number;
  grossLossAbsPercent: number;
  monetarySampleSize: number;
  netMonetaryPnl: number | null; // null if no trades recorded monetary netPnl
  grossWinMonetary: number | null;
  grossLossAbsMonetary: number | null;
  monetaryProfitFactor: number | null;
  expectancyPercent: number | null;
  averageWinPercent: number | null;
  averageLossPercent: number | null;
  largestWinPercent: number | null;
  largestLossPercent: number | null;
  averageR: number | null;
  rSampleSize: number;
  maxDrawdownPercent: number;
  maxWinningStreak: number;
  maxLosingStreak: number;
  equityCurve: EquityPoint[];
}

export interface ActivityMetrics {
  totalSessions: number;
  plannedSessions: number;
  attendedSessions: number;
  missedSessions: number;
  cancelledSessions: number;
  attendanceRate: number | null;
  onTimeRate: number | null;
  onTimeSampleSize: number;
  zeroTradeSessions: number;
  validSetupRate: number | null;
  validSetupSampleSize: number;
  outOfSessionTrades: number;
  inSessionTrades: number;
  sessionBreakdown: Array<{
    sessionName: string;
    sessionCount: number;
    tradeCount: number;
    closedTradeCount: number;
    winRate: number | null;
    netProfitPercent: number;
  }>;
}

export interface DisciplineMetrics {
  followedPlanYes: number;
  followedPlanTotal: number;
  followedPlanRate: number | null;
  followedRiskYes: number;
  followedRiskTotal: number;
  followedRiskRate: number | null;
  impulsiveEntryYes: number;
  impulsiveEntryTotal: number;
  impulsiveEntryRate: number | null;
  exitedPerPlanYes: number;
  exitedPerPlanTotal: number;
  exitedPerPlanRate: number | null;
  steppedBackCount: number;
  checklistCompletionRate: number | null;
  checklistSampleDays: number;
  processOutcomeMatrix: {
    goodProcessGoodOutcome: number;
    goodProcessBadOutcome: number;
    badProcessGoodOutcome: number;
    badProcessBadOutcome: number;
    sampleSize: number;
  };
}

export interface PsychologyGroupStats {
  label: string;
  count: number;
  winRate: number | null;
  netProfitPercent: number;
}

export interface PsychologyMetrics {
  focusedVsDistracted: {
    focused: PsychologyGroupStats;
    distracted: PsychologyGroupStats;
  };
  calmVsAnxious: {
    calm: PsychologyGroupStats;
    anxious: PsychologyGroupStats;
  };
  tradesAfterLoss: {
    count: number;
    winRate: number | null;
    netProfitPercent: number;
  };
  impulsiveVsPlanned: {
    impulsive: PsychologyGroupStats;
    planned: PsychologyGroupStats;
  };
  confidenceVsResults: Array<{
    bucket: string;
    count: number;
    winRate: number | null;
    avgReturnPercent: number | null;
  }>;
  postExitEmotions: Array<{
    emotion: string;
    count: number;
    winCount: number;
    lossCount: number;
  }>;
}

export type CalendarDayStatus =
  | 'profitable'
  | 'losing'
  | 'breakeven'
  | 'attended_zero_trades'
  | 'missed_session'
  | 'no_session_planned'
  | 'no_record';

export function isActiveTrade(trade: Trade): boolean {
  return !(trade as Trade & { isDeleted?: boolean }).isDeleted;
}

export type DateRangePreset = 'today' | '7d' | '30d' | '90d' | 'all' | 'custom';

export interface DateRangeBounds {
  start: string;
  end: string;
}

export function computeDateRangeBounds(
  preset: DateRangePreset,
  today: string,
  customStart: string,
  customEnd: string
): DateRangeBounds {
  if (preset === 'all') return { start: '', end: '' };
  if (preset === 'today') return { start: today, end: today };
  if (preset === 'custom') return { start: customStart, end: customEnd };
  const days = preset === '7d' ? -6 : preset === '30d' ? -29 : -89;
  return { start: shiftDateStr(today, days), end: today };
}

export function isDateInRange(dateStr: string, bounds: DateRangeBounds): boolean {
  if (bounds.start && dateStr < bounds.start) return false;
  if (bounds.end && dateStr > bounds.end) return false;
  return true;
}

/**
 * Matches Daily / Session Records linkage semantics exactly:
 * an active trade belongs to a session iff !t.isOutOfSession && t.sessionId === sessionId.
 */
export function getSessionLinkedTrades(sessionId: string, trades: Trade[]): Trade[] {
  return trades
    .filter((t) => isActiveTrade(t) && !t.isOutOfSession && t.sessionId === sessionId)
    .sort((a, b) => a.openedAt.localeCompare(b.openedAt));
}

export interface ScopedWorkspaceRecords {
  accountScopedTrades: Trade[];
  rangeTrades: Trade[];
  rangeSessions: TradingSession[];
  rangeSessionEvents: SessionEvent[];
  rangeJournals: DailyJournal[];
}

/**
 * Canonical workspace scoping shared by Dashboard and Analytics so both pages
 * remain strictly synchronized with each other and with Daily / Session Records.
 */
export function scopeWorkspaceRecords(params: {
  sessions: TradingSession[];
  sessionEvents: SessionEvent[];
  trades: Trade[];
  dailyJournals: DailyJournal[];
  bounds: DateRangeBounds;
  accountId: string;
}): ScopedWorkspaceRecords {
  const { sessions, sessionEvents, trades, dailyJournals, bounds, accountId } = params;
  const active = trades.filter(isActiveTrade);
  const accountScopedTrades =
    accountId === 'all' ? active : active.filter((t) => t.accountId === accountId);

  const rangeTrades = accountScopedTrades.filter((t) => isDateInRange(t.date, bounds));
  const rangeSessions = sessions
    .filter((s) => isDateInRange(s.date, bounds))
    .sort((a, b) => (b.actualStartTime ?? b.date).localeCompare(a.actualStartTime ?? a.date));
  const rangeSessionIds = new Set(rangeSessions.map((s) => s.id));
  const rangeSessionEvents = sessionEvents.filter(
    (e) => isDateInRange(e.date, bounds) || rangeSessionIds.has(e.sessionId)
  );
  const rangeJournals = dailyJournals.filter((j) => isDateInRange(j.date, bounds));

  return {
    accountScopedTrades,
    rangeTrades,
    rangeSessions,
    rangeSessionEvents,
    rangeJournals,
  };
}

export function resolveNetPnl(
  grossPnl?: number,
  commission?: number,
  otherCharges?: number,
  netPnl?: number
): number | undefined {
  if (typeof netPnl === 'number' && Number.isFinite(netPnl)) {
    return Number(netPnl.toFixed(2));
  }
  if (typeof grossPnl === 'number' && Number.isFinite(grossPnl)) {
    const comm = typeof commission === 'number' && Number.isFinite(commission) ? commission : 0;
    const other = typeof otherCharges === 'number' && Number.isFinite(otherCharges) ? otherCharges : 0;
    return Number((grossPnl - comm - other).toFixed(2));
  }
  return undefined;
}

export function buildAccountFilterOptions(
  accounts: TradingAccount[],
  trades: Trade[]
): Array<{ value: string; label: string }> {
  const options: Array<{ value: string; label: string }> = [
    { value: 'all', label: 'All Accounts' },
    ...accounts.map((a) => ({ value: a.id, label: `${a.name} (${a.currency})` })),
  ];
  const knownIds = new Set(accounts.map((a) => a.id));
  const historical = new Map<string, string>();
  for (const t of trades) {
    if (!isActiveTrade(t) || !t.accountId || knownIds.has(t.accountId)) continue;
    if (!historical.has(t.accountId)) {
      const name = t.accountName || t.accountId;
      const cur = t.currency ? `${t.currency.toUpperCase()} · Historical` : 'Historical';
      historical.set(t.accountId, `${name} (${cur})`);
    }
  }
  const historicalOptions = Array.from(historical.entries())
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
  return [...options, ...historicalOptions];
}

export function computeRealisedR(trade: Trade): number | null {
  if (typeof trade.realisedR === 'number' && Number.isFinite(trade.realisedR)) {
    return trade.realisedR;
  }
  if (
    trade.status === 'closed' &&
    typeof trade.actualProfitPercent === 'number' &&
    Number.isFinite(trade.actualProfitPercent) &&
    typeof trade.riskPercent === 'number' &&
    Number.isFinite(trade.riskPercent) &&
    trade.riskPercent > 0
  ) {
    return Number((trade.actualProfitPercent / trade.riskPercent).toFixed(2));
  }
  return null;
}

export function calculateFinancialMetrics(trades: Trade[]): FinancialMetrics {
  const activeTrades = trades.filter(isActiveTrade);
  const closedTrades = activeTrades
    .filter((t) => t.status === 'closed')
    .sort(
      (a, b) =>
        (a.closedAt ?? a.openedAt).localeCompare(b.closedAt ?? b.openedAt) ||
        (a.tradeNumberOfDay ?? 0) - (b.tradeNumberOfDay ?? 0) ||
        a.id.localeCompare(b.id)
    );
  const openTradesCount = activeTrades.filter((t) => t.status !== 'closed').length;

  const resultTrades = closedTrades.filter(
    (t) => t.exitOutcome === 'win' || t.exitOutcome === 'loss' || t.exitOutcome === 'breakeven'
  );
  const wins = resultTrades.filter((t) => t.exitOutcome === 'win');
  const losses = resultTrades.filter((t) => t.exitOutcome === 'loss');
  const breakevens = resultTrades.filter((t) => t.exitOutcome === 'breakeven');

  const winRate =
    resultTrades.length > 0 ? Number(((wins.length / resultTrades.length) * 100).toFixed(1)) : null;

  let grossWinPercent = 0;
  let grossLossAbsPercent = 0;
  let netProfitPercent = 0;
  const winReturns: number[] = [];
  const lossReturns: number[] = [];

  let monetarySampleSize = 0;
  let netMonetarySum = 0;
  let grossWinMonetary = 0;
  let grossLossAbsMonetary = 0;
  let hasMonetaryLoss = false;

  const rValues: number[] = [];
  const equityCurve: EquityPoint[] = [];
  let cumulativePercent = 0;
  let cumulativeMonetary = 0;
  let peakPercent = 0;
  let maxDrawdownPercent = 0;

  let currentWinStreak = 0;
  let maxWinningStreak = 0;
  let currentLossStreak = 0;
  let maxLosingStreak = 0;

  let resultTradesNetProfitPercent = 0;

  closedTrades.forEach((t, idx) => {
    const ret =
      typeof t.actualProfitPercent === 'number' && Number.isFinite(t.actualProfitPercent)
        ? t.actualProfitPercent
        : 0;
    netProfitPercent += ret;
    cumulativePercent = Number((cumulativePercent + ret).toFixed(4));

    if (t.exitOutcome === 'win') {
      resultTradesNetProfitPercent += ret;
      grossWinPercent += Math.max(0, ret);
      winReturns.push(ret);
      currentWinStreak += 1;
      currentLossStreak = 0;
      if (currentWinStreak > maxWinningStreak) maxWinningStreak = currentWinStreak;
    } else if (t.exitOutcome === 'loss') {
      resultTradesNetProfitPercent += ret;
      grossLossAbsPercent += Math.abs(ret);
      lossReturns.push(ret);
      currentLossStreak += 1;
      currentWinStreak = 0;
      if (currentLossStreak > maxLosingStreak) maxLosingStreak = currentLossStreak;
    } else if (t.exitOutcome === 'breakeven') {
      resultTradesNetProfitPercent += ret;
      currentWinStreak = 0;
      currentLossStreak = 0;
    } else {
      currentWinStreak = 0;
      currentLossStreak = 0;
    }

    if (cumulativePercent > peakPercent) {
      peakPercent = cumulativePercent;
    }
    const dd = peakPercent - cumulativePercent;
    if (dd > maxDrawdownPercent) {
      maxDrawdownPercent = dd;
    }

    let pointMonetary: number | null = null;
    if (typeof t.netPnl === 'number' && Number.isFinite(t.netPnl)) {
      monetarySampleSize += 1;
      netMonetarySum += t.netPnl;
      cumulativeMonetary = Number((cumulativeMonetary + t.netPnl).toFixed(2));
      pointMonetary = cumulativeMonetary;
      if (t.netPnl > 0) {
        grossWinMonetary += t.netPnl;
      } else if (t.netPnl < 0) {
        grossLossAbsMonetary += Math.abs(t.netPnl);
        hasMonetaryLoss = true;
      }
    }

    const r = computeRealisedR(t);
    if (r !== null) {
      rValues.push(r);
    }

    equityCurve.push({
      index: idx + 1,
      date: t.date,
      tradeId: t.id,
      instrument: t.instrument,
      tradeReturnPercent: Number(ret.toFixed(2)),
      cumulativePercent: Number(cumulativePercent.toFixed(2)),
      cumulativeNetPnl: pointMonetary,
    });
  });

  const hasLosingTrades = losses.length > 0 && grossLossAbsPercent > 0;
  const profitFactor = hasLosingTrades
    ? Number((grossWinPercent / grossLossAbsPercent).toFixed(2))
    : null;

  const monetaryProfitFactor =
    monetarySampleSize > 0 && hasMonetaryLoss && grossLossAbsMonetary > 0
      ? Number((grossWinMonetary / grossLossAbsMonetary).toFixed(2))
      : null;

  const averageWinPercent =
    winReturns.length > 0
      ? Number((winReturns.reduce((a, b) => a + b, 0) / winReturns.length).toFixed(2))
      : null;
  const averageLossPercent =
    lossReturns.length > 0
      ? Number((lossReturns.reduce((a, b) => a + b, 0) / lossReturns.length).toFixed(2))
      : null;

  const expectancyPercent =
    resultTrades.length > 0
      ? Number((resultTradesNetProfitPercent / resultTrades.length).toFixed(2))
      : null;

  const largestWinPercent = winReturns.length > 0 ? Number(Math.max(...winReturns).toFixed(2)) : null;
  const largestLossPercent = lossReturns.length > 0 ? Number(Math.min(...lossReturns).toFixed(2)) : null;

  const averageR =
    rValues.length > 0
      ? Number((rValues.reduce((a, b) => a + b, 0) / rValues.length).toFixed(2))
      : null;

  return {
    totalTrades: activeTrades.length,
    openTradesCount,
    closedTradesCount: closedTrades.length,
    winCount: wins.length,
    lossCount: losses.length,
    breakevenCount: breakevens.length,
    winRate,
    profitFactor,
    hasLosingTrades,
    netProfitPercent: Number(netProfitPercent.toFixed(2)),
    grossWinPercent: Number(grossWinPercent.toFixed(2)),
    grossLossAbsPercent: Number(grossLossAbsPercent.toFixed(2)),
    monetarySampleSize,
    netMonetaryPnl: monetarySampleSize > 0 ? Number(netMonetarySum.toFixed(2)) : null,
    grossWinMonetary: monetarySampleSize > 0 ? Number(grossWinMonetary.toFixed(2)) : null,
    grossLossAbsMonetary: monetarySampleSize > 0 ? Number(grossLossAbsMonetary.toFixed(2)) : null,
    monetaryProfitFactor,
    expectancyPercent,
    averageWinPercent,
    averageLossPercent,
    largestWinPercent,
    largestLossPercent,
    averageR,
    rSampleSize: rValues.length,
    maxDrawdownPercent: Number(maxDrawdownPercent.toFixed(2)),
    maxWinningStreak,
    maxLosingStreak,
    equityCurve,
  };
}

export function calculateActivityMetrics(
  sessions: TradingSession[],
  trades: Trade[]
): ActivityMetrics {
  const activeTrades = trades.filter(isActiveTrade);
  const isCancelledSession = (s: TradingSession) =>
    s.status === 'cancelled' || s.attendance === 'cancelled';
  const isAttendedSession = (s: TradingSession) =>
    !isCancelledSession(s) &&
    (s.attendance === 'attended' || s.status === 'live' || s.status === 'completed');
  const isMissedSession = (s: TradingSession) =>
    !isCancelledSession(s) &&
    !isAttendedSession(s) &&
    (s.attendance === 'missed' || s.status === 'missed');

  const cancelled = sessions.filter(isCancelledSession);
  const attended = sessions.filter(isAttendedSession);
  const missed = sessions.filter(isMissedSession);
  const planned = sessions.filter(
    (s) => !isCancelledSession(s) && !isAttendedSession(s) && !isMissedSession(s)
  );
  const plannedOrTrackable = sessions.filter((s) => !isCancelledSession(s));

  const attendanceRate =
    plannedOrTrackable.length > 0
      ? Number(((attended.length / plannedOrTrackable.length) * 100).toFixed(1))
      : null;

  // On-time check: actualStartTime <= scheduledStart + 15 min
  let onTimeSampleSize = 0;
  let onTimeCount = 0;
  for (const s of attended) {
    if (s.actualStartTime && s.scheduledStart && s.scheduledStart.length === 5) {
      onTimeSampleSize += 1;
      const startDt = new Date(s.actualStartTime);
      const [hh, mm] = s.scheduledStart.split(':').map(Number);
      if (!Number.isNaN(startDt.getTime()) && !Number.isNaN(hh) && !Number.isNaN(mm)) {
        try {
          const parts = new Intl.DateTimeFormat('en-GB', {
            timeZone: s.timezone || 'Asia/Kolkata',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
          }).formatToParts(startDt);
          const rawHour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
          const ah = rawHour === 24 ? 0 : rawHour;
          const am = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
          if (ah * 60 + am <= hh * 60 + mm + 15) {
            onTimeCount += 1;
          }
        } catch {
          onTimeCount += 1;
        }
      }
    }
  }
  const onTimeRate =
    onTimeSampleSize > 0 ? Number(((onTimeCount / onTimeSampleSize) * 100).toFixed(1)) : null;

  const tradesBySession = new Map<string, Trade[]>();
  for (const t of activeTrades) {
    if (!t.isOutOfSession && t.sessionId) {
      const list = tradesBySession.get(t.sessionId) ?? [];
      list.push(t);
      tradesBySession.set(t.sessionId, list);
    }
  }

  const zeroTradeSessions = attended.filter((s) => (tradesBySession.get(s.id)?.length ?? 0) === 0).length;

  const setupRecorded = sessions.filter(
    (s) => s.setupAvailability && s.setupAvailability !== 'pending'
  );
  const setupAvailable = setupRecorded.filter(
    (s) => s.setupAvailability === 'available' || s.setupAvailability === 'limited'
  );
  const validSetupRate =
    setupRecorded.length > 0
      ? Number(((setupAvailable.length / setupRecorded.length) * 100).toFixed(1))
      : null;

  const outOfSessionTrades = activeTrades.filter((t) => t.isOutOfSession).length;
  const inSessionTrades = activeTrades.filter((t) => !t.isOutOfSession).length;

  const byName = new Map<string, { sessions: TradingSession[]; trades: Trade[] }>();
  const matchedSessionIds = new Set<string>();
  for (const s of sessions) {
    matchedSessionIds.add(s.id);
    const key = (s.sessionName || 'Custom').trim() || 'Custom';
    const entry = byName.get(key) ?? { sessions: [], trades: [] };
    entry.sessions.push(s);
    entry.trades.push(...(tradesBySession.get(s.id) ?? []));
    byName.set(key, entry);
  }

  // Reconcile any in-session trades whose parent session fell outside the date window
  // so sessionBreakdown trade totals always reconcile with inSessionTrades.
  for (const t of activeTrades) {
    if (t.isOutOfSession) continue;
    if (t.sessionId && matchedSessionIds.has(t.sessionId)) continue;
    const key = (t.sessionName || 'Linked Session').trim() || 'Linked Session';
    const entry = byName.get(key) ?? { sessions: [], trades: [] };
    entry.trades.push(t);
    byName.set(key, entry);
  }

  const sessionBreakdown = Array.from(byName.entries()).map(([sessionName, data]) => {
    const closed = data.trades.filter((t) => t.status === 'closed');
    const resultClosed = closed.filter(
      (t) => t.exitOutcome === 'win' || t.exitOutcome === 'loss' || t.exitOutcome === 'breakeven'
    );
    const wins = resultClosed.filter((t) => t.exitOutcome === 'win').length;
    const net = closed.reduce(
      (acc, t) =>
        acc +
        (typeof t.actualProfitPercent === 'number' && Number.isFinite(t.actualProfitPercent)
          ? t.actualProfitPercent
          : 0),
      0
    );
    return {
      sessionName,
      sessionCount: data.sessions.length,
      tradeCount: data.trades.length,
      closedTradeCount: closed.length,
      winRate:
        resultClosed.length > 0 ? Number(((wins / resultClosed.length) * 100).toFixed(1)) : null,
      netProfitPercent: Number(net.toFixed(2)),
    };
  });

  return {
    totalSessions: sessions.length,
    plannedSessions: planned.length,
    attendedSessions: attended.length,
    missedSessions: missed.length,
    cancelledSessions: cancelled.length,
    attendanceRate,
    onTimeRate,
    onTimeSampleSize,
    zeroTradeSessions,
    validSetupRate,
    validSetupSampleSize: setupRecorded.length,
    outOfSessionTrades,
    inSessionTrades,
    sessionBreakdown,
  };
}

export function calculateDisciplineMetrics(
  trades: Trade[],
  sessionEvents: SessionEvent[],
  dailyJournals: DailyJournal[]
): DisciplineMetrics {
  const closed = trades.filter((t) => isActiveTrade(t) && t.status === 'closed');

  const planRecorded = closed.filter((t) => t.followedPlan === 'yes' || t.followedPlan === 'no');
  const planYes = planRecorded.filter((t) => t.followedPlan === 'yes').length;

  const riskRecorded = closed.filter((t) => t.followedRiskRules === 'yes' || t.followedRiskRules === 'no');
  const riskYes = riskRecorded.filter((t) => t.followedRiskRules === 'yes').length;

  const impRecorded = closed.filter((t) => t.impulsiveEntry === 'yes' || t.impulsiveEntry === 'no');
  const impYes = impRecorded.filter((t) => t.impulsiveEntry === 'yes').length;

  const exitRecorded = closed.filter((t) => t.exitedPerPlan === 'yes' || t.exitedPerPlan === 'no');
  const exitYes = exitRecorded.filter((t) => t.exitedPerPlan === 'yes').length;

  // Anti-bias pause cancellation records a paired guard_cancelled + stepped_back event.
  // Count every stepped_back event plus any standalone guard_cancelled not already paired.
  const steppedBackEvents = sessionEvents.filter((e) => e.eventType === 'stepped_back');
  const guardCancelledEvents = sessionEvents.filter((e) => e.eventType === 'guard_cancelled');
  let unpairedGuardCancelled = 0;
  for (const gc of guardCancelledEvents) {
    const gcMs = new Date(gc.timestamp).getTime();
    const hasPairedStepBack = steppedBackEvents.some((sb) => {
      if (sb.sessionId !== gc.sessionId) return false;
      const sbMs = new Date(sb.timestamp).getTime();
      return !Number.isNaN(gcMs) && !Number.isNaN(sbMs) && Math.abs(sbMs - gcMs) <= 5000;
    });
    if (!hasPairedStepBack) {
      unpairedGuardCancelled += 1;
    }
  }
  const steppedBackCount = steppedBackEvents.length + unpairedGuardCancelled;

  let totalChecklistItems = 0;
  let completedChecklistItems = 0;
  let checklistSampleDays = 0;
  for (const dj of dailyJournals) {
    if (dj.checklistItems && dj.checklistItems.length > 0) {
      checklistSampleDays += 1;
      totalChecklistItems += dj.checklistItems.length;
      completedChecklistItems += dj.checklistItems.filter((c) => c.completed).length;
    }
  }

  let goodProcessGoodOutcome = 0;
  let goodProcessBadOutcome = 0;
  let badProcessGoodOutcome = 0;
  let badProcessBadOutcome = 0;
  let matrixSampleSize = 0;

  for (const t of closed) {
    if (t.followedPlan === 'na' || t.followedRiskRules === 'na') continue;
    if (t.exitOutcome !== 'win' && t.exitOutcome !== 'loss') continue;
    matrixSampleSize += 1;
    const goodProcess =
      t.followedPlan === 'yes' && t.followedRiskRules === 'yes' && t.impulsiveEntry !== 'yes';
    const goodOutcome = t.exitOutcome === 'win';
    if (goodProcess && goodOutcome) goodProcessGoodOutcome += 1;
    else if (goodProcess && !goodOutcome) goodProcessBadOutcome += 1;
    else if (!goodProcess && goodOutcome) badProcessGoodOutcome += 1;
    else badProcessBadOutcome += 1;
  }

  return {
    followedPlanYes: planYes,
    followedPlanTotal: planRecorded.length,
    followedPlanRate:
      planRecorded.length > 0 ? Number(((planYes / planRecorded.length) * 100).toFixed(1)) : null,
    followedRiskYes: riskYes,
    followedRiskTotal: riskRecorded.length,
    followedRiskRate:
      riskRecorded.length > 0 ? Number(((riskYes / riskRecorded.length) * 100).toFixed(1)) : null,
    impulsiveEntryYes: impYes,
    impulsiveEntryTotal: impRecorded.length,
    impulsiveEntryRate:
      impRecorded.length > 0 ? Number(((impYes / impRecorded.length) * 100).toFixed(1)) : null,
    exitedPerPlanYes: exitYes,
    exitedPerPlanTotal: exitRecorded.length,
    exitedPerPlanRate:
      exitRecorded.length > 0 ? Number(((exitYes / exitRecorded.length) * 100).toFixed(1)) : null,
    steppedBackCount,
    checklistCompletionRate:
      totalChecklistItems > 0
        ? Number(((completedChecklistItems / totalChecklistItems) * 100).toFixed(1))
        : null,
    checklistSampleDays,
    processOutcomeMatrix: {
      goodProcessGoodOutcome,
      goodProcessBadOutcome,
      badProcessGoodOutcome,
      badProcessBadOutcome,
      sampleSize: matrixSampleSize,
    },
  };
}

function summarizeGroup(label: string, groupTrades: Trade[]): PsychologyGroupStats {
  const closed = groupTrades.filter(
    (t) =>
      isActiveTrade(t) &&
      t.status === 'closed' &&
      (t.exitOutcome === 'win' || t.exitOutcome === 'loss' || t.exitOutcome === 'breakeven')
  );
  const wins = closed.filter((t) => t.exitOutcome === 'win').length;
  const net = closed.reduce((acc, t) => acc + (t.actualProfitPercent ?? 0), 0);
  return {
    label,
    count: closed.length,
    winRate: closed.length > 0 ? Number(((wins / closed.length) * 100).toFixed(1)) : null,
    netProfitPercent: Number(net.toFixed(2)),
  };
}

export function calculatePsychologyMetrics(trades: Trade[]): PsychologyMetrics {
  const closed = trades
    .filter((t) => isActiveTrade(t) && t.status === 'closed')
    .sort(
      (a, b) =>
        a.openedAt.localeCompare(b.openedAt) ||
        (a.tradeNumberOfDay ?? 0) - (b.tradeNumberOfDay ?? 0) ||
        a.id.localeCompare(b.id)
    );

  const focusedTrades = closed.filter((t) => {
    const e = (t.preTradeEmotion ?? '').toLowerCase();
    return e.includes('focus') || e.includes('present') || e.includes('confident');
  });
  const distractedTrades = closed.filter((t) => {
    const e = (t.preTradeEmotion ?? '').toLowerCase();
    return e.includes('distract') || e.includes('tired') || e.includes('fatigued');
  });

  const calmTrades = closed.filter((t) => (t.preTradeEmotion ?? '').toLowerCase().includes('calm'));
  const anxiousTrades = closed.filter((t) => {
    const e = (t.preTradeEmotion ?? '').toLowerCase();
    return e.includes('anxious') || e.includes('frustrat') || e.includes('impatient');
  });

  const afterLossTrades: Trade[] = [];
  for (let i = 1; i < closed.length; i++) {
    const current = closed[i];
    // Walk backward skipping simultaneous sibling executions from the same linked tradeGroupId
    let prevIndex = i - 1;
    while (
      prevIndex >= 0 &&
      current.tradeGroupId &&
      closed[prevIndex].tradeGroupId === current.tradeGroupId
    ) {
      prevIndex -= 1;
    }
    if (prevIndex >= 0 && closed[prevIndex].exitOutcome === 'loss') {
      afterLossTrades.push(current);
    }
  }
  const afterLossStats = summarizeGroup('After Loss', afterLossTrades);

  const impulsiveTrades = closed.filter((t) => t.impulsiveEntry === 'yes');
  const plannedTrades = closed.filter((t) => t.impulsiveEntry === 'no');

  const buckets = [
    { label: 'Low (1-4)', min: 1, max: 4 },
    { label: 'Medium (5-7)', min: 5, max: 7 },
    { label: 'High (8-10)', min: 8, max: 10 },
  ];
  const confidenceVsResults = buckets.map((b) => {
    const matching = closed.filter(
      (t) =>
        t.confidence >= b.min &&
        t.confidence <= b.max &&
        (t.exitOutcome === 'win' || t.exitOutcome === 'loss' || t.exitOutcome === 'breakeven')
    );
    const wins = matching.filter((t) => t.exitOutcome === 'win').length;
    const avg =
      matching.length > 0
        ? Number(
            (
              matching.reduce(
                (acc, t) =>
                  acc +
                  (typeof t.actualProfitPercent === 'number' && Number.isFinite(t.actualProfitPercent)
                    ? t.actualProfitPercent
                    : 0),
                0
              ) / matching.length
            ).toFixed(2)
          )
        : null;
    return {
      bucket: b.label,
      count: matching.length,
      winRate: matching.length > 0 ? Number(((wins / matching.length) * 100).toFixed(1)) : null,
      avgReturnPercent: avg,
    };
  });

  const postEmotionMap = new Map<string, { count: number; winCount: number; lossCount: number }>();
  for (const t of closed) {
    if (!t.postTradeEmotion?.trim()) continue;
    const cur = postEmotionMap.get(t.postTradeEmotion) ?? { count: 0, winCount: 0, lossCount: 0 };
    cur.count += 1;
    if (t.exitOutcome === 'win') cur.winCount += 1;
    if (t.exitOutcome === 'loss') cur.lossCount += 1;
    postEmotionMap.set(t.postTradeEmotion, cur);
  }
  const postExitEmotions = Array.from(postEmotionMap.entries())
    .map(([emotion, stats]) => ({ emotion, ...stats }))
    .sort((a, b) => b.count - a.count);

  return {
    focusedVsDistracted: {
      focused: summarizeGroup('Focused', focusedTrades),
      distracted: summarizeGroup('Distracted / Tired', distractedTrades),
    },
    calmVsAnxious: {
      calm: summarizeGroup('Calm', calmTrades),
      anxious: summarizeGroup('Anxious / Impatient', anxiousTrades),
    },
    tradesAfterLoss: {
      count: afterLossStats.count,
      winRate: afterLossStats.winRate,
      netProfitPercent: afterLossStats.netProfitPercent,
    },
    impulsiveVsPlanned: {
      impulsive: summarizeGroup('Impulsive', impulsiveTrades),
      planned: summarizeGroup('Planned', plannedTrades),
    },
    confidenceVsResults,
    postExitEmotions,
  };
}

export function getCalendarDayStatus(
  date: string,
  journals: DailyJournal[],
  sessions: TradingSession[],
  trades: Trade[]
): {
  status: CalendarDayStatus;
  netProfitPercent: number;
  netMonetaryPnl: number | null;
  tradeCount: number;
  attendedSessions: number;
  missedSessions: number;
} {
  const dayJournal = journals.find((j) => j.date === date);
  const daySessions = sessions.filter((s) => s.date === date);
  const dayTrades = trades.filter((t) => isActiveTrade(t) && t.date === date);
  const closedTrades = dayTrades.filter((t) => t.status === 'closed');

  const netProfitPercent = Number(
    closedTrades
      .reduce(
        (acc, t) =>
          acc +
          (typeof t.actualProfitPercent === 'number' && Number.isFinite(t.actualProfitPercent)
            ? t.actualProfitPercent
            : 0),
        0
      )
      .toFixed(2)
  );
  const monetaryTrades = closedTrades.filter(
    (t) => typeof t.netPnl === 'number' && Number.isFinite(t.netPnl)
  );
  const netMonetaryPnl =
    monetaryTrades.length > 0
      ? Number(monetaryTrades.reduce((acc, t) => acc + (t.netPnl ?? 0), 0).toFixed(2))
      : null;

  const attendedSessions = daySessions.filter(
    (s) => s.attendance === 'attended' || s.status === 'live' || s.status === 'completed'
  ).length;
  const missedSessions = daySessions.filter(
    (s) => s.attendance === 'missed' || s.status === 'missed'
  ).length;

  let status: CalendarDayStatus = 'no_record';
  if (closedTrades.length > 0) {
    if (netProfitPercent > 0) status = 'profitable';
    else if (netProfitPercent < 0) status = 'losing';
    else status = 'breakeven';
  } else if (dayTrades.length > 0) {
    status = 'breakeven';
  } else if (attendedSessions > 0) {
    status = 'attended_zero_trades';
  } else if (missedSessions > 0) {
    status = 'missed_session';
  } else if (daySessions.length > 0 || dayJournal) {
    status = 'no_session_planned';
  }

  return {
    status,
    netProfitPercent,
    netMonetaryPnl,
    tradeCount: dayTrades.length,
    attendedSessions,
    missedSessions,
  };
}

export interface CurrencyNetPnl {
  currency: string;
  netPnl: number;
  tradeCount: number;
}

export interface TradeLedgerSummary {
  totalTrades: number;
  openTrades: number;
  closedTrades: number;
  winRate: number | null;
  netProfitPercent: number;
  monetaryByCurrency: CurrencyNetPnl[];
  singleCurrencyNetPnl: CurrencyNetPnl | null;
  hasMixedCurrencies: boolean;
}

export function groupCurrencyNetPnl(
  trades: Trade[],
  accounts: TradingAccount[],
  fallbackCurrency: string = 'USD'
): CurrencyNetPnl[] {
  const activeTrades = trades.filter(isActiveTrade);
  const accountCurrencyMap = new Map<string, string>();
  for (const acc of accounts) {
    if (acc.id && acc.currency) {
      accountCurrencyMap.set(acc.id, acc.currency.toUpperCase());
    }
  }

  const normalizedFallback = (fallbackCurrency || 'USD').toUpperCase();
  const currencyTotals = new Map<string, { sum: number; count: number }>();

  for (const t of activeTrades) {
    if (t.status !== 'closed') continue;
    if (typeof t.netPnl !== 'number' || !Number.isFinite(t.netPnl)) continue;
    const currency = (
      t.currency ||
      accountCurrencyMap.get(t.accountId) ||
      normalizedFallback
    ).toUpperCase();
    const prev = currencyTotals.get(currency) ?? { sum: 0, count: 0 };
    currencyTotals.set(currency, {
      sum: prev.sum + t.netPnl,
      count: prev.count + 1,
    });
  }

  return Array.from(currencyTotals.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, data]) => ({
      currency,
      netPnl: Number(data.sum.toFixed(2)),
      tradeCount: data.count,
    }));
}

export function summarizeTradesForLedger(
  trades: Trade[],
  accounts: TradingAccount[],
  fallbackCurrency: string = 'USD'
): TradeLedgerSummary {
  const activeTrades = trades.filter(isActiveTrade);
  const fin = calculateFinancialMetrics(activeTrades);
  const monetaryByCurrency = groupCurrencyNetPnl(activeTrades, accounts, fallbackCurrency);

  return {
    totalTrades: fin.totalTrades,
    openTrades: fin.openTradesCount,
    closedTrades: fin.closedTradesCount,
    winRate: fin.winRate,
    netProfitPercent: fin.netProfitPercent,
    monetaryByCurrency,
    singleCurrencyNetPnl:
      monetaryByCurrency.length === 1 ? monetaryByCurrency[0] : null,
    hasMixedCurrencies: monetaryByCurrency.length > 1,
  };
}

export interface AccountBreakdownRow {
  accountId: string;
  accountName: string;
  currency: string;
  totalTrades: number;
  openTrades: number;
  closedTrades: number;
  winRate: number | null;
  netProfitPercent: number;
  netMonetaryPnl: number | null;
  profitFactor: number | null;
  averageR: number | null;
}

export function calculateAccountBreakdown(
  trades: Trade[],
  accounts: TradingAccount[],
  fallbackCurrency: string = 'USD'
): AccountBreakdownRow[] {
  const activeTrades = trades.filter(isActiveTrade);
  const accountMap = new Map(accounts.map((a) => [a.id, a]));
  const grouped = new Map<string, Trade[]>();

  for (const t of activeTrades) {
    const list = grouped.get(t.accountId) ?? [];
    list.push(t);
    grouped.set(t.accountId, list);
  }

  return Array.from(grouped.entries())
    .map(([accountId, accTrades]) => {
      const acc = accountMap.get(accountId);
      const fin = calculateFinancialMetrics(accTrades);
      const currencyTotals = groupCurrencyNetPnl(accTrades, accounts, fallbackCurrency);
      const currency = (
        acc?.currency ||
        currencyTotals[0]?.currency ||
        accTrades.find((t) => t.currency)?.currency ||
        fallbackCurrency ||
        'USD'
      ).toUpperCase();
      return {
        accountId,
        accountName: acc?.name || accTrades[0]?.accountName || accountId,
        currency,
        totalTrades: fin.totalTrades,
        openTrades: fin.openTradesCount,
        closedTrades: fin.closedTradesCount,
        winRate: fin.winRate,
        netProfitPercent: fin.netProfitPercent,
        netMonetaryPnl: currencyTotals.length === 1 ? currencyTotals[0].netPnl : null,
        profitFactor: fin.profitFactor,
        averageR: fin.averageR,
      };
    })
    .sort((a, b) => b.closedTrades - a.closedTrades || a.accountName.localeCompare(b.accountName));
}

export interface DimensionBreakdownRow {
  key: string;
  totalTrades: number;
  closedTrades: number;
  winCount: number;
  lossCount: number;
  winRate: number | null;
  netProfitPercent: number;
  profitFactor: number | null;
  averageR: number | null;
}

function calculateGroupBreakdown(
  trades: Trade[],
  keyFn: (t: Trade) => string
): DimensionBreakdownRow[] {
  const activeTrades = trades.filter(isActiveTrade);
  const grouped = new Map<string, Trade[]>();
  for (const t of activeTrades) {
    const k = keyFn(t);
    const list = grouped.get(k) ?? [];
    list.push(t);
    grouped.set(k, list);
  }

  return Array.from(grouped.entries())
    .map(([key, items]) => {
      const fin = calculateFinancialMetrics(items);
      return {
        key,
        totalTrades: fin.totalTrades,
        closedTrades: fin.closedTradesCount,
        winCount: fin.winCount,
        lossCount: fin.lossCount,
        winRate: fin.winRate,
        netProfitPercent: fin.netProfitPercent,
        profitFactor: fin.profitFactor,
        averageR: fin.averageR,
      };
    })
    .sort((a, b) => b.closedTrades - a.closedTrades || b.totalTrades - a.totalTrades);
}

export function calculateInstrumentBreakdown(trades: Trade[]): DimensionBreakdownRow[] {
  return calculateGroupBreakdown(trades, (t) => t.instrument || 'Unspecified');
}

export function calculateSetupBreakdown(trades: Trade[]): DimensionBreakdownRow[] {
  return calculateGroupBreakdown(trades, (t) => t.setupLabel?.trim() || 'Untagged Setup');
}

export function calculateDirectionBreakdown(trades: Trade[]): DimensionBreakdownRow[] {
  return calculateGroupBreakdown(trades, (t) =>
    t.direction === 'long' ? 'Long (Buy)' : 'Short (Sell)'
  );
}

export interface MistakeBreakdownRow {
  mistake: string;
  count: number;
  winRate: number | null;
  netProfitPercent: number;
}

export function calculateMistakesBreakdown(trades: Trade[]): MistakeBreakdownRow[] {
  const closed = trades.filter((t) => isActiveTrade(t) && t.status === 'closed');
  const map = new Map<string, Trade[]>();
  for (const t of closed) {
    for (const m of t.mistakes ?? []) {
      const clean = m.trim();
      if (!clean) continue;
      const list = map.get(clean) ?? [];
      list.push(t);
      map.set(clean, list);
    }
  }
  return Array.from(map.entries())
    .map(([mistake, items]) => {
      const fin = calculateFinancialMetrics(items);
      return {
        mistake,
        count: items.length,
        winRate: fin.winRate,
        netProfitPercent: fin.netProfitPercent,
      };
    })
    .sort((a, b) => b.count - a.count || a.netProfitPercent - b.netProfitPercent);
}

export type SessionOutcomeCategory =
  | 'traded'
  | 'attended_no_trade'
  | 'missed'
  | 'cancelled'
  | 'planned';

export interface CalendarDaySessionItem {
  session: TradingSession;
  outcome: SessionOutcomeCategory;
  tradeCount: number;
}

export interface CalendarDaySessionsSummary {
  items: CalendarDaySessionItem[];
  totalSessions: number;
  attendedCount: number;
  tradedCount: number;
  attendedNoTradeCount: number;
  missedCount: number;
  cancelledCount: number;
  plannedCount: number;
  inSessionTradeCount: number;
}

export interface SessionPeriodComparativeRow {
  key: string;
  label: string;
  startDate: string;
  endDate: string;
  tradingDays: number;
  totalSessions: number;
  attendedSessions: number;
  sessionsTraded: number;
  sessionsAttendedNoTrade: number;
  tradesInSessions: number;
  missedSessions: number;
  cancelledSessions: number;
  daysWithAttendedSession: number;
  weekdayDaysAttended: number;
  daysWithTradedSession: number;
  tradingDaysWithoutAttendance: number;
  tradingDayCoverageRate: number | null;
}

export interface SessionCoverageMetrics {
  startDate: string;
  endDate: string;
  tradingDays: number;
  totalSessions: number;
  attendedSessions: number;
  sessionsTraded: number;
  sessionsAttendedNoTrade: number;
  tradesInSessions: number;
  missedSessions: number;
  cancelledSessions: number;
  attendanceRate: number | null;
  daysWithAttendedSession: number;
  weekdayDaysAttended: number;
  daysWithTradedSession: number;
  tradingDaysWithoutAttendance: number;
  tradingDayCoverageRate: number | null;
  weeklyBreakdown: SessionPeriodComparativeRow[];
  monthlyBreakdown: SessionPeriodComparativeRow[];
}

function parseIsoDateUtc(dateStr: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (Number.isNaN(dt.getTime())) return null;
  return dt;
}

export function isTradingWeekday(dateStr: string): boolean {
  const dt = parseIsoDateUtc(dateStr);
  if (!dt) return false;
  const dow = dt.getUTCDay();
  return dow >= 1 && dow <= 5;
}

/**
 * Counts Monday–Friday trading weekdays inclusive (5 trading days per week standard).
 */
export function countTradingWeekdaysInRange(startDate: string, endDate: string): number {
  const start = parseIsoDateUtc(startDate);
  const end = parseIsoDateUtc(endDate);
  if (!start || !end || start.getTime() > end.getTime()) return 0;

  let count = 0;
  const cursor = new Date(start.getTime());
  while (cursor.getTime() <= end.getTime()) {
    const dow = cursor.getUTCDay();
    if (dow >= 1 && dow <= 5) {
      count += 1;
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return count;
}

/**
 * Returns Monday–Sunday week bounds for any YYYY-MM-DD date string.
 */
export function getWeekBoundsForDate(dateStr: string): {
  start: string;
  end: string;
  label: string;
} {
  const dt = parseIsoDateUtc(dateStr) ?? new Date();
  const mondayOffset = (dt.getUTCDay() + 6) % 7;
  const monday = new Date(dt.getTime());
  monday.setUTCDate(monday.getUTCDate() - mondayOffset);
  const sunday = new Date(monday.getTime());
  sunday.setUTCDate(sunday.getUTCDate() + 6);

  const start = monday.toISOString().slice(0, 10);
  const end = sunday.toISOString().slice(0, 10);

  const fmtShort = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
  const sameYear = monday.getUTCFullYear() === sunday.getUTCFullYear();
  const label = sameYear
    ? `${fmtShort.format(monday)} – ${fmtShort.format(sunday)}, ${sunday.getUTCFullYear()}`
    : `${fmtShort.format(monday)}, ${monday.getUTCFullYear()} – ${fmtShort.format(sunday)}, ${sunday.getUTCFullYear()}`;

  return { start, end, label };
}

/**
 * Returns 1st-of-month through exact last-day-of-month bounds for YYYY-MM.
 */
export function getMonthBoundsForYearMonth(yearMonth: string): {
  start: string;
  end: string;
  label: string;
} {
  const match = /^(\d{4})-(\d{2})$/.exec(yearMonth);
  const now = new Date();
  const year = match ? Number(match[1]) : now.getUTCFullYear();
  const month = match ? Number(match[2]) : now.getUTCMonth() + 1;
  const first = new Date(Date.UTC(year, month - 1, 1));
  const last = new Date(Date.UTC(year, month, 0));

  const start = first.toISOString().slice(0, 10);
  const end = last.toISOString().slice(0, 10);
  const label = new Intl.DateTimeFormat('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(first);

  return { start, end, label };
}

export function classifySessionOutcome(
  session: TradingSession,
  trades: Trade[]
): { outcome: SessionOutcomeCategory; tradeCount: number } {
  const linked = getSessionLinkedTrades(session.id, trades);
  const tradeCount = linked.length;

  const isCancelled = session.status === 'cancelled' || session.attendance === 'cancelled';
  if (isCancelled) {
    return { outcome: 'cancelled', tradeCount };
  }

  const isAttended =
    session.attendance === 'attended' ||
    session.status === 'live' ||
    session.status === 'completed';
  if (isAttended) {
    return {
      outcome: tradeCount > 0 ? 'traded' : 'attended_no_trade',
      tradeCount,
    };
  }

  const isMissed = session.attendance === 'missed' || session.status === 'missed';
  if (isMissed) {
    return { outcome: 'missed', tradeCount };
  }

  return { outcome: 'planned', tradeCount };
}

export function getCalendarDaySessionsSummary(
  date: string,
  sessions: TradingSession[],
  trades: Trade[]
): CalendarDaySessionsSummary {
  const daySessions = sessions
    .filter((s) => s.date === date)
    .sort((a, b) => (a.actualStartTime ?? a.scheduledStart ?? '').localeCompare(b.actualStartTime ?? b.scheduledStart ?? ''));

  const items: CalendarDaySessionItem[] = daySessions.map((session) => {
    const { outcome, tradeCount } = classifySessionOutcome(session, trades);
    return { session, outcome, tradeCount };
  });

  let tradedCount = 0;
  let attendedNoTradeCount = 0;
  let missedCount = 0;
  let cancelledCount = 0;
  let plannedCount = 0;
  let inSessionTradeCount = 0;

  for (const item of items) {
    inSessionTradeCount += item.tradeCount;
    if (item.outcome === 'traded') tradedCount += 1;
    else if (item.outcome === 'attended_no_trade') attendedNoTradeCount += 1;
    else if (item.outcome === 'missed') missedCount += 1;
    else if (item.outcome === 'cancelled') cancelledCount += 1;
    else plannedCount += 1;
  }

  return {
    items,
    totalSessions: items.length,
    attendedCount: tradedCount + attendedNoTradeCount,
    tradedCount,
    attendedNoTradeCount,
    missedCount,
    cancelledCount,
    plannedCount,
    inSessionTradeCount,
  };
}

function buildComparativeRow(params: {
  key: string;
  label: string;
  startDate: string;
  endDate: string;
  sessions: TradingSession[];
  tradesBySession: Map<string, Trade[]>;
}): SessionPeriodComparativeRow {
  const { key, label, startDate, endDate, sessions, tradesBySession } = params;
  const tradingDays =
    startDate && endDate ? countTradingWeekdaysInRange(startDate, endDate) : 0;

  let attendedSessions = 0;
  let sessionsTraded = 0;
  let sessionsAttendedNoTrade = 0;
  let tradesInSessions = 0;
  let missedSessions = 0;
  let cancelledSessions = 0;

  const attendedDates = new Set<string>();
  const weekdayAttendedDates = new Set<string>();
  const tradedDates = new Set<string>();

  for (const s of sessions) {
    const linked = tradesBySession.get(s.id) ?? [];
    const isCancelled = s.status === 'cancelled' || s.attendance === 'cancelled';
    const isAttended =
      !isCancelled &&
      (s.attendance === 'attended' || s.status === 'live' || s.status === 'completed');
    const isMissed =
      !isCancelled &&
      !isAttended &&
      (s.attendance === 'missed' || s.status === 'missed');

    if (isCancelled) {
      cancelledSessions += 1;
    } else if (isAttended) {
      attendedSessions += 1;
      attendedDates.add(s.date);
      if (isTradingWeekday(s.date)) {
        weekdayAttendedDates.add(s.date);
      }
      if (linked.length > 0) {
        sessionsTraded += 1;
        tradesInSessions += linked.length;
        tradedDates.add(s.date);
      } else {
        sessionsAttendedNoTrade += 1;
      }
    } else if (isMissed) {
      missedSessions += 1;
    }
  }

  const weekdayDaysAttended = weekdayAttendedDates.size;
  const tradingDaysWithoutAttendance = Math.max(0, tradingDays - weekdayDaysAttended);
  const tradingDayCoverageRate =
    tradingDays > 0
      ? Number(((weekdayDaysAttended / tradingDays) * 100).toFixed(1))
      : null;

  return {
    key,
    label,
    startDate,
    endDate,
    tradingDays,
    totalSessions: sessions.length,
    attendedSessions,
    sessionsTraded,
    sessionsAttendedNoTrade,
    tradesInSessions,
    missedSessions,
    cancelledSessions,
    daysWithAttendedSession: attendedDates.size,
    weekdayDaysAttended,
    daysWithTradedSession: tradedDates.size,
    tradingDaysWithoutAttendance,
    tradingDayCoverageRate,
  };
}

/**
 * Computes weekly, monthly, and period-level session execution & 5-day/week trading day
 * comparative analytics from canonical workspace sessions and trades.
 */
export function calculateSessionCoverageMetrics(params: {
  sessions: TradingSession[];
  trades: Trade[];
  startDate?: string;
  endDate?: string;
}): SessionCoverageMetrics {
  const { sessions, trades, startDate: explicitStart, endDate: explicitEnd } = params;
  const activeTrades = trades.filter(isActiveTrade);

  const bounds: DateRangeBounds = {
    start: explicitStart ?? '',
    end: explicitEnd ?? '',
  };
  const scopedSessions = sessions.filter((s) => isDateInRange(s.date, bounds));

  const tradesBySession = new Map<string, Trade[]>();
  for (const t of activeTrades) {
    if (!t.isOutOfSession && t.sessionId) {
      const list = tradesBySession.get(t.sessionId) ?? [];
      list.push(t);
      tradesBySession.set(t.sessionId, list);
    }
  }

  let effectiveStart = explicitStart ?? '';
  let effectiveEnd = explicitEnd ?? '';
  if (!effectiveStart || !effectiveEnd) {
    const dates = scopedSessions.map((s) => s.date).filter(Boolean).sort();
    if (dates.length > 0) {
      effectiveStart = effectiveStart || dates[0];
      effectiveEnd = effectiveEnd || dates[dates.length - 1];
    }
  }

  const overall = buildComparativeRow({
    key: 'overall',
    label: 'Selected Period',
    startDate: effectiveStart,
    endDate: effectiveEnd,
    sessions: scopedSessions,
    tradesBySession,
  });

  const trackableSessions = scopedSessions.length - overall.cancelledSessions;
  const attendanceRate =
    trackableSessions > 0
      ? Number(((overall.attendedSessions / trackableSessions) * 100).toFixed(1))
      : null;

  // Weekly grouping (Mon–Sun weeks)
  const weekBuckets = new Map<
    string,
    { start: string; end: string; label: string; sessions: TradingSession[] }
  >();

  // If bounded range <= 95 days, pre-populate every overlapping Mon–Sun week so empty weeks appear in comparative
  if (explicitStart && explicitEnd) {
    const sDt = parseIsoDateUtc(explicitStart);
    const eDt = parseIsoDateUtc(explicitEnd);
    if (sDt && eDt && sDt.getTime() <= eDt.getTime()) {
      const spanDays = Math.round((eDt.getTime() - sDt.getTime()) / 86400000);
      if (spanDays <= 95) {
        let cursor = getWeekBoundsForDate(explicitStart).start;
        while (cursor <= explicitEnd) {
          const wb = getWeekBoundsForDate(cursor);
          const clippedStart = wb.start < explicitStart ? explicitStart : wb.start;
          const clippedEnd = wb.end > explicitEnd ? explicitEnd : wb.end;
          weekBuckets.set(wb.start, {
            start: clippedStart,
            end: clippedEnd,
            label: wb.label,
            sessions: [],
          });
          cursor = shiftDateStr(wb.start, 7);
        }
      }
    }
  }

  for (const s of scopedSessions) {
    const wb = getWeekBoundsForDate(s.date);
    const existing = weekBuckets.get(wb.start);
    if (existing) {
      existing.sessions.push(s);
    } else {
      const clippedStart = explicitStart && wb.start < explicitStart ? explicitStart : wb.start;
      const clippedEnd = explicitEnd && wb.end > explicitEnd ? explicitEnd : wb.end;
      weekBuckets.set(wb.start, {
        start: clippedStart,
        end: clippedEnd,
        label: wb.label,
        sessions: [s],
      });
    }
  }

  const weeklyBreakdown = Array.from(weekBuckets.entries())
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([key, bucket]) =>
      buildComparativeRow({
        key,
        label: bucket.label,
        startDate: bucket.start,
        endDate: bucket.end,
        sessions: bucket.sessions,
        tradesBySession,
      })
    );

  // Monthly grouping (YYYY-MM)
  const monthBuckets = new Map<
    string,
    { start: string; end: string; label: string; sessions: TradingSession[] }
  >();

  if (explicitStart && explicitEnd && explicitStart <= explicitEnd) {
    let ym = explicitStart.slice(0, 7);
    const endYm = explicitEnd.slice(0, 7);
    let safety = 0;
    while (ym <= endYm && safety < 36) {
      const mb = getMonthBoundsForYearMonth(ym);
      const clippedStart = mb.start < explicitStart ? explicitStart : mb.start;
      const clippedEnd = mb.end > explicitEnd ? explicitEnd : mb.end;
      monthBuckets.set(ym, {
        start: clippedStart,
        end: clippedEnd,
        label: mb.label,
        sessions: [],
      });
      const [y, m] = ym.split('-').map(Number);
      ym = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
      safety += 1;
    }
  }

  for (const s of scopedSessions) {
    const ym = s.date.slice(0, 7);
    const existing = monthBuckets.get(ym);
    if (existing) {
      existing.sessions.push(s);
    } else {
      const mb = getMonthBoundsForYearMonth(ym);
      const clippedStart = explicitStart && mb.start < explicitStart ? explicitStart : mb.start;
      const clippedEnd = explicitEnd && mb.end > explicitEnd ? explicitEnd : mb.end;
      monthBuckets.set(ym, {
        start: clippedStart,
        end: clippedEnd,
        label: mb.label,
        sessions: [s],
      });
    }
  }

  const monthlyBreakdown = Array.from(monthBuckets.entries())
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([key, bucket]) =>
      buildComparativeRow({
        key,
        label: bucket.label,
        startDate: bucket.start,
        endDate: bucket.end,
        sessions: bucket.sessions,
        tradesBySession,
      })
    );

  return {
    startDate: effectiveStart,
    endDate: effectiveEnd,
    tradingDays: overall.tradingDays,
    totalSessions: overall.totalSessions,
    attendedSessions: overall.attendedSessions,
    sessionsTraded: overall.sessionsTraded,
    sessionsAttendedNoTrade: overall.sessionsAttendedNoTrade,
    tradesInSessions: overall.tradesInSessions,
    missedSessions: overall.missedSessions,
    cancelledSessions: overall.cancelledSessions,
    attendanceRate,
    daysWithAttendedSession: overall.daysWithAttendedSession,
    weekdayDaysAttended: overall.weekdayDaysAttended,
    daysWithTradedSession: overall.daysWithTradedSession,
    tradingDaysWithoutAttendance: overall.tradingDaysWithoutAttendance,
    tradingDayCoverageRate: overall.tradingDayCoverageRate,
    weeklyBreakdown,
    monthlyBreakdown,
  };
}



