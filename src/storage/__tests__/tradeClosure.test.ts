import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../../server/routes.ts';
import type Database from 'better-sqlite3';
import { calculateFinancialMetrics, computeRealisedR } from '../../domain/calculations';
import { SCHEMA_VERSION } from '../../domain/enums';
import type { Trade, TradeEvent, TradingSession } from '../../domain/types';
import {
  sanitizeFirestorePayload,
  sanitizeQueuePayload,
  validateCompleteTradeDocument,
  validateTradeClosure,
} from '../../domain/validation';
import {
  buildClosureEventId,
  type CloseTradePayload,
  closeLinkedTradesAtomically,
  closeTradeAtomically,
  createRecord,
  createTradesForAccountsAtomically,
  listUserCollection,
  MAX_LINKED_EXECUTIONS_PER_BATCH,
  restoreTrade,
  retryPendingOperation,
  softDeleteTrade,
  updateTradeDetails,
} from '../repository';
import { getErrorHistory, getPendingOperations } from '../syncQueue';

function installMockLocalStorage() {
  const ls = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => ls.get(k) ?? null,
    setItem: (k: string, v: string) => {
      ls.set(k, v);
    },
    removeItem: (k: string) => {
      ls.delete(k);
    },
    clear: () => ls.clear(),
    key: (i: number) => Array.from(ls.keys())[i] ?? null,
    get length() {
      return ls.size;
    },
  };
}

function makeCreateInput(
  overrides: Partial<Omit<Trade, 'id' | 'userId' | 'schemaVersion' | 'createdAt' | 'updatedAt'>> = {}
) {
  return {
    date: '2026-11-18',
    timezone: 'Asia/Kolkata',
    tradeNumberOfDay: 1,
    accountId: 'acc_fortress',
    accountName: 'FORTRESS',
    isOutOfSession: true,
    instrument: 'XAUUSD',
    direction: 'long' as const,
    status: 'during_trade' as const,
    riskPercent: 10,
    expectedProfitPercent: 30,
    preTradeEmotion: 'Calm',
    confidence: 8,
    guardPassed: false,
    openedAt: '2026-11-18T06:37:54.207Z',
    exitOutcome: 'pending' as const,
    exitReason: 'pending' as const,
    tpStatus: 'pending' as const,
    slStatus: 'pending' as const,
    currency: 'USD',
    followedPlan: 'na' as const,
    followedRiskRules: 'na' as const,
    impulsiveEntry: 'na' as const,
    exitedPerPlan: 'na' as const,
    mistakes: [],
    ...overrides,
  };
}

function baseClosePayload(overrides: Partial<CloseTradePayload> = {}): CloseTradePayload {
  return {
    exitOutcome: 'win',
    exitReason: 'take_profit',
    tpStatus: 'hit_full',
    slStatus: 'untouched',
    actualProfitPercent: 30,
    followedPlan: 'yes',
    followedRiskRules: 'yes',
    impulsiveEntry: 'no',
    exitedPerPlan: 'yes',
    postTradeEmotion: 'Calm & Focused',
    mistakes: [],
    ...overrides,
  };
}

describe('ATK Deck V2 — Full-Stack Repository & Trade Closure Suite (Real Express + SQLite)', () => {
  const realFetch = globalThis.fetch;
  let tmpDir: string;
  let server: http.Server;
  let db: Database.Database;
  let baseUrl: string;
  let cookieHeader = '';
  let uid = '';
  let simulateFailure: null | { status: number; code: string; message: string } = null;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atk-closure-test-'));
    const created = createApp({
      dataDir: tmpDir,
      dbPath: path.join(tmpDir, 'atk-deck.db'),
      uploadsDir: path.join(tmpDir, 'uploads'),
      cookieSecure: 'false',
      allowPublicRegistration: false,
    });
    db = created.db;

    server = http.createServer(created.app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const addr = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;

    // Bootstrap owner account via real /api/auth/setup
    const regRes = await realFetch(`${baseUrl}/api/auth/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-ATK-Client': '1' },
      body: JSON.stringify({
        username: 'trader_owner',
        email: 'owner@atkdeck.local',
        displayName: 'Owner Trader',
        password: 'StrongPassword!2026',
      }),
    });
    expect(regRes.status).toBe(201);
    const setCookie = regRes.headers.get('set-cookie') ?? '';
    cookieHeader = setCookie.split(';')[0];
    const regBody = (await regRes.json()) as { user: { uid: string } };
    uid = regBody.user.uid;

    // Route relative /api/* fetches from src/storage/apiClient.ts to the local test server with auth cookie
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (simulateFailure && urlStr.includes('/api/trades/close-batch')) {
        return new Response(
          JSON.stringify({ code: simulateFailure.code, message: simulateFailure.message }),
          { status: simulateFailure.status, headers: { 'Content-Type': 'application/json' } }
        );
      }
      const targetUrl = urlStr.startsWith('/') ? `${baseUrl}${urlStr}` : urlStr;
      const headers = new Headers(init?.headers);
      if (cookieHeader) {
        headers.set('Cookie', cookieHeader);
      }
      return realFetch(targetUrl, { ...init, headers });
    }) as typeof fetch;
  });

  beforeEach(() => {
    simulateFailure = null;
    installMockLocalStorage();
    // Clean domain data tables between tests while keeping user & auth session intact
    for (const table of [
      'trade_events',
      'trades',
      'trade_groups',
      'session_events',
      'sessions',
      'daily_journals',
      'attachments',
      'reviews',
      'audit_logs',
    ]) {
      db.prepare(`DELETE FROM ${table}`).run();
    }
  });

  afterEach(() => {
    simulateFailure = null;
  });

  afterAll(async () => {
    globalThis.fetch = realFetch;
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    db?.close();
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('Single-account trade creation and atomic closure persist cleanly in SQLite with closure event', async () => {
    const tradeId = 'tr_single_create_close';
    await createTradesForAccountsAtomically(
      uid,
      [{ tradeId, data: makeCreateInput({ accountId: 'acc_1', accountName: 'Primary', riskPercent: 1, expectedProfitPercent: 3 }) }],
      undefined,
      'op_create_single'
    );

    const openTrades = await listUserCollection<Trade>(uid, 'trades');
    expect(openTrades.find((t) => t.id === tradeId)?.status).toBe('during_trade');

    await closeTradeAtomically(
      uid,
      tradeId,
      baseClosePayload({ actualProfitPercent: 2.5, postTradeEmotion: '  Calm & Focused  ', netPnl: 250, realisedR: 2.5 }),
      'op_close_single'
    );

    const trades = await listUserCollection<Trade>(uid, 'trades');
    const events = await listUserCollection<TradeEvent>(uid, 'trade_events');
    const closed = trades.find((t) => t.id === tradeId)!;
    const closeEv = events.find((e) => e.id === 'te_close_op_close_single')!;

    expect(closed.status).toBe('closed');
    expect(closed.actualProfitPercent).toBe(2.5);
    expect(closed.netPnl).toBe(250);
    expect(closed.realisedR).toBe(2.5);
    expect(closed.postTradeEmotion).toBe('Calm & Focused');
    expect(closed.closureOperationId).toBe('op_close_single');
    expect(closeEv.eventType).toBe('trade_closed');
    expect(closeEv.tradeId).toBe(tradeId);
    expect(closeEv.emotion).toBe('Calm & Focused');

    expect(computeRealisedR(closed)).toBe(2.5);
    const metrics = calculateFinancialMetrics(trades);
    expect(metrics.closedTradesCount).toBe(1);
    expect(metrics.netProfitPercent).toBe(2.5);
    expect(metrics.netMonetaryPnl).toBe(250);
  });

  it('Two-account Out-of-Session linked creation & atomic closure preserve distinct per-account risk, P&L, and currency', async () => {
    const t1Id = 'tr_linked_fortress';
    const t2Id = 'tr_linked_gft';
    const grpId = 'tg_xau_reported';
    const closeOpId = 'close_op_xau_linked';

    await createTradesForAccountsAtomically(
      uid,
      [
        {
          tradeId: t1Id,
          data: makeCreateInput({
            accountId: 'acc_fortress',
            accountName: 'FORTRESS',
            riskPercent: 10,
            expectedProfitPercent: 30,
            isOutOfSession: true,
            tradeGroupId: grpId,
            currency: 'USD',
          }),
        },
        {
          tradeId: t2Id,
          data: makeCreateInput({
            accountId: 'acc_gft',
            accountName: 'GFT',
            riskPercent: 1,
            expectedProfitPercent: 3,
            isOutOfSession: true,
            tradeGroupId: grpId,
            tradeNumberOfDay: 2,
            currency: 'EUR',
          }),
        },
      ],
      {
        id: grpId,
        date: '2026-11-18',
        instrument: 'XAUUSD',
        direction: 'long',
        tradeIds: [t1Id, t2Id],
        accountIds: ['acc_fortress', 'acc_gft'],
      },
      'op_open_xau'
    );

    await closeLinkedTradesAtomically(
      uid,
      [
        { tradeId: t1Id, closing: baseClosePayload({ actualProfitPercent: 30, netPnl: 3000 }) },
        { tradeId: t2Id, closing: baseClosePayload({ actualProfitPercent: 3, netPnl: 300 }) },
      ],
      closeOpId
    );

    const trades = await listUserCollection<Trade>(uid, 'trades');
    const events = await listUserCollection<TradeEvent>(uid, 'trade_events');
    const c1 = trades.find((t) => t.id === t1Id)!;
    const c2 = trades.find((t) => t.id === t2Id)!;

    expect(c1.status).toBe('closed');
    expect(c1.actualProfitPercent).toBe(30);
    expect(c1.netPnl).toBe(3000);
    expect(c1.currency).toBe('USD');
    expect(c1.sessionId).toBeUndefined();

    expect(c2.status).toBe('closed');
    expect(c2.actualProfitPercent).toBe(3);
    expect(c2.netPnl).toBe(300);
    expect(c2.currency).toBe('EUR');

    expect(events.find((e) => e.id === buildClosureEventId(closeOpId, 0))?.tradeId).toBe(t1Id);
    expect(events.find((e) => e.id === buildClosureEventId(closeOpId, 1))?.tradeId).toBe(t2Id);
  });

  it('Preserves legitimate zero values, strips blank optional notes, and reconciles netPnl from gross/commission/charges', async () => {
    const tZero = 'tr_zero_vals';
    const tReconcile = 'tr_reconcile_net';
    await createTradesForAccountsAtomically(
      uid,
      [
        { tradeId: tZero, data: makeCreateInput({ tradeGroupId: 'tg_san', tradeNumberOfDay: 1 }) },
        { tradeId: tReconcile, data: makeCreateInput({ tradeGroupId: 'tg_san', tradeNumberOfDay: 2 }) },
      ],
      {
        id: 'tg_san',
        date: '2026-11-18',
        instrument: 'XAUUSD',
        direction: 'long',
        tradeIds: [tZero, tReconcile],
        accountIds: ['acc_fortress'],
      }
    );

    await closeLinkedTradesAtomically(
      uid,
      [
        {
          tradeId: tZero,
          closing: baseClosePayload({
            exitOutcome: 'breakeven',
            exitReason: 'breakeven_exit',
            actualProfitPercent: 0,
            grossPnl: 0,
            commission: 0,
            otherCharges: 0,
            netPnl: 0,
            realisedR: 0,
            actualOutcomeNotes: '   ',
            lessonsLearned: '',
          }),
        },
        {
          tradeId: tReconcile,
          closing: baseClosePayload({
            actualProfitPercent: 1.5,
            grossPnl: 165,
            commission: 10,
            otherCharges: 5,
            netPnl: undefined,
          }),
        },
      ],
      'op_zero_reconcile'
    );

    const trades = await listUserCollection<Trade>(uid, 'trades');
    const zeroDoc = trades.find((t) => t.id === tZero)!;
    const recDoc = trades.find((t) => t.id === tReconcile)!;

    expect(zeroDoc.actualProfitPercent).toBe(0);
    expect(zeroDoc.grossPnl).toBe(0);
    expect(zeroDoc.netPnl).toBe(0);
    expect(zeroDoc.realisedR).toBe(0);
    expect(zeroDoc.actualOutcomeNotes).toBeUndefined();
    expect(zeroDoc.lessonsLearned).toBeUndefined();
    expect(recDoc.netPnl).toBe(150);
  });

  it('Rejects non-finite values, duplicate IDs, cross-group batches, and oversized batches cleanly', async () => {
    const t1 = 'tr_guard_1';
    const t2 = 'tr_guard_2';
    await createTradesForAccountsAtomically(uid, [{ tradeId: t1, data: makeCreateInput({ tradeGroupId: 'tg_a' }) }]);
    await createTradesForAccountsAtomically(uid, [{ tradeId: t2, data: makeCreateInput({ tradeGroupId: 'tg_b' }) }]);

    await expect(
      closeTradeAtomically(uid, t1, baseClosePayload({ actualProfitPercent: Number.NaN }), 'op_nan')
    ).rejects.toMatchObject({ errorCategory: 'validation', retrySafe: false });

    await expect(
      closeTradeAtomically(uid, t1, baseClosePayload({ entryPrice: Number.POSITIVE_INFINITY }), 'op_inf')
    ).rejects.toMatchObject({ errorCategory: 'validation', retrySafe: false });

    await expect(
      closeLinkedTradesAtomically(
        uid,
        [
          { tradeId: t1, closing: baseClosePayload() },
          { tradeId: t1, closing: baseClosePayload() },
        ],
        'op_dup'
      )
    ).rejects.toBeTruthy();

    await expect(
      closeLinkedTradesAtomically(
        uid,
        [
          { tradeId: t1, closing: baseClosePayload() },
          { tradeId: t2, closing: baseClosePayload() },
        ],
        'op_cross'
      )
    ).rejects.toBeTruthy();

    const oversized = Array.from({ length: MAX_LINKED_EXECUTIONS_PER_BATCH + 1 }, (_, i) => ({
      tradeId: `tr_over_${i}`,
      closing: baseClosePayload(),
    }));
    await expect(closeLinkedTradesAtomically(uid, oversized, 'op_over')).rejects.toBeTruthy();

    // Pure sanitization & domain validation helpers
    expect(() =>
      sanitizeFirestorePayload({ riskPercent: null, isOutOfSession: false }, { rejectNullKeys: ['riskPercent'] })
    ).toThrow(/Invalid null/);
    expect(sanitizeQueuePayload({ createdAt: { _methodName: 'serverTimestamp' }, valid: 42 })).toEqual({ valid: 42 });
    expect(validateTradeClosure({ ...baseClosePayload(), actualProfitPercent: Infinity }).valid).toBe(false);
    expect(
      validateCompleteTradeDocument({
        id: 't',
        userId: uid,
        schemaVersion: SCHEMA_VERSION,
        createdAt: '2026-11-18T00:00:00.000Z',
        updatedAt: '2026-11-18T00:00:00.000Z',
        ...makeCreateInput({ status: 'closed', exitOutcome: 'pending', actualProfitPercent: 2 }),
      }).valid
    ).toBe(false);
  });

  it('Handles transient server failure via pending retry queue, idempotent same-operationId retry, and closed trade conflict lock', async () => {
    const t1 = 'tr_retry_1';
    const t2 = 'tr_retry_2';
    await createTradesForAccountsAtomically(
      uid,
      [
        { tradeId: t1, data: makeCreateInput({ tradeGroupId: 'tg_retry', tradeNumberOfDay: 1 }) },
        { tradeId: t2, data: makeCreateInput({ tradeGroupId: 'tg_retry', tradeNumberOfDay: 2 }) },
      ],
      {
        id: 'tg_retry',
        date: '2026-11-18',
        instrument: 'XAUUSD',
        direction: 'long',
        tradeIds: [t1, t2],
        accountIds: ['acc_fortress'],
      }
    );

    const entries = [
      { tradeId: t1, closing: baseClosePayload({ actualProfitPercent: 2 }) },
      { tradeId: t2, closing: baseClosePayload({ actualProfitPercent: 1 }) },
    ];

    // Simulate transient 503 network outage
    simulateFailure = { status: 503, code: 'unavailable', message: 'Temporary database lock' };
    await expect(closeLinkedTradesAtomically(uid, entries, 'op_retry_e2e')).rejects.toMatchObject({
      operationId: 'op_retry_e2e',
      errorCategory: 'network',
      retrySafe: true,
    });

    // Both trades remain open
    const afterFail = await listUserCollection<Trade>(uid, 'trades');
    expect(afterFail.find((t) => t.id === t1)?.status).toBe('during_trade');
    expect(afterFail.find((t) => t.id === t2)?.status).toBe('during_trade');

    // Clear simulated outage and replay queued operation
    simulateFailure = null;
    const queued = getPendingOperations(uid).find((p) => p.operationId === 'op_retry_e2e')!;
    expect(queued).toBeTruthy();
    await retryPendingOperation(uid, queued);

    const afterRetry = await listUserCollection<Trade>(uid, 'trades');
    expect(afterRetry.find((t) => t.id === t1)?.status).toBe('closed');
    expect(afterRetry.find((t) => t.id === t2)?.status).toBe('closed');

    // Replaying exact same operationId is a clean idempotent no-op
    await expect(closeLinkedTradesAtomically(uid, entries, 'op_retry_e2e')).resolves.toBeUndefined();

    // Closing again with a NEW operationId rejects with conflict without polluting pending queue
    await expect(closeLinkedTradesAtomically(uid, entries, 'op_conflict_new')).rejects.toMatchObject({
      errorCategory: 'conflict',
      retrySafe: false,
    });
    expect(getPendingOperations(uid).some((p) => p.operationId === 'op_conflict_new')).toBe(false);
    expect(getErrorHistory(uid).some((e) => e.operationId === 'op_conflict_new' && e.errorCategory === 'conflict')).toBe(true);
  });

  it('Supports independent soft-delete, restore, trashed-trade close guard, and updateTradeDetails with clearFields', async () => {
    const t1 = 'tr_soft_1';
    const t2 = 'tr_soft_2';
    await createTradesForAccountsAtomically(uid, [
      { tradeId: t1, data: makeCreateInput({ tradeGroupId: 'tg_soft', tradeNumberOfDay: 1 }) },
      { tradeId: t2, data: makeCreateInput({ tradeGroupId: 'tg_soft', tradeNumberOfDay: 2 }) },
    ]);

    const initial = await listUserCollection<Trade>(uid, 'trades');
    const trade1 = initial.find((t) => t.id === t1)!;

    await softDeleteTrade(uid, trade1, 'op_soft_1');

    // Trashed trade cannot be closed until restored
    await expect(closeTradeAtomically(uid, t1, baseClosePayload(), 'op_close_trashed')).rejects.toMatchObject({
      errorCategory: 'conflict',
      retrySafe: false,
    });

    await restoreTrade(uid, trade1, 'op_restore_1');
    await closeTradeAtomically(
      uid,
      t1,
      baseClosePayload({ actualProfitPercent: 4, netPnl: 400, takeProfitPrice: 2650 }),
      'op_close_restored'
    );

    await updateTradeDetails(uid, t1, { actualProfitPercent: 4.5, lessonsLearned: 'Edited after review' }, ['netPnl']);
    const reloaded = (await listUserCollection<Trade>(uid, 'trades')).find((t) => t.id === t1)!;
    expect(reloaded.status).toBe('closed');
    expect(reloaded.actualProfitPercent).toBe(4.5);
    expect(reloaded.lessonsLearned).toBe('Edited after review');
    expect(reloaded.netPnl).toBeUndefined();
    expect(reloaded.takeProfitPrice).toBe(2650);

    // Sibling t2 remained completely untouched
    const sibling = (await listUserCollection<Trade>(uid, 'trades')).find((t) => t.id === t2)!;
    expect(sibling.status).toBe('during_trade');
    expect(sibling.isDeleted).not.toBe(true);
  });

  it('Closes a trade linked to an already-completed session without mutating the session', async () => {
    await createRecord(uid, 'sessions', 'ses_done_ny', {
      date: '2026-11-18',
      timezone: 'Asia/Kolkata',
      sessionName: 'New York',
      scheduledStart: '18:00',
      scheduledEnd: '21:00',
      status: 'completed',
      attendance: 'attended',
      sittingLocation: 'trading_desk',
      preSessionEmotion: 'Calm',
      postSessionEmotion: 'Focused',
      sessionBias: 'bullish',
      checklistItems: [],
      actualStartTime: '2026-11-18T12:30:00.000Z',
      actualEndTime: '2026-11-18T15:30:00.000Z',
      setupAvailability: 'available',
      planAdherence: 'yes',
      closingReflection: 'Solid session',
    }, 'sessions');

    await createTradesForAccountsAtomically(uid, [
      {
        tradeId: 'tr_after_ses',
        data: makeCreateInput({
          isOutOfSession: false,
          sessionId: 'ses_done_ny',
          sessionName: 'New York',
        }),
      },
    ]);

    await closeTradeAtomically(
      uid,
      'tr_after_ses',
      baseClosePayload({ exitOutcome: 'loss', exitReason: 'stop_loss', tpStatus: 'missed', slStatus: 'hit', actualProfitPercent: -1 }),
      'op_after_ses'
    );

    const trades = await listUserCollection<Trade>(uid, 'trades');
    const sessions = await listUserCollection<TradingSession>(uid, 'sessions');
    expect(trades.find((t) => t.id === 'tr_after_ses')?.status).toBe('closed');
    expect(sessions.find((s) => s.id === 'ses_done_ny')?.status).toBe('completed');
  });
});
