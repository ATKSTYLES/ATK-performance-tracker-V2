import { describe, expect, it } from 'vitest';
import {
  buildAccountFilterOptions,
  calculateAccountBreakdown,
  calculateActivityMetrics,
  calculateDisciplineMetrics,
  calculateFinancialMetrics,
  calculatePsychologyMetrics,
  calculateSessionCoverageMetrics,
  classifySessionOutcome,
  computeDateRangeBounds,
  computeRealisedR,
  countTradingWeekdaysInRange,
  getCalendarDaySessionsSummary,
  getCalendarDayStatus,
  getMonthBoundsForYearMonth,
  getSessionLinkedTrades,
  getWeekBoundsForDate,
  groupCurrencyNetPnl,
  resolveNetPnl,
  scopeWorkspaceRecords,
  summarizeTradesForLedger,
} from '../calculations';
import { SCHEMA_VERSION } from '../enums';
import { DailyJournal, SessionEvent, Trade, TradingAccount, TradingSession } from '../types';

function makeAccount(overrides: Partial<TradingAccount> = {}): TradingAccount {
  return {
    id: 'acc_usd',
    userId: 'u1',
    schemaVersion: SCHEMA_VERSION,
    name: 'Fortress USD',
    broker: 'FTMO',
    accountType: 'funded',
    capital: 100000,
    currency: 'USD',
    defaultRiskPercent: 1,
    isActive: true,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeSession(overrides: Partial<TradingSession> = {}): TradingSession {
  return {
    id: 'ses_1',
    userId: 'u1',
    schemaVersion: SCHEMA_VERSION,
    date: '2026-11-10',
    timezone: 'Asia/Kolkata',
    sessionName: 'London',
    scheduledStart: '12:30',
    scheduledEnd: '15:30',
    status: 'completed',
    attendance: 'attended',
    sittingLocation: 'trading_desk',
    preSessionEmotion: 'Calm',
    sessionBias: 'bullish',
    checklistItems: [],
    actualStartTime: '2026-11-10T07:05:00.000Z',
    actualEndTime: '2026-11-10T10:00:00.000Z',
    setupAvailability: 'available',
    planAdherence: 'yes',
    createdAt: '2026-11-10T07:05:00.000Z',
    updatedAt: '2026-11-10T10:00:00.000Z',
    ...overrides,
  };
}

function makeTrade(overrides: Partial<Trade> = {}): Trade {
  return {
    id: 'tr_1',
    userId: 'u1',
    schemaVersion: SCHEMA_VERSION,
    date: '2026-11-10',
    timezone: 'Asia/Kolkata',
    tradeNumberOfDay: 1,
    accountId: 'acc_usd',
    accountName: 'Fortress USD',
    sessionId: 'ses_1',
    sessionName: 'London',
    isOutOfSession: false,
    instrument: 'XAUUSD',
    direction: 'long',
    status: 'closed',
    riskPercent: 1,
    expectedProfitPercent: 2,
    actualProfitPercent: 2,
    preTradeEmotion: 'Focused',
    confidence: 8,
    openedAt: '2026-11-10T07:30:00.000Z',
    closedAt: '2026-11-10T08:30:00.000Z',
    exitOutcome: 'win',
    exitReason: 'take_profit',
    tpStatus: 'hit_full',
    slStatus: 'untouched',
    followedPlan: 'yes',
    followedRiskRules: 'yes',
    impulsiveEntry: 'no',
    exitedPerPlan: 'yes',
    postTradeEmotion: 'Calm',
    mistakes: [],
    currency: 'USD',
    netPnl: 200,
    createdAt: '2026-11-10T07:30:00.000Z',
    updatedAt: '2026-11-10T08:30:00.000Z',
    ...overrides,
  };
}

describe('Platform-Wide Data Integrity & Relationship Regression Suite', () => {
  it('handles zero values without NaN, Infinity, or dropped zero P&L', () => {
    expect(resolveNetPnl(0, 0, 0, undefined)).toBe(0);
    expect(resolveNetPnl(150, 12.5, 2.5, undefined)).toBe(135);
    expect(resolveNetPnl(150, 12.5, 2.5, 0)).toBe(0);
    expect(resolveNetPnl(undefined, 10, 5, undefined)).toBeUndefined();

    const zeroRiskTrade = makeTrade({
      id: 'tr_zero',
      riskPercent: 0,
      actualProfitPercent: 0,
      exitOutcome: 'breakeven',
      netPnl: 0,
      realisedR: undefined,
    });
    expect(computeRealisedR(zeroRiskTrade)).toBeNull();

    const fin = calculateFinancialMetrics([zeroRiskTrade]);
    expect(fin.closedTradesCount).toBe(1);
    expect(fin.breakevenCount).toBe(1);
    expect(fin.winRate).toBe(0);
    expect(fin.profitFactor).toBeNull();
    expect(fin.netProfitPercent).toBe(0);
    expect(fin.netMonetaryPnl).toBe(0);
    expect(fin.monetarySampleSize).toBe(1);

    const dayStatus = getCalendarDayStatus('2026-11-10', [], [], [zeroRiskTrade]);
    expect(dayStatus.status).toBe('breakeven');
    expect(dayStatus.netProfitPercent).toBe(0);
    expect(dayStatus.netMonetaryPnl).toBe(0);
  });

  it('handles missing optional fields and legacy undefined/null strings without throwing', () => {
    const sparseTrade = makeTrade({
      id: 'tr_sparse',
      sessionId: undefined,
      sessionName: undefined,
      isOutOfSession: true,
      netPnl: undefined,
      realisedR: undefined,
      postTradeEmotion: undefined,
      preTradeEmotion: '' as string,
      mistakes: undefined as unknown as string[],
    });

    const fin = calculateFinancialMetrics([sparseTrade]);
    expect(fin.netMonetaryPnl).toBeNull();
    expect(fin.averageR).toBe(2);

    const psych = calculatePsychologyMetrics([sparseTrade]);
    expect(psych.focusedVsDistracted.focused.count).toBe(0);
    expect(psych.postExitEmotions).toHaveLength(0);
  });

  it('prevents multi-currency mixing and preserves historical deleted accounts in filter options & breakdowns', () => {
    const usdAcc = makeAccount({ id: 'acc_usd', name: 'Fortress', currency: 'USD' });
    const inrAcc = makeAccount({ id: 'acc_inr', name: 'Dhan INR', currency: 'INR' });

    const trades: Trade[] = [
      makeTrade({ id: 'tr_u1', accountId: 'acc_usd', accountName: 'Fortress', currency: 'USD', netPnl: 500, actualProfitPercent: 2 }),
      makeTrade({ id: 'tr_i1', accountId: 'acc_inr', accountName: 'Dhan INR', currency: 'INR', netPnl: 12000, actualProfitPercent: 1.5 }),
      // Trade on a removed/historical account
      makeTrade({ id: 'tr_hist', accountId: 'acc_old', accountName: 'Old Prop', currency: 'EUR', netPnl: -100, actualProfitPercent: -1, exitOutcome: 'loss' }),
    ];

    const currencyTotals = groupCurrencyNetPnl(trades, [usdAcc, inrAcc], 'USD');
    expect(currencyTotals).toEqual([
      { currency: 'EUR', netPnl: -100, tradeCount: 1 },
      { currency: 'INR', netPnl: 12000, tradeCount: 1 },
      { currency: 'USD', netPnl: 500, tradeCount: 1 },
    ]);

    const ledgerSummary = summarizeTradesForLedger(trades, [usdAcc, inrAcc], 'USD');
    expect(ledgerSummary.hasMixedCurrencies).toBe(true);
    expect(ledgerSummary.singleCurrencyNetPnl).toBeNull();

    // Filter options include both current accounts and historical removed account
    const filterOptions = buildAccountFilterOptions([usdAcc, inrAcc], trades);
    expect(filterOptions.map((o) => o.value)).toEqual(['all', 'acc_usd', 'acc_inr', 'acc_old']);
    expect(filterOptions[3].label).toContain('Old Prop');
    expect(filterOptions[3].label).toContain('Historical');

    // Account breakdown refuses to sum mixed currencies if one account somehow has EUR and USD trades
    const mixedSingleAccount = [
      makeTrade({ id: 'tr_m1', accountId: 'acc_usd', currency: 'USD', netPnl: 100 }),
      makeTrade({ id: 'tr_m2', accountId: 'acc_usd', currency: 'EUR', netPnl: 100 }),
    ];
    const breakdown = calculateAccountBreakdown(mixedSingleAccount, [usdAcc], 'USD');
    expect(breakdown[0].netMonetaryPnl).toBeNull();
  });

  it('does NOT falsely flag simultaneous linked multi-account losing siblings as tradesAfterLoss', () => {
    const trades: Trade[] = [
      // Linked losing trade across 2 accounts opened at the exact same timestamp
      makeTrade({
        id: 'tr_grp_loss_1',
        tradeGroupId: 'tg_loss',
        accountId: 'acc_a',
        tradeNumberOfDay: 1,
        openedAt: '2026-11-10T07:30:00.000Z',
        closedAt: '2026-11-10T08:00:00.000Z',
        exitOutcome: 'loss',
        actualProfitPercent: -1,
      }),
      makeTrade({
        id: 'tr_grp_loss_2',
        tradeGroupId: 'tg_loss',
        accountId: 'acc_b',
        tradeNumberOfDay: 2,
        openedAt: '2026-11-10T07:30:00.000Z',
        closedAt: '2026-11-10T08:00:00.000Z',
        exitOutcome: 'loss',
        actualProfitPercent: -2,
      }),
      // Subsequent independent trade taken AFTER the linked loss
      makeTrade({
        id: 'tr_next_after_loss',
        tradeGroupId: undefined,
        accountId: 'acc_a',
        tradeNumberOfDay: 3,
        openedAt: '2026-11-10T09:00:00.000Z',
        closedAt: '2026-11-10T09:45:00.000Z',
        exitOutcome: 'win',
        actualProfitPercent: 3,
      }),
    ];

    const psych = calculatePsychologyMetrics(trades);
    expect(psych.tradesAfterLoss.count).toBe(1);
    expect(psych.tradesAfterLoss.winRate).toBe(100);
    expect(psych.tradesAfterLoss.netProfitPercent).toBe(3);
  });

  it('reconciles sessions, out-of-session trades, soft-deletes, restores, and cross-page metrics identically', () => {
    const accounts = [makeAccount()];
    const sessions: TradingSession[] = [
      makeSession({ id: 'ses_london', sessionName: 'London' }),
      makeSession({ id: 'ses_ny_zero', sessionName: 'New York' }), // Attended with 0 trades
    ];
    const journals: DailyJournal[] = [];

    const tIn = makeTrade({
      id: 'tr_in',
      sessionId: 'ses_london',
      sessionName: 'London',
      isOutOfSession: false,
      actualProfitPercent: 2,
      netPnl: 200,
      exitOutcome: 'win',
    });
    const tOos = makeTrade({
      id: 'tr_oos',
      sessionId: undefined,
      sessionName: undefined,
      isOutOfSession: true,
      actualProfitPercent: -1,
      netPnl: -100,
      exitOutcome: 'loss',
    });
    const tDeleted = makeTrade({
      id: 'tr_del',
      sessionId: 'ses_london',
      sessionName: 'London',
      isOutOfSession: false,
      actualProfitPercent: 10,
      netPnl: 1000,
      exitOutcome: 'win',
      isDeleted: true,
    });

    const allWithDeleted = [tIn, tOos, tDeleted];

    const fin = calculateFinancialMetrics(allWithDeleted);
    const ledger = summarizeTradesForLedger(allWithDeleted, accounts, 'USD');
    const act = calculateActivityMetrics(sessions, allWithDeleted);
    const cal = getCalendarDayStatus('2026-11-10', journals, sessions, allWithDeleted);
    const accRows = calculateAccountBreakdown(allWithDeleted, accounts, 'USD');

    // Soft-deleted trade excluded everywhere
    expect(fin.totalTrades).toBe(2);
    expect(ledger.totalTrades).toBe(2);
    expect(cal.tradeCount).toBe(2);
    expect(accRows[0].totalTrades).toBe(2);

    // Cross-page financial parity
    expect(fin.netProfitPercent).toBe(1);
    expect(ledger.netProfitPercent).toBe(1);
    expect(cal.netProfitPercent).toBe(1);
    expect(accRows[0].netProfitPercent).toBe(1);

    expect(fin.netMonetaryPnl).toBe(100);
    expect(ledger.singleCurrencyNetPnl?.netPnl).toBe(100);
    expect(cal.netMonetaryPnl).toBe(100);
    expect(accRows[0].netMonetaryPnl).toBe(100);

    // Session activity accuracy
    expect(act.inSessionTrades).toBe(1);
    expect(act.outOfSessionTrades).toBe(1);
    expect(act.zeroTradeSessions).toBe(1);
    expect(act.sessionBreakdown.find((s) => s.sessionName === 'London')?.tradeCount).toBe(1);
    expect(act.sessionBreakdown.find((s) => s.sessionName === 'London')?.winRate).toBe(100);

    // Restoring tDeleted immediately reflects everywhere
    const restored = [tIn, tOos, { ...tDeleted, isDeleted: false }];
    expect(calculateFinancialMetrics(restored).netProfitPercent).toBe(11);
    expect(summarizeTradesForLedger(restored, accounts, 'USD').singleCurrencyNetPnl?.netPnl).toBe(1100);
    expect(getCalendarDayStatus('2026-11-10', journals, sessions, restored).tradeCount).toBe(3);
  });

  it('keeps Dashboard, Analytics, and Daily/Session Records strictly synchronized across date scopes, open/closed trades, and session events', () => {
    const sessions: TradingSession[] = [
      makeSession({ id: 'ses_old', date: '2026-09-01', sessionName: 'London', status: 'completed', attendance: 'attended' }),
      makeSession({ id: 'ses_today', date: '2026-11-19', sessionName: 'London', status: 'live', attendance: 'attended' }),
      makeSession({ id: 'ses_cancelled', date: '2026-11-19', sessionName: 'Asian', status: 'cancelled', attendance: 'attended' }),
    ];

    const trades: Trade[] = [
      makeTrade({
        id: 'tr_old_win',
        date: '2026-09-01',
        sessionId: 'ses_old',
        sessionName: 'London',
        isOutOfSession: false,
        status: 'closed',
        exitOutcome: 'win',
        actualProfitPercent: 4,
      }),
      makeTrade({
        id: 'tr_today_open',
        date: '2026-11-19',
        sessionId: 'ses_today',
        sessionName: 'London',
        isOutOfSession: false,
        status: 'during_trade',
        exitOutcome: 'pending',
        actualProfitPercent: undefined,
      }),
      makeTrade({
        id: 'tr_today_oos',
        date: '2026-11-19',
        sessionId: undefined,
        sessionName: undefined,
        isOutOfSession: true,
        status: 'closed',
        exitOutcome: 'loss',
        actualProfitPercent: -1,
      }),
    ];

    const sessionEvents: SessionEvent[] = [
      {
        id: 'se_gc',
        userId: 'u1',
        schemaVersion: SCHEMA_VERSION,
        sessionId: 'ses_today',
        date: '2026-11-19',
        eventType: 'guard_cancelled',
        description: 'Cancelled guard',
        timestamp: '2026-11-19T08:00:00.000Z',
        createdAt: '2026-11-19T08:00:00.000Z',
        updatedAt: '2026-11-19T08:00:00.000Z',
      },
      {
        id: 'se_sb',
        userId: 'u1',
        schemaVersion: SCHEMA_VERSION,
        sessionId: 'ses_today',
        date: '2026-11-19',
        eventType: 'stepped_back',
        description: 'Stepped back',
        timestamp: '2026-11-19T08:00:01.000Z',
        createdAt: '2026-11-19T08:00:01.000Z',
        updatedAt: '2026-11-19T08:00:01.000Z',
      },
    ];

    // All-dates default matches Records (All Dates) including sessions older than 30 days
    const allBounds = computeDateRangeBounds('all', '2026-11-19', '', '');
    const allScoped = scopeWorkspaceRecords({
      sessions,
      sessionEvents,
      trades,
      dailyJournals: [],
      bounds: allBounds,
      accountId: 'all',
    });
    expect(allScoped.rangeSessions).toHaveLength(3);
    expect(allScoped.rangeTrades).toHaveLength(3);

    const allAct = calculateActivityMetrics(allScoped.rangeSessions, allScoped.rangeTrades);
    // Cancelled session is mutually exclusive from attended
    expect(allAct.totalSessions).toBe(3);
    expect(allAct.attendedSessions).toBe(2);
    expect(allAct.cancelledSessions).toBe(1);
    expect(allAct.missedSessions).toBe(0);
    expect(allAct.inSessionTrades).toBe(2);
    expect(allAct.outOfSessionTrades).toBe(1);

    // Session breakdown trade counts reconcile with RecordsPage linkage and include closedTradeCount
    const londonRow = allAct.sessionBreakdown.find((r) => r.sessionName === 'London');
    expect(londonRow?.sessionCount).toBe(2);
    expect(londonRow?.tradeCount).toBe(2);
    expect(londonRow?.closedTradeCount).toBe(1);
    expect(getSessionLinkedTrades('ses_today', allScoped.accountScopedTrades)).toHaveLength(1);

    // Today scope matches Records (Selected Date = today)
    const todayBounds = computeDateRangeBounds('today', '2026-11-19', '', '');
    const todayScoped = scopeWorkspaceRecords({
      sessions,
      sessionEvents,
      trades,
      dailyJournals: [],
      bounds: todayBounds,
      accountId: 'all',
    });
    expect(todayScoped.rangeSessions).toHaveLength(2);
    expect(todayScoped.rangeTrades).toHaveLength(2);

    // Paired guard_cancelled + stepped_back counts as 1 stepped-back decision
    const disc = calculateDisciplineMetrics(todayScoped.rangeTrades, todayScoped.rangeSessionEvents, []);
    expect(disc.steppedBackCount).toBe(1);
  });

  it('computes 5-day trading week bounds, weekly/monthly session comparatives, and calendar per-session marks accurately', () => {
    // Mon–Sun week has exactly 5 Mon–Fri trading days
    const weekBounds = getWeekBoundsForDate('2026-11-19'); // Thursday
    expect(weekBounds.start).toBe('2026-11-16'); // Monday
    expect(weekBounds.end).toBe('2026-11-22'); // Sunday
    expect(countTradingWeekdaysInRange(weekBounds.start, weekBounds.end)).toBe(5);

    // Month bounds handle exact last day & Mon–Fri count (Nov 2026: 30 days, 21 weekdays; Feb 2024 leap year: 29 days, 21 weekdays)
    const novBounds = getMonthBoundsForYearMonth('2026-11');
    expect(novBounds.start).toBe('2026-11-01');
    expect(novBounds.end).toBe('2026-11-30');
    expect(countTradingWeekdaysInRange(novBounds.start, novBounds.end)).toBe(21);

    const febLeap = getMonthBoundsForYearMonth('2024-02');
    expect(febLeap.end).toBe('2024-02-29');
    expect(countTradingWeekdaysInRange(febLeap.start, febLeap.end)).toBe(21);

    // Build realistic multi-session week:
    // Mon 2026-11-16: London traded (2 trades), NY attended (0 trades)
    // Tue 2026-11-17: London missed
    // Wed 2026-11-18: London traded (1 trade)
    // Sat 2026-11-21: Weekend review session attended (0 trades) — should NOT inflate Mon–Fri coverage above 5
    const sessions: TradingSession[] = [
      makeSession({ id: 's_mon_ldn', date: '2026-11-16', sessionName: 'London', status: 'completed', attendance: 'attended' }),
      makeSession({ id: 's_mon_ny', date: '2026-11-16', sessionName: 'New York', status: 'completed', attendance: 'attended' }),
      makeSession({ id: 's_tue_ldn', date: '2026-11-17', sessionName: 'London', status: 'missed', attendance: 'missed' }),
      makeSession({ id: 's_wed_ldn', date: '2026-11-18', sessionName: 'London', status: 'completed', attendance: 'attended' }),
      makeSession({ id: 's_sat_rev', date: '2026-11-21', sessionName: 'Weekend', status: 'completed', attendance: 'attended' }),
    ];

    const trades: Trade[] = [
      makeTrade({ id: 't1', date: '2026-11-16', sessionId: 's_mon_ldn', isOutOfSession: false }),
      makeTrade({ id: 't2', date: '2026-11-16', sessionId: 's_mon_ldn', isOutOfSession: false }),
      makeTrade({ id: 't3', date: '2026-11-18', sessionId: 's_wed_ldn', isOutOfSession: false }),
      // Out-of-session and deleted trades must not count toward session traded classification
      makeTrade({ id: 't_oos', date: '2026-11-16', sessionId: 's_mon_ny', isOutOfSession: true }),
      makeTrade({ id: 't_del', date: '2026-11-16', sessionId: 's_mon_ny', isOutOfSession: false, isDeleted: true }),
    ];

    // Per-session classification & calendar day summary
    expect(classifySessionOutcome(sessions[0], trades)).toEqual({ outcome: 'traded', tradeCount: 2 });
    expect(classifySessionOutcome(sessions[1], trades)).toEqual({ outcome: 'attended_no_trade', tradeCount: 0 });
    expect(classifySessionOutcome(sessions[2], trades)).toEqual({ outcome: 'missed', tradeCount: 0 });

    const monSummary = getCalendarDaySessionsSummary('2026-11-16', sessions, trades);
    expect(monSummary.totalSessions).toBe(2);
    expect(monSummary.tradedCount).toBe(1);
    expect(monSummary.attendedNoTradeCount).toBe(1);
    expect(monSummary.missedCount).toBe(0);
    expect(monSummary.inSessionTradeCount).toBe(2);

    const tueSummary = getCalendarDaySessionsSummary('2026-11-17', sessions, trades);
    expect(tueSummary.missedCount).toBe(1);
    expect(tueSummary.tradedCount).toBe(0);

    // Weekly coverage comparative (5 trading days/week)
    const weeklyCoverage = calculateSessionCoverageMetrics({
      sessions,
      trades,
      startDate: weekBounds.start,
      endDate: weekBounds.end,
    });
    expect(weeklyCoverage.tradingDays).toBe(5);
    expect(weeklyCoverage.totalSessions).toBe(5);
    expect(weeklyCoverage.attendedSessions).toBe(4);
    expect(weeklyCoverage.sessionsTraded).toBe(2);
    expect(weeklyCoverage.sessionsAttendedNoTrade).toBe(2);
    expect(weeklyCoverage.tradesInSessions).toBe(3);
    expect(weeklyCoverage.missedSessions).toBe(1);
    expect(weeklyCoverage.attendanceRate).toBe(80);
    // Attended on Mon, Wed (2 weekdays) + Sat (1 weekend) -> 3 total days attended, 2/5 weekdays = 40%
    expect(weeklyCoverage.daysWithAttendedSession).toBe(3);
    expect(weeklyCoverage.weekdayDaysAttended).toBe(2);
    expect(weeklyCoverage.tradingDaysWithoutAttendance).toBe(3);
    expect(weeklyCoverage.tradingDayCoverageRate).toBe(40);
    expect(weeklyCoverage.weeklyBreakdown).toHaveLength(1);
    expect(weeklyCoverage.monthlyBreakdown).toHaveLength(1);

    // Monthly coverage comparative (Nov 2026 = 21 Mon–Fri trading days)
    const monthlyCoverage = calculateSessionCoverageMetrics({
      sessions,
      trades,
      startDate: novBounds.start,
      endDate: novBounds.end,
    });
    expect(monthlyCoverage.tradingDays).toBe(21);
    expect(monthlyCoverage.weekdayDaysAttended).toBe(2);
    expect(monthlyCoverage.tradingDaysWithoutAttendance).toBe(19);
    expect(monthlyCoverage.weeklyBreakdown.length).toBeGreaterThanOrEqual(5);
  });
});

