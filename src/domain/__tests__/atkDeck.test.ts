import { describe, expect, it } from 'vitest';
import {
  calculateAccountBreakdown,
  calculateActivityMetrics,
  calculateDisciplineMetrics,
  calculateFinancialMetrics,
  calculateInstrumentBreakdown,
  calculateMistakesBreakdown,
  calculatePsychologyMetrics,
  getCalendarDayStatus,
  groupCurrencyNetPnl,
  summarizeTradesForLedger,
} from '../calculations';
import { DEFAULT_SESSION_TEMPLATES, SCHEMA_VERSION } from '../enums';
import { classifyErrorCategory } from '../errors';
import {
  buildMondayCalendarGrid,
  checkTemplatesOverlap,
  detectCurrentSessionTemplate,
  formatTime12Hour,
  formatTimestampInTimezone,
  parse12HourTo24Hour,
  split24HourTo12Hour,
} from '../timezone';
import {
  DailyJournal,
  SessionEvent,
  SessionTemplate,
  Trade,
  TradingAccount,
  TradingSession,
} from '../types';
import {
  buildTradeGroupVisualMap,
  computeDefaultExpectedProfit,
  filterTrades,
  validateTradeClosure,
  validateTradeCreation,
} from '../validation';

function makeTrade(overrides: Partial<Trade> = {}): Trade {
  return {
    id: 'tr_1',
    userId: 'u1',
    schemaVersion: SCHEMA_VERSION,
    createdAt: '2026-11-17T06:00:00.000Z',
    updatedAt: '2026-11-17T06:00:00.000Z',
    date: '2026-11-17',
    timezone: 'Asia/Kolkata',
    tradeNumberOfDay: 1,
    accountId: 'acc_1',
    accountName: 'Primary',
    isOutOfSession: false,
    sessionId: 'ses_1',
    sessionName: 'London',
    instrument: 'XAUUSD',
    direction: 'long',
    status: 'closed',
    riskPercent: 1,
    expectedProfitPercent: 2,
    actualProfitPercent: 2,
    preTradeEmotion: 'Calm',
    confidence: 8,
    openedAt: '2026-11-17T06:00:00.000Z',
    closedAt: '2026-11-17T07:00:00.000Z',
    exitOutcome: 'win',
    exitReason: 'take_profit',
    tpStatus: 'hit_full',
    slStatus: 'untouched',
    followedPlan: 'yes',
    followedRiskRules: 'yes',
    impulsiveEntry: 'no',
    exitedPerPlan: 'yes',
    postTradeEmotion: 'Calm & Focused',
    mistakes: [],
    ...overrides,
  };
}

describe('ATK Deck V2 Domain & Calculation Suite', () => {
  it('excludes open trades from closed statistics and returns null Profit Factor when no losing trades exist', () => {
    const trades: Trade[] = [
      makeTrade({ id: 't1', exitOutcome: 'win', actualProfitPercent: 3 }),
      makeTrade({ id: 't2', status: 'during_trade', exitOutcome: 'pending', actualProfitPercent: undefined }),
    ];
    const fin = calculateFinancialMetrics(trades);
    expect(fin.openTradesCount).toBe(1);
    expect(fin.closedTradesCount).toBe(1);
    expect(fin.winRate).toBe(100);
    expect(fin.hasLosingTrades).toBe(false);
    expect(fin.profitFactor).toBeNull();
    expect(fin.netMonetaryPnl).toBeNull();
  });

  it('computes Win Rate, Profit Factor, Drawdown, Streaks, and Realised R accurately', () => {
    const trades: Trade[] = [
      makeTrade({ id: 't1', exitOutcome: 'win', actualProfitPercent: 4, riskPercent: 1 }),
      makeTrade({ id: 't2', exitOutcome: 'loss', actualProfitPercent: -1, riskPercent: 1, closedAt: '2026-11-17T08:00:00.000Z' }),
      makeTrade({ id: 't3', exitOutcome: 'loss', actualProfitPercent: -1, riskPercent: 1, closedAt: '2026-11-17T09:00:00.000Z' }),
      makeTrade({ id: 't4', exitOutcome: 'win', actualProfitPercent: 2, riskPercent: 1, closedAt: '2026-11-17T10:00:00.000Z' }),
    ];
    const fin = calculateFinancialMetrics(trades);
    expect(fin.winRate).toBe(50);
    expect(fin.profitFactor).toBe(3); // 6 / 2
    expect(fin.netProfitPercent).toBe(4);
    expect(fin.maxDrawdownPercent).toBe(2);
    expect(fin.maxWinningStreak).toBe(1);
    expect(fin.maxLosingStreak).toBe(2);
    expect(fin.averageR).toBe(1); // (4 - 1 - 1 + 2)/4
  });

  it('supports percentage values above 100 without artificial clamping', () => {
    const check = validateTradeCreation({
      accountId: 'acc_1',
      instrument: 'BTCUSD',
      direction: 'long',
      riskPercent: 1,
      expectedProfitPercent: 150,
      preTradeEmotion: 'Focused',
      confidence: 8,
      isOutOfSession: true,
    });
    expect(check.valid).toBe(true);
  });

  it('detects half-open [start, end) session templates without boundary overlaps', () => {
    const templates: SessionTemplate[] = DEFAULT_SESSION_TEMPLATES.map((t) => ({
      ...t,
      userId: 'u1',
      schemaVersion: SCHEMA_VERSION,
      createdAt: '',
      updatedAt: '',
    }));
    expect(detectCurrentSessionTemplate(templates, 'Asia/Kolkata', '05:30')?.name).toBe('Asian');
    expect(detectCurrentSessionTemplate(templates, 'Asia/Kolkata', '11:30')?.name).toBe('London');
    expect(detectCurrentSessionTemplate(templates, 'Asia/Kolkata', '17:30')?.name).toBe('New York');
    expect(detectCurrentSessionTemplate(templates, 'Asia/Kolkata', '22:30')).toBeNull();
    expect(checkTemplatesOverlap(templates)).toBeNull();
  });

  it('builds Monday-start calendar grids and evaluates day statuses accurately', () => {
    const grid = buildMondayCalendarGrid('2026-11');
    // Nov 1, 2026 is a Sunday -> Monday start offset is 6 preceding days (Oct 26..Oct 31)
    expect(grid[0].date).toBe('2026-10-26');
    expect(grid.length % 7).toBe(0);

    const sessions: TradingSession[] = [
      {
        id: 's1',
        userId: 'u1',
        schemaVersion: 2,
        createdAt: '',
        updatedAt: '',
        date: '2026-11-10',
        timezone: 'Asia/Kolkata',
        sessionName: 'London',
        status: 'completed',
        attendance: 'attended',
        sittingLocation: 'home',
        preSessionEmotion: 'Calm',
        sessionBias: 'neutral',
        checklistItems: [],
      },
    ];
    const dayZero = getCalendarDayStatus('2026-11-10', [], sessions, []);
    expect(dayZero.status).toBe('attended_zero_trades');
  });

  it('computes Discipline 2x2 matrix and Psychology correlations without inferring missing values', () => {
    const trades = [
      makeTrade({ id: 't1', preTradeEmotion: 'Calm', followedPlan: 'yes', followedRiskRules: 'yes', impulsiveEntry: 'no', exitOutcome: 'win' }),
      makeTrade({ id: 't2', preTradeEmotion: 'Anxious', followedPlan: 'no', followedRiskRules: 'no', impulsiveEntry: 'yes', exitOutcome: 'loss', actualProfitPercent: -1, openedAt: '2026-11-17T08:00:00.000Z' }),
    ];
    const events: SessionEvent[] = [
      {
        id: 'se1',
        userId: 'u1',
        schemaVersion: 2,
        createdAt: '',
        updatedAt: '',
        sessionId: 's1',
        date: '2026-11-17',
        eventType: 'stepped_back',
        description: 'Stepped back',
        timestamp: '2026-11-17T08:30:00.000Z',
      },
    ];
    const journals: DailyJournal[] = [];
    const disc = calculateDisciplineMetrics(trades, events, journals);
    expect(disc.processOutcomeMatrix.goodProcessGoodOutcome).toBe(1);
    expect(disc.processOutcomeMatrix.badProcessBadOutcome).toBe(1);
    expect(disc.steppedBackCount).toBe(1);

    const psych = calculatePsychologyMetrics(trades);
    expect(psych.calmVsAnxious.calm.count).toBe(1);
    expect(psych.calmVsAnxious.anxious.count).toBe(1);
    expect(psych.tradesAfterLoss.count).toBe(0);
  });

  it('validates trade closure fields and classifies Firebase error categories accurately', () => {
    const closureValid = validateTradeClosure({
      exitOutcome: 'win',
      exitReason: 'take_profit',
      tpStatus: 'hit_full',
      slStatus: 'untouched',
      actualProfitPercent: 2.5,
      followedPlan: 'yes',
      followedRiskRules: 'yes',
      impulsiveEntry: 'no',
      exitedPerPlan: 'yes',
      postTradeEmotion: 'Calm & Focused',
    });
    expect(closureValid.valid).toBe(true);

    expect(classifyErrorCategory(new Error('firestore/unavailable network offline'))).toBe('network');
    expect(classifyErrorCategory(new Error('Missing or insufficient permissions'))).toBe('permission');
  });

  it('persists sync queue operations across attempts, increments retry counts, and preserves attempt history', async () => {
    const store = new Map<string, string>();
    (globalThis as unknown as { localStorage: Storage }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
      clear: () => store.clear(),
      key: (i: number) => Array.from(store.keys())[i] ?? null,
      get length() {
        return store.size;
      },
    };

    const {
      getPendingOperations,
      markOperationSynced,
      recordPendingAttempt,
      removePendingOperation,
    } = await import('../../storage/syncQueue');

    recordPendingAttempt({
      operationId: 'op_stable_1',
      userId: 'u_test',
      recordId: 'tr_1',
      operationType: 'close_trade_atomic',
      payloadVersion: 2,
      payload: { exitOutcome: 'win', actualProfitPercent: 2 },
      attempt: { timestamp: '2026-11-17T01:00:00.000Z', errorCode: 'unavailable', errorMessage: 'Offline' },
      status: 'Failed',
    });

    recordPendingAttempt({
      operationId: 'op_stable_1',
      userId: 'u_test',
      recordId: 'tr_1',
      operationType: 'close_trade_atomic',
      payloadVersion: 2,
      payload: { exitOutcome: 'win', actualProfitPercent: 2 },
      attempt: { timestamp: '2026-11-17T01:05:00.000Z', errorCode: 'unavailable', errorMessage: 'Still offline' },
      status: 'Failed',
    });

    const ops = getPendingOperations('u_test');
    expect(ops).toHaveLength(1);
    expect(ops[0].retryCount).toBe(2);
    expect(ops[0].attemptHistory).toHaveLength(2);
    expect(ops[0].createdAt).toBe('2026-11-17T01:00:00.000Z');
    expect(ops[0].updatedAt).toBe('2026-11-17T01:05:00.000Z');

    markOperationSynced('u_test', 'op_stable_1');
    expect(getPendingOperations('u_test')[0].status).toBe('Synced');

    removePendingOperation('u_test', 'op_stable_1');
    expect(getPendingOperations('u_test')).toHaveLength(0);
  });

  it('formats timestamps and template windows in 12-hour AM/PM and converts cleanly with 24-hour storage strings', () => {
    expect(formatTime12Hour('00:00')).toBe('12:00 AM');
    expect(formatTime12Hour('05:30')).toBe('5:30 AM');
    expect(formatTime12Hour('12:00')).toBe('12:00 PM');
    expect(formatTime12Hour('17:30')).toBe('5:30 PM');
    expect(formatTime12Hour('22:30')).toBe('10:30 PM');

    expect(split24HourTo12Hour('00:05')).toEqual({ hour12: 12, minute: 5, period: 'AM' });
    expect(split24HourTo12Hour('12:45')).toEqual({ hour12: 12, minute: 45, period: 'PM' });
    expect(split24HourTo12Hour('17:30')).toEqual({ hour12: 5, minute: 30, period: 'PM' });

    expect(parse12HourTo24Hour(12, 0, 'AM')).toBe('00:00');
    expect(parse12HourTo24Hour(12, 30, 'PM')).toBe('12:30');
    expect(parse12HourTo24Hour(5, 30, 'PM')).toBe('17:30');
    expect(parse12HourTo24Hour(9, 15, 'AM')).toBe('09:15');

    const formattedUtc = formatTimestampInTimezone('2026-11-17T14:05:09.000Z', 'UTC');
    expect(formattedUtc).toContain('2:05:09');
    expect(formattedUtc.toUpperCase()).toContain('PM');
  });

  it('computes default expected profit at 3x risk without floating-point precision noise', () => {
    expect(computeDefaultExpectedProfit(1)).toBe(3);
    expect(computeDefaultExpectedProfit(0.5)).toBe(1.5);
    expect(computeDefaultExpectedProfit(0.1)).toBe(0.3);
    expect(computeDefaultExpectedProfit(1.25)).toBe(3.75);
    expect(computeDefaultExpectedProfit(0)).toBe(0);
    expect(computeDefaultExpectedProfit(-1)).toBe(0);
  });

  it('filters trades by exact date, month (YYYY-MM), and search query', () => {
    const trades: Trade[] = [
      makeTrade({ id: 't_nov_1', date: '2026-11-17', instrument: 'XAUUSD', openedAt: '2026-11-17T08:00:00.000Z' }),
      makeTrade({ id: 't_nov_2', date: '2026-11-20', instrument: 'EURUSD', openedAt: '2026-11-20T09:00:00.000Z' }),
      makeTrade({ id: 't_oct_1', date: '2026-10-15', instrument: 'BTCUSD', openedAt: '2026-10-15T10:00:00.000Z' }),
    ];

    expect(filterTrades(trades, { dateFilter: '2026-11-17' }).map((t) => t.id)).toEqual(['t_nov_1']);
    expect(filterTrades(trades, { monthFilter: '2026-11' }).map((t) => t.id)).toEqual(['t_nov_2', 't_nov_1']);
    expect(filterTrades(trades, { monthFilter: '2026-10' }).map((t) => t.id)).toEqual(['t_oct_1']);
    expect(filterTrades(trades, { monthFilter: '2026-11', searchQuery: 'eurusd' }).map((t) => t.id)).toEqual(['t_nov_2']);
  });

  it('builds interlinking arrow metadata for adjacent paired multi-account trades', () => {
    const trades: Trade[] = [
      makeTrade({
        id: 'pair1_a',
        tradeGroupId: 'grp_1',
        accountId: 'acc_1',
        accountName: 'Account A',
        tradeNumberOfDay: 1,
        openedAt: '2026-11-17T10:00:00.000Z',
      }),
      makeTrade({
        id: 'pair1_b',
        tradeGroupId: 'grp_1',
        accountId: 'acc_2',
        accountName: 'Account B',
        tradeNumberOfDay: 2,
        openedAt: '2026-11-17T10:00:00.000Z',
      }),
      makeTrade({
        id: 'single_1',
        accountId: 'acc_1',
        accountName: 'Account A',
        tradeNumberOfDay: 3,
        openedAt: '2026-11-17T09:00:00.000Z',
      }),
    ];

    const sorted = filterTrades(trades, {});
    const map = buildTradeGroupVisualMap(sorted, trades);

    expect(map.get('pair1_a')).toEqual({
      isLinked: true,
      pairIndex: 1,
      prevSameGroup: false,
      nextSameGroup: true,
      siblingAccounts: ['Account A', 'Account B'],
    });
    expect(map.get('pair1_b')).toEqual({
      isLinked: true,
      pairIndex: 1,
      prevSameGroup: true,
      nextSameGroup: false,
      siblingAccounts: ['Account A', 'Account B'],
    });
    expect(map.get('single_1')?.isLinked).toBe(false);
  });

  it('filters trades by account, instrument, and excludes soft-deleted trades', () => {
    const trades: Array<Trade & { isDeleted?: boolean }> = [
      makeTrade({ id: 't1', accountId: 'acc_1', accountName: 'Primary', instrument: 'XAUUSD' }),
      makeTrade({ id: 't2', accountId: 'acc_2', accountName: 'Secondary', instrument: 'EURUSD' }),
      {
        ...makeTrade({
          id: 't3',
          accountId: 'acc_1',
          accountName: 'Primary',
          instrument: 'EURUSD',
        }),
        isDeleted: true,
      },
    ];

    expect(filterTrades(trades, {}).map((t) => t.id)).toEqual(['t1', 't2']);
    expect(filterTrades(trades, { accountFilter: 'acc_1' }).map((t) => t.id)).toEqual(['t1']);
    expect(filterTrades(trades, { instrumentFilter: 'EURUSD' }).map((t) => t.id)).toEqual(['t2']);
  });

  it('summarizes ledger metrics without mixing currencies and excludes open/soft-deleted trades from win rate and Net P&L', () => {
    const accounts: TradingAccount[] = [
      {
        id: 'acc_usd',
        userId: 'u1',
        schemaVersion: SCHEMA_VERSION,
        createdAt: '',
        updatedAt: '',
        name: 'USD Prop',
        broker: 'Prop',
        currency: 'USD',
        accountType: 'funded',
        capital: 100000,
        defaultRiskPercent: 1,
        isActive: true,
      },
      {
        id: 'acc_eur',
        userId: 'u1',
        schemaVersion: SCHEMA_VERSION,
        createdAt: '',
        updatedAt: '',
        name: 'EUR Personal',
        broker: 'Personal',
        currency: 'EUR',
        accountType: 'personal',
        capital: 25000,
        defaultRiskPercent: 0.5,
        isActive: true,
      },
    ];

    const trades: Array<Trade & { isDeleted?: boolean }> = [
      makeTrade({
        id: 'c_usd_win',
        accountId: 'acc_usd',
        status: 'closed',
        exitOutcome: 'win',
        actualProfitPercent: 3,
        netPnl: 300,
      }),
      makeTrade({
        id: 'c_eur_loss',
        accountId: 'acc_eur',
        status: 'closed',
        exitOutcome: 'loss',
        actualProfitPercent: -1,
        netPnl: -80,
      }),
      makeTrade({
        id: 'open_usd',
        accountId: 'acc_usd',
        status: 'during_trade',
        exitOutcome: 'pending',
        actualProfitPercent: undefined,
        netPnl: 999,
      }),
      {
        ...makeTrade({
          id: 'soft_deleted',
          accountId: 'acc_usd',
          status: 'closed',
          exitOutcome: 'win',
          actualProfitPercent: 5,
          netPnl: 500,
        }),
        isDeleted: true,
      },
    ];

    const mixedSummary = summarizeTradesForLedger(trades, accounts, 'USD');
    expect(mixedSummary.totalTrades).toBe(3);
    expect(mixedSummary.openTrades).toBe(1);
    expect(mixedSummary.closedTrades).toBe(2);
    expect(mixedSummary.winRate).toBe(50);
    expect(mixedSummary.netProfitPercent).toBe(2);
    expect(mixedSummary.hasMixedCurrencies).toBe(true);
    expect(mixedSummary.singleCurrencyNetPnl).toBeNull();
    expect(mixedSummary.monetaryByCurrency).toEqual([
      { currency: 'EUR', netPnl: -80, tradeCount: 1 },
      { currency: 'USD', netPnl: 300, tradeCount: 1 },
    ]);

    const usdOnly = filterTrades(trades, { accountFilter: 'acc_usd' });
    const singleSummary = summarizeTradesForLedger(usdOnly, accounts, 'USD');
    expect(singleSummary.totalTrades).toBe(2);
    expect(singleSummary.openTrades).toBe(1);
    expect(singleSummary.closedTrades).toBe(1);
    expect(singleSummary.winRate).toBe(100);
    expect(singleSummary.hasMixedCurrencies).toBe(false);
    expect(singleSummary.singleCurrencyNetPnl).toEqual({
      currency: 'USD',
      netPnl: 300,
      tradeCount: 1,
    });
  });

  it('excludes soft-deleted trades across financial, activity, discipline, psychology, and calendar status calculators', () => {
    const activeWin = makeTrade({
      id: 'active_win',
      date: '2026-11-18',
      openedAt: '2026-11-18T08:00:00.000Z',
      closedAt: '2026-11-18T09:00:00.000Z',
      exitOutcome: 'win',
      actualProfitPercent: 2.5,
      followedPlan: 'yes',
      followedRiskRules: 'yes',
      impulsiveEntry: 'no',
      preTradeEmotion: 'Calm',
      sessionId: 'ses_active',
    });
    const trashedLoss = makeTrade({
      id: 'trashed_loss',
      date: '2026-11-18',
      openedAt: '2026-11-18T10:00:00.000Z',
      closedAt: '2026-11-18T11:00:00.000Z',
      exitOutcome: 'loss',
      actualProfitPercent: -3,
      followedPlan: 'no',
      followedRiskRules: 'no',
      impulsiveEntry: 'yes',
      preTradeEmotion: 'Anxious',
      sessionId: 'ses_active',
      isDeleted: true,
      deletedAt: '2026-11-18T12:00:00.000Z',
    });

    const combined = [activeWin, trashedLoss];
    const fin = calculateFinancialMetrics(combined);
    expect(fin.closedTradesCount).toBe(1);
    expect(fin.netProfitPercent).toBe(2.5);
    expect(fin.winRate).toBe(100);

    const sessions: TradingSession[] = [
      {
        id: 'ses_active',
        userId: 'u1',
        schemaVersion: SCHEMA_VERSION,
        createdAt: '',
        updatedAt: '',
        date: '2026-11-18',
        timezone: 'Asia/Kolkata',
        sessionName: 'London',
        status: 'completed',
        attendance: 'attended',
        sittingLocation: 'home',
        preSessionEmotion: 'Calm',
        sessionBias: 'neutral',
        checklistItems: [],
      },
    ];
    const act = calculateActivityMetrics(sessions, combined);
    expect(act.inSessionTrades).toBe(1);
    expect(act.zeroTradeSessions).toBe(0);

    const disc = calculateDisciplineMetrics(combined, [], []);
    expect(disc.followedPlanRate).toBe(100);
    expect(disc.impulsiveEntryYes).toBe(0);

    const psych = calculatePsychologyMetrics(combined);
    expect(psych.calmVsAnxious.calm.count).toBe(1);
    expect(psych.calmVsAnxious.anxious.count).toBe(0);

    const dayStatus = getCalendarDayStatus('2026-11-18', [], sessions, combined);
    expect(dayStatus.status).toBe('profitable');
    expect(dayStatus.tradeCount).toBe(1);
    expect(dayStatus.netProfitPercent).toBe(2.5);
  });

  it('isolates active vs trashed multi-account group links in buildTradeGroupVisualMap', () => {
    const activeA = makeTrade({
      id: 'grp_a',
      tradeGroupId: 'grp_split',
      accountId: 'acc_1',
      accountName: 'Account A',
      openedAt: '2026-11-18T10:00:00.000Z',
    });
    const trashedB = makeTrade({
      id: 'grp_b',
      tradeGroupId: 'grp_split',
      accountId: 'acc_2',
      accountName: 'Account B',
      openedAt: '2026-11-18T10:00:00.000Z',
      isDeleted: true,
    });
    const trashedC = makeTrade({
      id: 'grp_c',
      tradeGroupId: 'grp_both_trashed',
      accountId: 'acc_1',
      accountName: 'Account A',
      openedAt: '2026-11-18T09:00:00.000Z',
      isDeleted: true,
    });
    const trashedD = makeTrade({
      id: 'grp_d',
      tradeGroupId: 'grp_both_trashed',
      accountId: 'acc_2',
      accountName: 'Account B',
      openedAt: '2026-11-18T09:00:00.000Z',
      isDeleted: true,
    });

    const all = [activeA, trashedB, trashedC, trashedD];
    const activeFiltered = filterTrades(all, {});
    expect(activeFiltered.map((t) => t.id)).toEqual(['grp_a']);
    const activeMap = buildTradeGroupVisualMap(activeFiltered, all);
    expect(activeMap.get('grp_a')?.isLinked).toBe(false);

    const trashFiltered = filterTrades(all, { onlyDeleted: true });
    expect(trashFiltered.map((t) => t.id)).toEqual(['grp_b', 'grp_c', 'grp_d']);
    const trashMap = buildTradeGroupVisualMap(trashFiltered, all, { onlyDeleted: true });
    expect(trashMap.get('grp_b')?.isLinked).toBe(false);
    expect(trashMap.get('grp_c')?.isLinked).toBe(true);
    expect(trashMap.get('grp_d')?.isLinked).toBe(true);
  });

  it('computes currency-isolated account breakdown, groupCurrencyNetPnl, instrument breakdown, and mistake breakdown', () => {
    const accounts: TradingAccount[] = [
      {
        id: 'acc_usd',
        userId: 'u1',
        schemaVersion: SCHEMA_VERSION,
        createdAt: '',
        updatedAt: '',
        name: 'USD Prop',
        broker: 'Prop',
        currency: 'USD',
        accountType: 'funded',
        capital: 100000,
        defaultRiskPercent: 1,
        isActive: true,
      },
      {
        id: 'acc_eur',
        userId: 'u1',
        schemaVersion: SCHEMA_VERSION,
        createdAt: '',
        updatedAt: '',
        name: 'EUR Personal',
        broker: 'Personal',
        currency: 'EUR',
        accountType: 'personal',
        capital: 25000,
        defaultRiskPercent: 0.5,
        isActive: true,
      },
    ];

    const trades: Trade[] = [
      makeTrade({
        id: 't1',
        accountId: 'acc_usd',
        accountName: 'USD Prop',
        instrument: 'XAUUSD',
        exitOutcome: 'win',
        actualProfitPercent: 3,
        netPnl: 300,
        mistakes: [],
      }),
      makeTrade({
        id: 't2',
        accountId: 'acc_usd',
        accountName: 'USD Prop',
        instrument: 'XAUUSD',
        exitOutcome: 'loss',
        actualProfitPercent: -1,
        netPnl: -100,
        mistakes: ['FOMO'],
      }),
      makeTrade({
        id: 't3',
        accountId: 'acc_eur',
        accountName: 'EUR Personal',
        instrument: 'EURUSD',
        exitOutcome: 'win',
        actualProfitPercent: 2,
        netPnl: 120,
        mistakes: [],
      }),
    ];

    const grouped = groupCurrencyNetPnl(trades, accounts, 'USD');
    expect(grouped).toEqual([
      { currency: 'EUR', netPnl: 120, tradeCount: 1 },
      { currency: 'USD', netPnl: 200, tradeCount: 2 },
    ]);

    const accRows = calculateAccountBreakdown(trades, accounts, 'USD');
    expect(accRows.find((r) => r.accountId === 'acc_usd')?.netMonetaryPnl).toBe(200);
    expect(accRows.find((r) => r.accountId === 'acc_eur')?.netMonetaryPnl).toBe(120);

    const instRows = calculateInstrumentBreakdown(trades);
    expect(instRows[0].key).toBe('XAUUSD');
    expect(instRows[0].winRate).toBe(50);

    const mistakeRows = calculateMistakesBreakdown(trades);
    expect(mistakeRows).toEqual([
      {
        mistake: 'FOMO',
        count: 1,
        winRate: 0,
        netProfitPercent: -1,
      },
    ]);
  });
});

