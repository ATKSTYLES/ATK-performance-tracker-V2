import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import {
  calculateAccountBreakdown,
  calculateActivityMetrics,
  calculateDirectionBreakdown,
  calculateDisciplineMetrics,
  calculateFinancialMetrics,
  calculateInstrumentBreakdown,
  calculatePsychologyMetrics,
  calculateSessionCoverageMetrics,
  calculateSetupBreakdown,
  classifySessionOutcome,
  computeRealisedR,
  groupCurrencyNetPnl,
  isActiveTrade,
} from '../domain/calculations';
import {
  APP_NAME,
  APP_VERSION,
  DEFAULT_CURRENCY,
  DEFAULT_TIMEZONE,
  UTDS_FORMAT_NAME,
  UTDS_FORMAT_VERSION,
} from '../domain/enums';
import { formatDurationMinutes } from '../domain/timezone';
import {
  AttachmentMeta,
  ChecklistConfig,
  DailyJournal,
  InstrumentConfig,
  SessionEvent,
  SessionTemplate,
  Trade,
  TradeEvent,
  TradeGroup,
  TradingAccount,
  TradingReview,
  TradingSession,
  UserProfilePreferences,
} from '../domain/types';
import { apiRequest, emitLocalWorkspaceSync } from '../storage/apiClient';
import {
  downloadAttachmentBytes,
  uploadRawAttachmentBytes,
} from '../storage/repository';

export interface WorkspaceExportBundle {
  profile: UserProfilePreferences | null;
  accounts: TradingAccount[];
  daily_journals: DailyJournal[];
  sessions: TradingSession[];
  session_events: SessionEvent[];
  trades: Trade[];
  trade_events: TradeEvent[];
  trade_groups: TradeGroup[];
  reviews: TradingReview[];
  settings: UserProfilePreferences | null;
  templates: SessionTemplate[];
  instruments: InstrumentConfig[];
  checklists: ChecklistConfig[];
  attachments_index: AttachmentMeta[];
}

export interface UtdsManifest {
  formatName: string;
  formatVersion: string;
  exportTimestamp: string;
  sourceApplication: string;
  sourceVersion: string;
  exportScope: string;
  recordCounts: Record<string, number>;
  attachmentCount: number;
  checksumSha256: string;
}

export type ImportConflictStrategy = 'skip' | 'copy' | 'replace';

export interface ParsedImportPackage {
  manifest: UtdsManifest;
  checksumValid: boolean;
  bundle: WorkspaceExportBundle;
  attachmentBlobs: Map<string, Uint8Array>;
  duplicateCounts: Record<string, number>;
  totalRecords: number;
  totalDuplicates: number;
}

export interface ImportCommitReport {
  created: number;
  replaced: number;
  copied: number;
  skipped: number;
  attachmentsRestored: number;
  errors: string[];
}

async function sha256String(input: string): Promise<string> {
  const encoded = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function buildCanonicalPayloadString(bundle: WorkspaceExportBundle): string {
  return JSON.stringify({
    profile: bundle.profile,
    accounts: bundle.accounts,
    daily_journals: bundle.daily_journals,
    sessions: bundle.sessions,
    session_events: bundle.session_events,
    trades: bundle.trades,
    trade_events: bundle.trade_events,
    trade_groups: bundle.trade_groups,
    reviews: bundle.reviews,
    settings: bundle.settings,
    templates: bundle.templates,
    instruments: bundle.instruments,
    checklists: bundle.checklists,
    attachments_index: bundle.attachments_index,
  });
}

export async function createUtdsManifest(
  bundle: WorkspaceExportBundle,
  scope: string = 'full_workspace'
): Promise<UtdsManifest> {
  const checksumSha256 = await sha256String(buildCanonicalPayloadString(bundle));
  return {
    formatName: UTDS_FORMAT_NAME,
    formatVersion: UTDS_FORMAT_VERSION,
    exportTimestamp: new Date().toISOString(),
    sourceApplication: APP_NAME,
    sourceVersion: APP_VERSION,
    exportScope: scope,
    recordCounts: {
      accounts: bundle.accounts.length,
      daily_journals: bundle.daily_journals.length,
      sessions: bundle.sessions.length,
      session_events: bundle.session_events.length,
      trades: bundle.trades.length,
      trade_events: bundle.trade_events.length,
      trade_groups: bundle.trade_groups.length,
      reviews: bundle.reviews.length,
      templates: bundle.templates.length,
      instruments: bundle.instruments.length,
      checklists: bundle.checklists.length,
    },
    attachmentCount: bundle.attachments_index.length,
    checksumSha256,
  };
}

export async function exportBackupZip(
  bundle: WorkspaceExportBundle
): Promise<{ blob: Blob; manifest: UtdsManifest; warnings: string[] }> {
  const zip = new JSZip();
  const warnings: string[] = [];
  const manifest = await createUtdsManifest(bundle, 'full_workspace');

  zip.file('manifest.json', JSON.stringify(manifest, null, 2));
  zip.file('profile.json', JSON.stringify(bundle.profile, null, 2));
  zip.file('accounts.json', JSON.stringify(bundle.accounts, null, 2));
  zip.file('daily_journals.json', JSON.stringify(bundle.daily_journals, null, 2));
  zip.file('sessions.json', JSON.stringify(bundle.sessions, null, 2));
  zip.file('session_events.json', JSON.stringify(bundle.session_events, null, 2));
  zip.file('trades.json', JSON.stringify(bundle.trades, null, 2));
  zip.file('trade_events.json', JSON.stringify(bundle.trade_events, null, 2));
  zip.file('trade_groups.json', JSON.stringify(bundle.trade_groups, null, 2));
  zip.file('reviews.json', JSON.stringify(bundle.reviews, null, 2));
  zip.file('settings.json', JSON.stringify(bundle.settings, null, 2));
  zip.file('templates.json', JSON.stringify(bundle.templates, null, 2));
  zip.file('instruments.json', JSON.stringify(bundle.instruments, null, 2));
  zip.file('checklists.json', JSON.stringify(bundle.checklists, null, 2));
  zip.file('attachments_index.json', JSON.stringify(bundle.attachments_index, null, 2));

  const attachmentsFolder = zip.folder('attachments');
  for (const att of bundle.attachments_index) {
    try {
      const bytes = await downloadAttachmentBytes(att.storagePath);
      attachmentsFolder?.file(`${att.id}_${att.fileName}`, bytes);
    } catch {
      warnings.push(`Could not download attachment binary for ${att.fileName} (${att.id}).`);
    }
  }

  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  return { blob, manifest, warnings };
}

export async function exportJsonBundle(bundle: WorkspaceExportBundle): Promise<Blob> {
  const manifest = await createUtdsManifest(bundle, 'json_export');
  const payload = {
    manifest,
    ...bundle,
  };
  return new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
}

function escapeCsv(val: unknown): string {
  if (val === undefined || val === null) return '';
  const str = String(val);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function toCsvRow(values: unknown[]): string {
  return values.map(escapeCsv).join(',');
}

function formatMetricValue(val: number | null | undefined, suffix: string = ''): string {
  if (val === null || val === undefined || !Number.isFinite(val)) return 'N/A';
  return `${val}${suffix}`;
}

export function buildTradesCsvString(trades: Trade[]): string {
  const activeTrades = trades
    .filter(isActiveTrade)
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        a.openedAt.localeCompare(b.openedAt) ||
        (a.tradeNumberOfDay ?? 0) - (b.tradeNumberOfDay ?? 0)
    );

  const headers = [
    'ID',
    'Date',
    'Timezone',
    'Trade Number',
    'Account',
    'Session',
    'Out of Session',
    'Trade Group ID',
    'Instrument',
    'Direction',
    'Setup',
    'Entry Type',
    'Timeframe',
    'Status',
    'Risk %',
    'Expected Profit %',
    'Actual Profit %',
    'Exit Outcome',
    'Exit Reason',
    'TP Status',
    'SL Status',
    'Entry Price',
    'Exit Price',
    'Stop Loss Price',
    'Take Profit Price',
    'Position Size',
    'Gross P&L',
    'Commission',
    'Other Charges',
    'Net P&L',
    'Currency',
    'Realised R',
    'Pre-Trade Emotion',
    'Post-Trade Emotion',
    'Confidence',
    'Guard Passed',
    'Followed Plan',
    'Followed Risk Rules',
    'Impulsive Entry',
    'Exited Per Plan',
    'Mistakes',
    'Entry Reasoning',
    'Expected Outcome',
    'Actual Outcome Notes',
    'Lessons Learned',
    'Opened At',
    'Closed At',
  ];

  const rows = activeTrades.map((t) => {
    const realisedR = computeRealisedR(t);
    return toCsvRow([
      t.id,
      t.date,
      t.timezone,
      t.tradeNumberOfDay,
      t.accountName,
      t.isOutOfSession ? 'Out-of-Session' : t.sessionName ?? '',
      t.isOutOfSession ? 'Yes' : 'No',
      t.tradeGroupId ?? '',
      t.instrument,
      t.direction,
      t.setupLabel ?? '',
      t.entryType ?? '',
      t.timeframe ?? '',
      t.status,
      t.riskPercent,
      t.expectedProfitPercent,
      t.actualProfitPercent ?? '',
      t.exitOutcome,
      t.exitReason,
      t.tpStatus,
      t.slStatus,
      t.entryPrice ?? '',
      t.exitPrice ?? '',
      t.stopLossPrice ?? '',
      t.takeProfitPrice ?? '',
      t.positionSize ?? '',
      t.grossPnl ?? '',
      t.commission ?? '',
      t.otherCharges ?? '',
      t.netPnl ?? '',
      t.currency ?? '',
      realisedR ?? '',
      t.preTradeEmotion,
      t.postTradeEmotion ?? '',
      t.confidence,
      t.guardPassed === undefined ? '' : t.guardPassed ? 'Yes' : 'No',
      t.followedPlan,
      t.followedRiskRules,
      t.impulsiveEntry,
      t.exitedPerPlan,
      (t.mistakes ?? []).join('; '),
      t.entryReasoning ?? '',
      t.expectedOutcome ?? '',
      t.actualOutcomeNotes ?? '',
      t.lessonsLearned ?? '',
      t.openedAt,
      t.closedAt ?? '',
    ]);
  });

  return [toCsvRow(headers), ...rows].join('\n');
}

export function exportTradesCsv(trades: Trade[]): Blob {
  return new Blob([`\uFEFF${buildTradesCsvString(trades)}`], {
    type: 'text/csv;charset=utf-8;',
  });
}

export function buildSessionsCsvString(sessions: TradingSession[], trades: Trade[]): string {
  const sortedSessions = [...sessions].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      (a.actualStartTime ?? a.scheduledStart ?? '').localeCompare(
        b.actualStartTime ?? b.scheduledStart ?? ''
      )
  );

  const headers = [
    'ID',
    'Date',
    'Timezone',
    'Session Name',
    'Scheduled Start',
    'Scheduled End',
    'Actual Start',
    'Actual End',
    'Duration',
    'Status',
    'Attendance',
    'Session Outcome',
    'Linked Trades Count',
    'Sitting Location',
    'Pre-Session Emotion',
    'Post-Session Emotion',
    'Session Bias',
    'Setup Availability',
    'Plan Adherence',
    'Key Levels',
    'Market Expectations',
    'Preparation Notes',
    'Closing Reflection',
    'Created At',
  ];

  const outcomeLabels: Record<string, string> = {
    traded: 'Traded',
    attended_no_trade: 'Attended (0 Trades)',
    missed: 'Missed',
    cancelled: 'Cancelled',
    planned: 'Planned',
  };

  const rows = sortedSessions.map((s) => {
    const { outcome, tradeCount } = classifySessionOutcome(s, trades);
    const location =
      s.sittingLocation === 'other'
        ? s.sittingLocationCustom || 'Other'
        : s.sittingLocation;
    const bias = s.sessionBias === 'custom' ? s.sessionBiasCustom || 'Custom' : s.sessionBias;
    const duration =
      s.actualStartTime && s.actualEndTime
        ? formatDurationMinutes(s.actualStartTime, s.actualEndTime)
        : s.actualStartTime
        ? formatDurationMinutes(s.actualStartTime)
        : '';

    return toCsvRow([
      s.id,
      s.date,
      s.timezone,
      s.sessionName,
      s.scheduledStart ?? '',
      s.scheduledEnd ?? '',
      s.actualStartTime ?? '',
      s.actualEndTime ?? '',
      duration,
      s.status,
      s.attendance,
      outcomeLabels[outcome] ?? outcome,
      tradeCount,
      location,
      s.preSessionEmotion,
      s.postSessionEmotion ?? '',
      bias,
      s.setupAvailability ?? '',
      s.planAdherence ?? '',
      s.keyLevels ?? '',
      s.marketExpectations ?? '',
      s.preparationNotes ?? '',
      s.closingReflection ?? '',
      s.createdAt,
    ]);
  });

  return [toCsvRow(headers), ...rows].join('\n');
}

export function exportSessionsCsv(sessions: TradingSession[], trades: Trade[]): Blob {
  return new Blob([`\uFEFF${buildSessionsCsvString(sessions, trades)}`], {
    type: 'text/csv;charset=utf-8;',
  });
}

export function buildPerformanceMetricsCsvString(bundle: WorkspaceExportBundle): string {
  const activeTrades = bundle.trades.filter(isActiveTrade);
  const preferredCurrency = bundle.profile?.preferredCurrency || DEFAULT_CURRENCY;

  const fin = calculateFinancialMetrics(activeTrades);
  const act = calculateActivityMetrics(bundle.sessions, activeTrades);
  const disc = calculateDisciplineMetrics(
    activeTrades,
    bundle.session_events,
    bundle.daily_journals
  );
  const psych = calculatePsychologyMetrics(activeTrades);
  const coverage = calculateSessionCoverageMetrics({
    sessions: bundle.sessions,
    trades: activeTrades,
  });
  const currencyTotals = groupCurrencyNetPnl(activeTrades, bundle.accounts, preferredCurrency);
  const accountRows = calculateAccountBreakdown(activeTrades, bundle.accounts, preferredCurrency);
  const instrumentRows = calculateInstrumentBreakdown(activeTrades);
  const setupRows = calculateSetupBreakdown(activeTrades);
  const directionRows = calculateDirectionBreakdown(activeTrades);

  const lines: string[] = [];

  lines.push(toCsvRow(['Category', 'Metric', 'Value', 'Details']));

  // Financial Metrics
  lines.push(toCsvRow(['Financial', 'Total Active Trades', fin.totalTrades, `${fin.closedTradesCount} closed / ${fin.openTradesCount} open`]));
  lines.push(toCsvRow(['Financial', 'Win / Loss / Breakeven', `${fin.winCount}W / ${fin.lossCount}L / ${fin.breakevenCount}BE`, 'Closed result trades']));
  lines.push(toCsvRow(['Financial', 'Win Rate', formatMetricValue(fin.winRate, '%'), `${fin.winCount} of ${fin.winCount + fin.lossCount + fin.breakevenCount} closed trades`]));
  lines.push(toCsvRow(['Financial', 'Net Profit %', `${fin.netProfitPercent}%`, `Gross Win +${fin.grossWinPercent}% / Gross Loss -${fin.grossLossAbsPercent}%`]));
  lines.push(toCsvRow(['Financial', 'Profit Factor', formatMetricValue(fin.profitFactor), fin.hasLosingTrades ? 'Gross Win % / Gross Loss %' : 'No losing trades yet']));
  lines.push(toCsvRow(['Financial', 'Expectancy %', formatMetricValue(fin.expectancyPercent, '%'), 'Average return per closed result trade']));
  lines.push(toCsvRow(['Financial', 'Average Win %', formatMetricValue(fin.averageWinPercent, '%'), '']));
  lines.push(toCsvRow(['Financial', 'Average Loss %', formatMetricValue(fin.averageLossPercent, '%'), '']));
  lines.push(toCsvRow(['Financial', 'Largest Win %', formatMetricValue(fin.largestWinPercent, '%'), '']));
  lines.push(toCsvRow(['Financial', 'Largest Loss %', formatMetricValue(fin.largestLossPercent, '%'), '']));
  lines.push(toCsvRow(['Financial', 'Average Realised R', formatMetricValue(fin.averageR, 'R'), `${fin.rSampleSize} trade(s) with R multiple`]));
  lines.push(toCsvRow(['Financial', 'Max Drawdown %', `${fin.maxDrawdownPercent}%`, 'Peak-to-trough cumulative return %']));
  lines.push(toCsvRow(['Financial', 'Max Winning Streak', fin.maxWinningStreak, 'Consecutive wins']));
  lines.push(toCsvRow(['Financial', 'Max Losing Streak', fin.maxLosingStreak, 'Consecutive losses']));

  if (currencyTotals.length === 0) {
    lines.push(toCsvRow(['Financial (Monetary)', 'Net Monetary P&L', 'N/A', 'No closed trades with monetary P&L recorded']));
  } else {
    for (const c of currencyTotals) {
      lines.push(
        toCsvRow([
          'Financial (Monetary)',
          `Net Monetary P&L (${c.currency})`,
          `${c.netPnl >= 0 ? '+' : ''}${c.netPnl.toFixed(2)} ${c.currency}`,
          `${c.tradeCount} closed trade(s)`,
        ])
      );
    }
  }

  // Session Activity & 5-Day Week Comparative Metrics
  lines.push(toCsvRow(['Session Activity', 'Total Sessions', act.totalSessions, `${act.attendedSessions} attended / ${act.missedSessions} missed / ${act.cancelledSessions} cancelled / ${act.plannedSessions} planned`]));
  lines.push(toCsvRow(['Session Activity', 'Sessions Traded', coverage.sessionsTraded, `${coverage.tradesInSessions} in-session trade(s)`]));
  lines.push(toCsvRow(['Session Activity', 'Sessions Attended (0 Trades)', coverage.sessionsAttendedNoTrade, 'Attended with no linked trades']));
  lines.push(toCsvRow(['Session Activity', 'Sessions Not Attended (Missed)', coverage.missedSessions, '']));
  lines.push(toCsvRow(['Session Activity', 'Session Attendance Rate', formatMetricValue(act.attendanceRate, '%'), 'Attended / non-cancelled sessions']));
  lines.push(toCsvRow(['Session Activity', 'On-Time Start Rate', formatMetricValue(act.onTimeRate, '%'), `${act.onTimeSampleSize} sampled session(s)`]));
  lines.push(toCsvRow(['Session Activity', 'Valid Setup Availability Rate', formatMetricValue(act.validSetupRate, '%'), `${act.validSetupSampleSize} sampled session(s)`]));
  lines.push(toCsvRow(['Session Activity', 'In-Session vs Out-of-Session Trades', `${act.inSessionTrades} In-Session / ${act.outOfSessionTrades} Out-of-Session`, '']));
  lines.push(toCsvRow(['5-Day Trading Week Comparative', 'Recorded Span', coverage.startDate && coverage.endDate ? `${coverage.startDate} to ${coverage.endDate}` : 'N/A', '5 trading days/week (Mon–Fri) basis']));
  lines.push(toCsvRow(['5-Day Trading Week Comparative', 'Mon–Fri Trading Days in Span', coverage.tradingDays, 'Expected trading days at 5 days/week']));
  lines.push(toCsvRow(['5-Day Trading Week Comparative', 'Mon–Fri Trading Days Attended', coverage.weekdayDaysAttended, `${coverage.daysWithAttendedSession} total unique day(s) attended`]));
  lines.push(toCsvRow(['5-Day Trading Week Comparative', 'Trading Day Coverage %', formatMetricValue(coverage.tradingDayCoverageRate, '%'), `${coverage.tradingDaysWithoutAttendance} unlogged Mon–Fri trading day(s)`]));

  // Discipline Metrics
  lines.push(toCsvRow(['Discipline', 'Followed Plan Rate', formatMetricValue(disc.followedPlanRate, '%'), `${disc.followedPlanYes}/${disc.followedPlanTotal} closed trades`]));
  lines.push(toCsvRow(['Discipline', 'Followed Risk Rules Rate', formatMetricValue(disc.followedRiskRate, '%'), `${disc.followedRiskYes}/${disc.followedRiskTotal} closed trades`]));
  lines.push(toCsvRow(['Discipline', 'Impulsive Entry Rate', formatMetricValue(disc.impulsiveEntryRate, '%'), `${disc.impulsiveEntryYes}/${disc.impulsiveEntryTotal} closed trades`]));
  lines.push(toCsvRow(['Discipline', 'Exited Per Plan Rate', formatMetricValue(disc.exitedPerPlanRate, '%'), `${disc.exitedPerPlanYes}/${disc.exitedPerPlanTotal} closed trades`]));
  lines.push(toCsvRow(['Discipline', 'Stepped-Back Decisions', disc.steppedBackCount, 'Anti-bias / discipline pauses']));
  lines.push(toCsvRow(['Discipline', 'Daily Checklist Completion Rate', formatMetricValue(disc.checklistCompletionRate, '%'), `${disc.checklistSampleDays} day(s)`]));
  lines.push(toCsvRow(['Discipline', 'Process-Outcome: Good Process / Good Outcome', disc.processOutcomeMatrix.goodProcessGoodOutcome, `of ${disc.processOutcomeMatrix.sampleSize} classified trades`]));
  lines.push(toCsvRow(['Discipline', 'Process-Outcome: Good Process / Bad Outcome', disc.processOutcomeMatrix.goodProcessBadOutcome, `of ${disc.processOutcomeMatrix.sampleSize} classified trades`]));
  lines.push(toCsvRow(['Discipline', 'Process-Outcome: Bad Process / Good Outcome', disc.processOutcomeMatrix.badProcessGoodOutcome, `of ${disc.processOutcomeMatrix.sampleSize} classified trades`]));
  lines.push(toCsvRow(['Discipline', 'Process-Outcome: Bad Process / Bad Outcome', disc.processOutcomeMatrix.badProcessBadOutcome, `of ${disc.processOutcomeMatrix.sampleSize} classified trades`]));

  // Psychology Metrics
  lines.push(toCsvRow(['Psychology', 'Focused Trades', `${psych.focusedVsDistracted.focused.count} trades`, `Win Rate: ${formatMetricValue(psych.focusedVsDistracted.focused.winRate, '%')} | Net: ${psych.focusedVsDistracted.focused.netProfitPercent}%`]));
  lines.push(toCsvRow(['Psychology', 'Distracted / Tired Trades', `${psych.focusedVsDistracted.distracted.count} trades`, `Win Rate: ${formatMetricValue(psych.focusedVsDistracted.distracted.winRate, '%')} | Net: ${psych.focusedVsDistracted.distracted.netProfitPercent}%`]));
  lines.push(toCsvRow(['Psychology', 'Calm Trades', `${psych.calmVsAnxious.calm.count} trades`, `Win Rate: ${formatMetricValue(psych.calmVsAnxious.calm.winRate, '%')} | Net: ${psych.calmVsAnxious.calm.netProfitPercent}%`]));
  lines.push(toCsvRow(['Psychology', 'Anxious / Impatient Trades', `${psych.calmVsAnxious.anxious.count} trades`, `Win Rate: ${formatMetricValue(psych.calmVsAnxious.anxious.winRate, '%')} | Net: ${psych.calmVsAnxious.anxious.netProfitPercent}%`]));
  lines.push(toCsvRow(['Psychology', 'Trades Taken After a Loss', `${psych.tradesAfterLoss.count} trades`, `Win Rate: ${formatMetricValue(psych.tradesAfterLoss.winRate, '%')} | Net: ${psych.tradesAfterLoss.netProfitPercent}%`]));
  lines.push(toCsvRow(['Psychology', 'Planned vs Impulsive', `${psych.impulsiveVsPlanned.planned.count} Planned / ${psych.impulsiveVsPlanned.impulsive.count} Impulsive`, `Planned Net: ${psych.impulsiveVsPlanned.planned.netProfitPercent}% | Impulsive Net: ${psych.impulsiveVsPlanned.impulsive.netProfitPercent}%`]));

  // Breakdown Tables
  if (accountRows.length > 0) {
    lines.push('');
    lines.push(toCsvRow(['=== ACCOUNT PERFORMANCE BREAKDOWN ===']));
    lines.push(toCsvRow(['Account', 'Currency', 'Total Trades', 'Closed Trades', 'Open Trades', 'Win Rate %', 'Net Profit %', 'Net Monetary P&L', 'Profit Factor', 'Average R']));
    for (const r of accountRows) {
      lines.push(
        toCsvRow([
          r.accountName,
          r.currency,
          r.totalTrades,
          r.closedTrades,
          r.openTrades,
          formatMetricValue(r.winRate, '%'),
          `${r.netProfitPercent}%`,
          r.netMonetaryPnl !== null ? r.netMonetaryPnl.toFixed(2) : 'N/A',
          formatMetricValue(r.profitFactor),
          formatMetricValue(r.averageR, 'R'),
        ])
      );
    }
  }

  if (act.sessionBreakdown.length > 0) {
    lines.push('');
    lines.push(toCsvRow(['=== SESSION NAME BREAKDOWN ===']));
    lines.push(toCsvRow(['Session Name', 'Sessions Count', 'Total Trades', 'Closed Trades', 'Win Rate %', 'Net Profit %']));
    for (const r of act.sessionBreakdown) {
      lines.push(
        toCsvRow([
          r.sessionName,
          r.sessionCount,
          r.tradeCount,
          r.closedTradeCount,
          formatMetricValue(r.winRate, '%'),
          `${r.netProfitPercent}%`,
        ])
      );
    }
  }

  if (instrumentRows.length > 0) {
    lines.push('');
    lines.push(toCsvRow(['=== INSTRUMENT PERFORMANCE BREAKDOWN ===']));
    lines.push(toCsvRow(['Instrument', 'Total Trades', 'Closed Trades', 'Wins', 'Losses', 'Win Rate %', 'Net Profit %', 'Profit Factor', 'Average R']));
    for (const r of instrumentRows) {
      lines.push(
        toCsvRow([
          r.key,
          r.totalTrades,
          r.closedTrades,
          r.winCount,
          r.lossCount,
          formatMetricValue(r.winRate, '%'),
          `${r.netProfitPercent}%`,
          formatMetricValue(r.profitFactor),
          formatMetricValue(r.averageR, 'R'),
        ])
      );
    }
  }

  if (setupRows.length > 0) {
    lines.push('');
    lines.push(toCsvRow(['=== SETUP PERFORMANCE BREAKDOWN ===']));
    lines.push(toCsvRow(['Setup', 'Total Trades', 'Closed Trades', 'Wins', 'Losses', 'Win Rate %', 'Net Profit %', 'Profit Factor', 'Average R']));
    for (const r of setupRows) {
      lines.push(
        toCsvRow([
          r.key,
          r.totalTrades,
          r.closedTrades,
          r.winCount,
          r.lossCount,
          formatMetricValue(r.winRate, '%'),
          `${r.netProfitPercent}%`,
          formatMetricValue(r.profitFactor),
          formatMetricValue(r.averageR, 'R'),
        ])
      );
    }
  }

  if (directionRows.length > 0) {
    lines.push('');
    lines.push(toCsvRow(['=== DIRECTION PERFORMANCE BREAKDOWN ===']));
    lines.push(toCsvRow(['Direction', 'Total Trades', 'Closed Trades', 'Wins', 'Losses', 'Win Rate %', 'Net Profit %', 'Profit Factor', 'Average R']));
    for (const r of directionRows) {
      lines.push(
        toCsvRow([
          r.key,
          r.totalTrades,
          r.closedTrades,
          r.winCount,
          r.lossCount,
          formatMetricValue(r.winRate, '%'),
          `${r.netProfitPercent}%`,
          formatMetricValue(r.profitFactor),
          formatMetricValue(r.averageR, 'R'),
        ])
      );
    }
  }

  if (coverage.monthlyBreakdown.length > 0) {
    lines.push('');
    lines.push(toCsvRow(['=== MONTHLY SESSION COMPARATIVE (5-DAY TRADING WEEK BASIS) ===']));
    lines.push(toCsvRow(['Month', 'Start Date', 'End Date', '5d/Wk Trading Days', 'Sessions Attended', 'Sessions Traded', 'Trades in Sessions', 'Attended (0 Trades)', 'Sessions Not Attended', 'Mon–Fri Days Attended', 'Trading Day Coverage %']));
    for (const r of coverage.monthlyBreakdown) {
      lines.push(
        toCsvRow([
          r.label,
          r.startDate,
          r.endDate,
          r.tradingDays,
          r.attendedSessions,
          r.sessionsTraded,
          r.tradesInSessions,
          r.sessionsAttendedNoTrade,
          r.missedSessions,
          r.weekdayDaysAttended,
          formatMetricValue(r.tradingDayCoverageRate, '%'),
        ])
      );
    }
  }

  if (coverage.weeklyBreakdown.length > 0) {
    lines.push('');
    lines.push(toCsvRow(['=== WEEKLY SESSION COMPARATIVE (5-DAY TRADING WEEK BASIS) ===']));
    lines.push(toCsvRow(['Week (Mon–Sun)', 'Start Date', 'End Date', '5d/Wk Trading Days', 'Sessions Attended', 'Sessions Traded', 'Trades in Sessions', 'Attended (0 Trades)', 'Sessions Not Attended', 'Mon–Fri Days Attended', 'Trading Day Coverage %']));
    for (const r of coverage.weeklyBreakdown) {
      lines.push(
        toCsvRow([
          r.label,
          r.startDate,
          r.endDate,
          r.tradingDays,
          r.attendedSessions,
          r.sessionsTraded,
          r.tradesInSessions,
          r.sessionsAttendedNoTrade,
          r.missedSessions,
          r.weekdayDaysAttended,
          formatMetricValue(r.tradingDayCoverageRate, '%'),
        ])
      );
    }
  }

  return lines.join('\n');
}

export function exportPerformanceMetricsCsv(bundle: WorkspaceExportBundle): Blob {
  return new Blob([`\uFEFF${buildPerformanceMetricsCsvString(bundle)}`], {
    type: 'text/csv;charset=utf-8;',
  });
}

/**
 * Exports all performance metrics, all trading session data, and all active trade data
 * into a single structured multi-section CSV file compatible with Excel and Google Sheets.
 */
export function buildCompleteReportCsvString(bundle: WorkspaceExportBundle): string {
  const activeTradesCount = bundle.trades.filter(isActiveTrade).length;
  const exportedAt = new Date().toISOString();
  const timezone = bundle.profile?.timezone || DEFAULT_TIMEZONE;

  const sections: string[] = [
    [
      toCsvRow(['=== ATK DECK COMPLETE TRADING REPORT ===']),
      toCsvRow(['Exported At', exportedAt]),
      toCsvRow(['Application', `${APP_NAME} v${APP_VERSION}`]),
      toCsvRow(['Timezone', timezone]),
      toCsvRow(['Total Sessions', bundle.sessions.length]),
      toCsvRow(['Total Active Trades', activeTradesCount]),
    ].join('\n'),
    [
      toCsvRow(['=== SECTION 1: PERFORMANCE METRICS & BREAKDOWNS ===']),
      buildPerformanceMetricsCsvString(bundle),
    ].join('\n'),
    [
      toCsvRow(['=== SECTION 2: TRADING SESSION DATA ===']),
      buildSessionsCsvString(bundle.sessions, bundle.trades),
    ].join('\n'),
    [
      toCsvRow(['=== SECTION 3: TRADE DATA ===']),
      buildTradesCsvString(bundle.trades),
    ].join('\n'),
  ];

  return sections.join('\n\n');
}

export function exportCompleteReportCsv(bundle: WorkspaceExportBundle): Blob {
  return new Blob([`\uFEFF${buildCompleteReportCsvString(bundle)}`], {
    type: 'text/csv;charset=utf-8;',
  });
}

export function exportWorkbookXlsx(bundle: WorkspaceExportBundle): Blob {
  const wb = XLSX.utils.book_new();

  const tradesSheet = XLSX.utils.json_to_sheet(
    bundle.trades.map((t) => ({
      ID: t.id,
      Date: t.date,
      Account: t.accountName,
      Session: t.isOutOfSession ? 'Out-of-Session' : t.sessionName ?? '',
      Instrument: t.instrument,
      Direction: t.direction,
      Status: t.status,
      'Risk %': t.riskPercent,
      'Expected %': t.expectedProfitPercent,
      'Actual %': t.actualProfitPercent ?? null,
      Outcome: t.exitOutcome,
      'Exit Reason': t.exitReason,
      'Net PnL': t.netPnl ?? null,
      'Realised R': t.realisedR ?? null,
      Setup: t.setupLabel ?? '',
      Timeframe: t.timeframe ?? '',
      'Pre Emotion': t.preTradeEmotion,
      'Post Emotion': t.postTradeEmotion ?? '',
      'Followed Plan': t.followedPlan,
      Mistakes: (t.mistakes ?? []).join(', '),
      Lessons: t.lessonsLearned ?? '',
    }))
  );
  XLSX.utils.book_append_sheet(wb, tradesSheet, 'Trades');

  const sessionsSheet = XLSX.utils.json_to_sheet(
    bundle.sessions.map((s) => ({
      ID: s.id,
      Date: s.date,
      Session: s.sessionName,
      Status: s.status,
      Attendance: s.attendance,
      Location: s.sittingLocation,
      Bias: s.sessionBias,
      'Pre Emotion': s.preSessionEmotion,
      'Post Emotion': s.postSessionEmotion ?? '',
      'Plan Adherence': s.planAdherence ?? '',
      'Actual Start': s.actualStartTime ?? '',
      'Actual End': s.actualEndTime ?? '',
    }))
  );
  XLSX.utils.book_append_sheet(wb, sessionsSheet, 'Sessions');

  const journalsSheet = XLSX.utils.json_to_sheet(
    bundle.daily_journals.map((j) => ({
      Date: j.date,
      Timezone: j.timezone,
      'Emotional State': j.dailyEmotionalState,
      'Discipline Rating': j.disciplineRating,
      'Planned Activities': j.plannedActivities,
      'Morning Notes': j.morningNotes,
      Reflection: j.dailyReflection,
    }))
  );
  XLSX.utils.book_append_sheet(wb, journalsSheet, 'Daily Journals');

  const accountsSheet = XLSX.utils.json_to_sheet(
    bundle.accounts.map((a) => ({
      ID: a.id,
      Name: a.name,
      Broker: a.broker,
      Type: a.accountType,
      Capital: a.capital,
      Currency: a.currency,
      'Default Risk %': a.defaultRiskPercent,
      Active: a.isActive ? 'Yes' : 'No',
    }))
  );
  XLSX.utils.book_append_sheet(wb, accountsSheet, 'Accounts');

  const reviewsSheet = XLSX.utils.json_to_sheet(
    bundle.reviews.map((r) => ({
      ID: r.id,
      Type: r.reviewType,
      Period: r.periodLabel,
      Date: r.date,
      Rating: r.rating,
      Summary: r.summary,
      Lessons: r.lessonsLearned,
    }))
  );
  XLSX.utils.book_append_sheet(wb, reviewsSheet, 'Reviews');

  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  return new Blob([out], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

export async function parseAndValidateImportFile(
  file: File,
  existingIds: {
    accounts: Set<string>;
    daily_journals: Set<string>;
    sessions: Set<string>;
    session_events: Set<string>;
    trades: Set<string>;
    trade_events: Set<string>;
    trade_groups: Set<string>;
    reviews: Set<string>;
    templates: Set<string>;
    instruments: Set<string>;
    checklists: Set<string>;
    attachments: Set<string>;
  }
): Promise<ParsedImportPackage> {
  const attachmentBlobs = new Map<string, Uint8Array>();
  let manifest: UtdsManifest;
  let bundle: WorkspaceExportBundle;

  const ensureArray = <T>(val: unknown, label: string): T[] => {
    if (val === undefined || val === null) return [];
    if (!Array.isArray(val)) {
      throw new Error(`Invalid ATK-UTDS payload: "${label}" must be an array.`);
    }
    return val as T[];
  };

  if (file.name.toLowerCase().endsWith('.zip')) {
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const manifestFile = zip.file('manifest.json');
    if (!manifestFile) {
      throw new Error('Invalid ATK-UTDS archive: missing manifest.json.');
    }
    manifest = JSON.parse(await manifestFile.async('string')) as UtdsManifest;

    const readJson = async <T>(name: string, fallback: T): Promise<T> => {
      const f = zip.file(name);
      if (!f) return fallback;
      return JSON.parse(await f.async('string')) as T;
    };

    bundle = {
      profile: await readJson('profile.json', null),
      accounts: ensureArray(await readJson('accounts.json', []), 'accounts'),
      daily_journals: ensureArray(await readJson('daily_journals.json', []), 'daily_journals'),
      sessions: ensureArray(await readJson('sessions.json', []), 'sessions'),
      session_events: ensureArray(await readJson('session_events.json', []), 'session_events'),
      trades: ensureArray(await readJson('trades.json', []), 'trades'),
      trade_events: ensureArray(await readJson('trade_events.json', []), 'trade_events'),
      trade_groups: ensureArray(await readJson('trade_groups.json', []), 'trade_groups'),
      reviews: ensureArray(await readJson('reviews.json', []), 'reviews'),
      settings: await readJson('settings.json', null),
      templates: ensureArray(await readJson('templates.json', []), 'templates'),
      instruments: ensureArray(await readJson('instruments.json', []), 'instruments'),
      checklists: ensureArray(await readJson('checklists.json', []), 'checklists'),
      attachments_index: ensureArray(await readJson('attachments_index.json', []), 'attachments_index'),
    };

    for (const att of bundle.attachments_index) {
      const expectedName = `attachments/${att.id}_${att.fileName}`;
      const attFile = zip.file(expectedName);
      if (attFile) {
        attachmentBlobs.set(att.id, await attFile.async('uint8array'));
      }
    }
  } else {
    const raw = JSON.parse(await file.text()) as { manifest?: UtdsManifest } & Partial<WorkspaceExportBundle>;
    if (!raw.manifest) {
      throw new Error('Invalid JSON export: missing manifest object.');
    }
    manifest = raw.manifest;
    bundle = {
      profile: raw.profile ?? null,
      accounts: ensureArray(raw.accounts, 'accounts'),
      daily_journals: ensureArray(raw.daily_journals, 'daily_journals'),
      sessions: ensureArray(raw.sessions, 'sessions'),
      session_events: ensureArray(raw.session_events, 'session_events'),
      trades: ensureArray(raw.trades, 'trades'),
      trade_events: ensureArray(raw.trade_events, 'trade_events'),
      trade_groups: ensureArray(raw.trade_groups, 'trade_groups'),
      reviews: ensureArray(raw.reviews, 'reviews'),
      settings: raw.settings ?? null,
      templates: ensureArray(raw.templates, 'templates'),
      instruments: ensureArray(raw.instruments, 'instruments'),
      checklists: ensureArray(raw.checklists, 'checklists'),
      attachments_index: ensureArray(raw.attachments_index, 'attachments_index'),
    };
  }

  if (typeof manifest.formatName !== 'string' || manifest.formatName !== UTDS_FORMAT_NAME) {
    throw new Error(`Unsupported backup format: ${manifest.formatName}. Expected ${UTDS_FORMAT_NAME}.`);
  }
  if (typeof manifest.formatVersion !== 'string' || !manifest.formatVersion.startsWith('1.')) {
    throw new Error(`Unsupported ATK-UTDS version: ${manifest.formatVersion}.`);
  }

  const computedChecksum = await sha256String(buildCanonicalPayloadString(bundle));
  const checksumValid = computedChecksum === manifest.checksumSha256;

  const duplicateCounts: Record<string, number> = {
    accounts: bundle.accounts.filter((r) => existingIds.accounts.has(r.id)).length,
    daily_journals: bundle.daily_journals.filter((r) => existingIds.daily_journals.has(r.id)).length,
    sessions: bundle.sessions.filter((r) => existingIds.sessions.has(r.id)).length,
    session_events: bundle.session_events.filter((r) => existingIds.session_events.has(r.id)).length,
    trades: bundle.trades.filter((r) => existingIds.trades.has(r.id)).length,
    trade_events: bundle.trade_events.filter((r) => existingIds.trade_events.has(r.id)).length,
    trade_groups: bundle.trade_groups.filter((r) => existingIds.trade_groups.has(r.id)).length,
    reviews: bundle.reviews.filter((r) => existingIds.reviews.has(r.id)).length,
    templates: bundle.templates.filter((r) => existingIds.templates.has(r.id)).length,
    instruments: bundle.instruments.filter((r) => existingIds.instruments.has(r.id)).length,
    checklists: bundle.checklists.filter((r) => existingIds.checklists.has(r.id)).length,
  };

  const totalRecords =
    bundle.accounts.length +
    bundle.daily_journals.length +
    bundle.sessions.length +
    bundle.session_events.length +
    bundle.trades.length +
    bundle.trade_events.length +
    bundle.trade_groups.length +
    bundle.reviews.length +
    bundle.templates.length +
    bundle.instruments.length +
    bundle.checklists.length;

  const totalDuplicates = Object.values(duplicateCounts).reduce((a, b) => a + b, 0);

  return {
    manifest,
    checksumValid,
    bundle,
    attachmentBlobs,
    duplicateCounts,
    totalRecords,
    totalDuplicates,
  };
}

export async function commitParsedImport(
  _uid: string,
  parsed: ParsedImportPackage,
  strategy: ImportConflictStrategy,
  _existingIds?: {
    accounts: Set<string>;
    daily_journals: Set<string>;
    sessions: Set<string>;
    session_events: Set<string>;
    trades: Set<string>;
    trade_events: Set<string>;
    trade_groups: Set<string>;
    reviews: Set<string>;
    templates: Set<string>;
    instruments: Set<string>;
    checklists: Set<string>;
    attachments: Set<string>;
  }
): Promise<ImportCommitReport> {
  const res = await apiRequest<{
    report: ImportCommitReport & {
      attachmentTargets?: Array<{
        originalId: string;
        targetId: string;
        storagePath: string;
        contentType: string;
      }>;
    };
  }>('/api/backup/import-utds', {
    method: 'POST',
    body: {
      strategy,
      bundle: parsed.bundle,
    },
  });

  const report: ImportCommitReport = {
    created: res.report.created,
    replaced: res.report.replaced,
    copied: res.report.copied,
    skipped: res.report.skipped,
    attachmentsRestored: 0,
    errors: [...(res.report.errors ?? [])],
  };

  for (const target of res.report.attachmentTargets ?? []) {
    const blobBytes = parsed.attachmentBlobs.get(target.originalId);
    if (!blobBytes) continue;
    try {
      await uploadRawAttachmentBytes(
        target.storagePath,
        blobBytes,
        target.contentType || 'image/png'
      );
      report.attachmentsRestored += 1;
    } catch (err) {
      report.errors.push(
        `Failed restoring attachment ${target.originalId}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  emitLocalWorkspaceSync(['*']);
  return report;
}

export function triggerFileDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
