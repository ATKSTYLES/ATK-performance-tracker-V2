import { describe, expect, it, vi } from 'vitest';

vi.mock('../../storage/repository', () => ({
  downloadAttachmentBytes: vi.fn(),
  uploadRawAttachmentBytes: vi.fn(),
}));

import { SCHEMA_VERSION } from '../../domain/enums';
import { Trade, TradingAccount, TradingSession } from '../../domain/types';
import {
  buildCompleteReportCsvString,
  buildPerformanceMetricsCsvString,
  buildSessionsCsvString,
  buildTradesCsvString,
  exportCompleteReportCsv,
  exportPerformanceMetricsCsv,
  exportSessionsCsv,
  exportTradesCsv,
  WorkspaceExportBundle,
} from '../utds';

function makeBundle(): WorkspaceExportBundle {
  const accounts: TradingAccount[] = [
    {
      id: 'acc_usd',
      userId: 'u1',
      schemaVersion: SCHEMA_VERSION,
      name: 'Fortress, Main',
      broker: 'FTMO',
      accountType: 'funded',
      capital: 100000,
      currency: 'USD',
      defaultRiskPercent: 1,
      isActive: true,
      createdAt: '2026-11-01T00:00:00.000Z',
      updatedAt: '2026-11-01T00:00:00.000Z',
    },
  ];

  const sessions: TradingSession[] = [
    {
      id: 'ses_1',
      userId: 'u1',
      schemaVersion: SCHEMA_VERSION,
      date: '2026-11-16',
      timezone: 'Asia/Kolkata',
      sessionName: 'London',
      scheduledStart: '12:30',
      scheduledEnd: '15:30',
      status: 'completed',
      attendance: 'attended',
      sittingLocation: 'trading_desk',
      preSessionEmotion: 'Calm',
      postSessionEmotion: 'Satisfied',
      sessionBias: 'bullish',
      checklistItems: [],
      actualStartTime: '2026-11-16T07:05:00.000Z',
      actualEndTime: '2026-11-16T09:35:00.000Z',
      setupAvailability: 'available',
      planAdherence: 'yes',
      closingReflection: 'Followed plan, "clean" execution',
      createdAt: '2026-11-16T07:05:00.000Z',
      updatedAt: '2026-11-16T09:35:00.000Z',
    },
    {
      id: 'ses_2',
      userId: 'u1',
      schemaVersion: SCHEMA_VERSION,
      date: '2026-11-17',
      timezone: 'Asia/Kolkata',
      sessionName: 'New York',
      scheduledStart: '18:00',
      scheduledEnd: '21:00',
      status: 'missed',
      attendance: 'missed',
      sittingLocation: 'trading_desk',
      preSessionEmotion: 'Neutral',
      sessionBias: 'neutral',
      checklistItems: [],
      createdAt: '2026-11-17T12:30:00.000Z',
      updatedAt: '2026-11-17T12:30:00.000Z',
    },
  ];

  const trades: Trade[] = [
    {
      id: 'tr_1',
      userId: 'u1',
      schemaVersion: SCHEMA_VERSION,
      date: '2026-11-16',
      timezone: 'Asia/Kolkata',
      tradeNumberOfDay: 1,
      accountId: 'acc_usd',
      accountName: 'Fortress, Main',
      sessionId: 'ses_1',
      sessionName: 'London',
      isOutOfSession: false,
      instrument: 'XAUUSD',
      direction: 'long',
      setupLabel: 'Breakout',
      status: 'closed',
      riskPercent: 1,
      expectedProfitPercent: 3,
      actualProfitPercent: 2.5,
      preTradeEmotion: 'Focused',
      postTradeEmotion: 'Calm',
      confidence: 8,
      openedAt: '2026-11-16T07:30:00.000Z',
      closedAt: '2026-11-16T08:15:00.000Z',
      exitOutcome: 'win',
      exitReason: 'take_profit',
      tpStatus: 'hit_full',
      slStatus: 'untouched',
      netPnl: 250,
      currency: 'USD',
      followedPlan: 'yes',
      followedRiskRules: 'yes',
      impulsiveEntry: 'no',
      exitedPerPlan: 'yes',
      mistakes: [],
      lessonsLearned: 'Wait for confirmation',
      createdAt: '2026-11-16T07:30:00.000Z',
      updatedAt: '2026-11-16T08:15:00.000Z',
    },
    {
      id: 'tr_deleted',
      userId: 'u1',
      schemaVersion: SCHEMA_VERSION,
      date: '2026-11-16',
      timezone: 'Asia/Kolkata',
      tradeNumberOfDay: 2,
      accountId: 'acc_usd',
      accountName: 'Fortress, Main',
      sessionId: 'ses_1',
      sessionName: 'London',
      isOutOfSession: false,
      instrument: 'EURUSD',
      direction: 'short',
      status: 'closed',
      riskPercent: 1,
      expectedProfitPercent: 2,
      actualProfitPercent: -5,
      preTradeEmotion: 'Anxious',
      confidence: 5,
      openedAt: '2026-11-16T08:30:00.000Z',
      closedAt: '2026-11-16T09:00:00.000Z',
      exitOutcome: 'loss',
      exitReason: 'stop_loss',
      tpStatus: 'missed',
      slStatus: 'hit',
      netPnl: -500,
      currency: 'USD',
      followedPlan: 'no',
      followedRiskRules: 'no',
      impulsiveEntry: 'yes',
      exitedPerPlan: 'no',
      mistakes: ['FOMO'],
      isDeleted: true,
      createdAt: '2026-11-16T08:30:00.000Z',
      updatedAt: '2026-11-16T09:00:00.000Z',
    },
  ];

  return {
    profile: null,
    accounts,
    daily_journals: [],
    sessions,
    session_events: [],
    trades,
    trade_events: [],
    trade_groups: [],
    reviews: [],
    settings: null,
    templates: [],
    instruments: [],
    checklists: [],
    attachments_index: [],
  };
}

describe('Complete CSV Export (Sessions, Trades & Performance Metrics)', () => {
  it('exports all three sections in one CSV while excluding soft-deleted trades and escaping special characters', () => {
    const bundle = makeBundle();
    const csv = buildCompleteReportCsvString(bundle);

    expect(csv).toContain('=== ATK DECK COMPLETE TRADING REPORT ===');
    expect(csv).toContain('=== SECTION 1: PERFORMANCE METRICS & BREAKDOWNS ===');
    expect(csv).toContain('=== SECTION 2: TRADING SESSION DATA ===');
    expect(csv).toContain('=== SECTION 3: TRADE DATA ===');

    // Performance metrics match active-only records
    expect(csv).toContain('Financial,Total Active Trades,1,1 closed / 0 open');
    expect(csv).toContain('Financial,Win Rate,100%,1 of 1 closed trades');
    expect(csv).toContain('Financial,Net Profit %,2.5%');
    expect(csv).toContain('Financial (Monetary),Net Monetary P&L (USD),+250.00 USD,1 closed trade(s)');
    expect(csv).toContain('Session Activity,Sessions Traded,1,1 in-session trade(s)');
    expect(csv).toContain('Session Activity,Sessions Not Attended (Missed),1,');

    // Session rows include outcome classification and escaped quotes/commas
    expect(csv).toContain('ses_1,2026-11-16,Asia/Kolkata,London');
    expect(csv).toContain('"Followed plan, ""clean"" execution"');
    expect(csv).toContain('ses_2,2026-11-17,Asia/Kolkata,New York');

    // Trade rows include active trade with escaped account name and exclude soft-deleted trade
    expect(csv).toContain('tr_1,2026-11-16,Asia/Kolkata,1,"Fortress, Main"');
    expect(csv).not.toContain('tr_deleted');
  });

  it('produces standalone Sessions, Trades, and Performance Metrics CSVs and valid CSV Blobs', () => {
    const bundle = makeBundle();

    const sessionsCsv = buildSessionsCsvString(bundle.sessions, bundle.trades);
    expect(sessionsCsv).toContain('Session Outcome,Linked Trades Count');
    expect(sessionsCsv).toContain(',Traded,1,');
    expect(sessionsCsv).toContain(',Missed,0,');

    const tradesCsv = buildTradesCsvString(bundle.trades);
    expect(tradesCsv).toContain('XAUUSD');
    expect(tradesCsv).not.toContain('tr_deleted');

    const metricsCsv = buildPerformanceMetricsCsvString(bundle);
    expect(metricsCsv).toContain('=== ACCOUNT PERFORMANCE BREAKDOWN ===');
    expect(metricsCsv).toContain('=== INSTRUMENT PERFORMANCE BREAKDOWN ===');
    expect(metricsCsv).toContain('=== WEEKLY SESSION COMPARATIVE (5-DAY TRADING WEEK BASIS) ===');

    expect(exportCompleteReportCsv(bundle).type).toBe('text/csv;charset=utf-8;');
    expect(exportSessionsCsv(bundle.sessions, bundle.trades).type).toBe('text/csv;charset=utf-8;');
    expect(exportTradesCsv(bundle.trades).type).toBe('text/csv;charset=utf-8;');
    expect(exportPerformanceMetricsCsv(bundle).type).toBe('text/csv;charset=utf-8;');
  });
});
