import React, { useMemo, useState } from 'react';
import { Link2, RotateCcw, Trash2 } from 'lucide-react';
import { TradeInspectorDrawer } from '../components/trading/TradeInspectorDrawer';
import {
  DatePicker,
  MonthPicker,
  SecondaryButton,
  SegmentedControl,
  SelectInput,
  TextInput,
} from '../components/ui/Controls';
import { DataColumn, DataTable, PageHeader } from '../components/ui/DataDisplay';
import { ConfirmationDialog, ErrorBanner } from '../components/ui/Overlays';
import { useWorkspace } from '../context/WorkspaceContext';
import { summarizeTradesForLedger } from '../domain/calculations';
import {
  EXIT_OUTCOME_LABELS,
  TRADE_DIRECTION_LABELS,
  TRADE_STATUS_LABELS,
} from '../domain/enums';
import { formatTimestampInTimezone } from '../domain/timezone';
import { Trade } from '../domain/types';
import {
  buildTradeGroupVisualMap,
  filterTrades,
  TradeRowLinkMeta,
} from '../domain/validation';
import {
  deleteTradeCascade,
  restoreTrade,
  restoreTradeGroup,
  softDeleteTrade,
} from '../storage/repository';

type LedgerViewMode = 'active' | 'trash';

function InterlinkingArrowIndicator({ meta }: { meta: TradeRowLinkMeta }) {
  if (!meta.isLinked) {
    return <span className="w-11 shrink-0" aria-hidden="true" />;
  }

  const pairTooltip = `Paired execution (#${meta.pairIndex}) across: ${meta.siblingAccounts.join(' ↔ ')}`;

  if (!meta.prevSameGroup && meta.nextSameGroup) {
    return (
      <span
        title={pairTooltip}
        aria-label={pairTooltip}
        className="inline-flex items-center gap-1 w-11 shrink-0 text-[var(--positive)] relative"
      >
        <svg
          width="18"
          height="28"
          viewBox="0 0 18 28"
          fill="none"
          className="-my-2 shrink-0"
          aria-hidden="true"
        >
          <path
            d="M4 28 V12 C4 8.686 6.686 6 10 6 H16"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
          />
          <path
            d="M12.5 2.75 L16.25 6 L12.5 9.25"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="font-mono-num text-[10px] font-semibold">#{meta.pairIndex}</span>
      </span>
    );
  }

  if (meta.prevSameGroup && !meta.nextSameGroup) {
    return (
      <span
        title={pairTooltip}
        aria-label={pairTooltip}
        className="inline-flex items-center gap-1 w-11 shrink-0 text-[var(--positive)] relative"
      >
        <svg
          width="18"
          height="28"
          viewBox="0 0 18 28"
          fill="none"
          className="-my-2 shrink-0"
          aria-hidden="true"
        >
          <path
            d="M4 0 V16 C4 19.314 6.686 22 10 22 H16"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
          />
          <path
            d="M12.5 18.75 L16.25 22 L12.5 25.25"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="font-mono-num text-[10px] font-semibold">#{meta.pairIndex}</span>
      </span>
    );
  }

  if (meta.prevSameGroup && meta.nextSameGroup) {
    return (
      <span
        title={pairTooltip}
        aria-label={pairTooltip}
        className="inline-flex items-center gap-1 w-11 shrink-0 text-[var(--positive)] relative"
      >
        <svg
          width="18"
          height="28"
          viewBox="0 0 18 28"
          fill="none"
          className="-my-2 shrink-0"
          aria-hidden="true"
        >
          <path d="M4 0 V28" stroke="currentColor" strokeWidth="1.75" />
          <path d="M4 14 H16" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
          <path
            d="M12.5 10.75 L16.25 14 L12.5 17.25"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="font-mono-num text-[10px] font-semibold">#{meta.pairIndex}</span>
      </span>
    );
  }

  return (
    <span
      title={pairTooltip}
      aria-label={pairTooltip}
      className="inline-flex items-center gap-1 w-11 shrink-0 text-[var(--positive)]"
    >
      <Link2 className="w-3.5 h-3.5 shrink-0" />
      <span className="font-mono-num text-[10px] font-semibold">#{meta.pairIndex}</span>
    </span>
  );
}

export function TradesPage({
  onRequestCloseTrade,
}: {
  onRequestCloseTrade: (trade: Trade) => void;
}) {
  const {
    user,
    accounts,
    activeTrades,
    deletedTrades,
    trades,
    tradeEvents,
    tradeGroups,
    attachments,
    timezone,
    preferredCurrency,
    refreshDiagnostics,
  } = useWorkspace();

  const uid = user?.uid ?? '';
  const [viewMode, setViewMode] = useState<LedgerViewMode>('active');

  const [searchQuery, setSearchQuery] = useState('');
  const [accountFilter, setAccountFilter] = useState('all');
  const [instrumentFilter, setInstrumentFilter] = useState('all');
  const [resultFilter, setResultFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sessionFilter, setSessionFilter] = useState('all');
  const [dateFilter, setDateFilter] = useState('');
  const [monthFilter, setMonthFilter] = useState('');

  const [hoveredGroupId, setHoveredGroupId] = useState<string | null>(null);
  const [selectedTrade, setSelectedTrade] = useState<Trade | null>(null);
  const [busyTradeId, setBusyTradeId] = useState<string | null>(null);
  const [permanentTarget, setPermanentTarget] = useState<Trade | null>(null);
  const [purging, setPurging] = useState(false);

  const [actionError, setActionError] = useState<string | null>(null);
  const [undoSoftDeleteTrade, setUndoSoftDeleteTrade] = useState<Trade | null>(null);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);

  const accountCurrencyLookup = useMemo(() => {
    const map = new Map<string, string>();
    for (const acc of accounts) {
      if (acc.id && acc.currency) {
        map.set(acc.id, acc.currency.toUpperCase());
      }
    }
    return map;
  }, [accounts]);

  const uniqueAccounts = useMemo(() => {
    const map = new Map<string, string>();
    for (const acc of accounts) {
      map.set(acc.id, acc.name);
    }
    for (const t of trades) {
      if (t.accountId && !map.has(t.accountId)) {
        map.set(t.accountId, t.accountName || t.accountId);
      }
    }
    return Array.from(map.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [accounts, trades]);

  const uniqueInstruments = useMemo(() => {
    const set = new Set<string>();
    for (const t of trades) {
      if (t.instrument) set.add(t.instrument);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [trades]);

  const filteredActive = useMemo(
    () =>
      filterTrades(activeTrades, {
        searchQuery,
        accountFilter,
        instrumentFilter,
        resultFilter,
        statusFilter,
        sessionFilter,
        dateFilter,
        monthFilter,
      }),
    [
      activeTrades,
      searchQuery,
      accountFilter,
      instrumentFilter,
      resultFilter,
      statusFilter,
      sessionFilter,
      dateFilter,
      monthFilter,
    ]
  );

  const filteredTrash = useMemo(
    () =>
      filterTrades(deletedTrades, {
        searchQuery,
        accountFilter,
        instrumentFilter,
        resultFilter,
        statusFilter,
        sessionFilter,
        dateFilter,
        monthFilter,
        onlyDeleted: true,
      }),
    [
      deletedTrades,
      searchQuery,
      accountFilter,
      instrumentFilter,
      resultFilter,
      statusFilter,
      sessionFilter,
      dateFilter,
      monthFilter,
    ]
  );

  const displayedRows = viewMode === 'active' ? filteredActive : filteredTrash;

  const groupVisualMap = useMemo(
    () =>
      buildTradeGroupVisualMap(displayedRows, trades, {
        onlyDeleted: viewMode === 'trash',
      }),
    [displayedRows, trades, viewMode]
  );

  const summary = useMemo(
    () => summarizeTradesForLedger(filteredActive, accounts, preferredCurrency),
    [filteredActive, accounts, preferredCurrency]
  );

  const hasFiltersApplied =
    Boolean(searchQuery) ||
    accountFilter !== 'all' ||
    instrumentFilter !== 'all' ||
    resultFilter !== 'all' ||
    statusFilter !== 'all' ||
    sessionFilter !== 'all' ||
    Boolean(dateFilter) ||
    Boolean(monthFilter);

  const clearFilters = () => {
    setSearchQuery('');
    setAccountFilter('all');
    setInstrumentFilter('all');
    setResultFilter('all');
    setStatusFilter('all');
    setSessionFilter('all');
    setDateFilter('');
    setMonthFilter('');
  };

  const handleSoftDelete = async (trade: Trade) => {
    if (!uid || busyTradeId) return;
    setBusyTradeId(trade.id);
    setActionError(null);
    setStatusNotice(null);
    try {
      await softDeleteTrade(uid, trade);
      if (selectedTrade?.id === trade.id) {
        setSelectedTrade(null);
      }
      setUndoSoftDeleteTrade(trade);
      setStatusNotice(
        `Moved ${trade.instrument} (${trade.accountName}, ${trade.date}) to Trash.`
      );
      refreshDiagnostics();
    } catch (err) {
      setActionError(
        err && typeof err === 'object' && 'userMessage' in err
          ? String((err as { userMessage: string }).userMessage)
          : err instanceof Error
          ? err.message
          : 'Failed to move trade to Trash.'
      );
      refreshDiagnostics();
    } finally {
      setBusyTradeId(null);
    }
  };

  const handleRestore = async (trade: Trade) => {
    if (!uid || busyTradeId) return;
    setBusyTradeId(trade.id);
    setActionError(null);
    try {
      await restoreTrade(uid, trade);
      if (undoSoftDeleteTrade?.id === trade.id) {
        setUndoSoftDeleteTrade(null);
      }
      setStatusNotice(`Restored ${trade.instrument} (${trade.accountName}) to Ledger.`);
      refreshDiagnostics();
    } catch (err) {
      setActionError(
        err && typeof err === 'object' && 'userMessage' in err
          ? String((err as { userMessage: string }).userMessage)
          : err instanceof Error
          ? err.message
          : 'Failed to restore trade.'
      );
      refreshDiagnostics();
    } finally {
      setBusyTradeId(null);
    }
  };

  const handleRestoreGroup = async (trade: Trade) => {
    if (!uid || !trade.tradeGroupId || busyTradeId) return;
    const siblingTrades = deletedTrades.filter((t) => t.tradeGroupId === trade.tradeGroupId);
    setBusyTradeId(trade.id);
    setActionError(null);
    try {
      await restoreTradeGroup(uid, siblingTrades);
      setStatusNotice(
        `Restored linked group (${siblingTrades.length} executions) to Ledger.`
      );
      refreshDiagnostics();
    } catch (err) {
      setActionError(
        err && typeof err === 'object' && 'userMessage' in err
          ? String((err as { userMessage: string }).userMessage)
          : err instanceof Error
          ? err.message
          : 'Failed to restore linked group.'
      );
      refreshDiagnostics();
    } finally {
      setBusyTradeId(null);
    }
  };

  const handleConfirmPermanentPurge = async () => {
    if (!uid || !permanentTarget || purging) return;
    setPurging(true);
    setActionError(null);
    try {
      await deleteTradeCascade(uid, permanentTarget, tradeEvents, tradeGroups, attachments);
      if (selectedTrade?.id === permanentTarget.id) {
        setSelectedTrade(null);
      }
      setStatusNotice(
        `Permanently deleted ${permanentTarget.instrument} (${permanentTarget.accountName}).`
      );
      setPermanentTarget(null);
      refreshDiagnostics();
    } catch (err) {
      setActionError(
        err && typeof err === 'object' && 'userMessage' in err
          ? String((err as { userMessage: string }).userMessage)
          : err instanceof Error
          ? err.message
          : 'Failed to permanently delete trade.'
      );
      setPermanentTarget(null);
      refreshDiagnostics();
    } finally {
      setPurging(false);
    }
  };

  const netPnlMonetaryLabel = useMemo(() => {
    if (summary.monetaryByCurrency.length === 0) return 'No monetary values recorded';
    return summary.monetaryByCurrency
      .map(
        (c) =>
          `${c.netPnl >= 0 ? '+' : ''}${c.netPnl.toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })} ${c.currency}`
      )
      .join(' · ');
  }, [summary.monetaryByCurrency]);

  const activeColumns: Array<DataColumn<Trade>> = [
    {
      key: 'datetime',
      header: 'Date & Time',
      render: (t) => {
        const meta = groupVisualMap.get(t.id) ?? {
          isLinked: false,
          pairIndex: 0,
          prevSameGroup: false,
          nextSameGroup: false,
          siblingAccounts: [],
        };
        return (
          <div className="flex items-center gap-2">
            <InterlinkingArrowIndicator meta={meta} />
            <div>
              <div className="font-mono-num text-[var(--text-primary)]">{t.date}</div>
              <div className="font-mono-num text-[11px] text-[var(--text-muted)]">
                {formatTimestampInTimezone(t.openedAt, timezone)}
              </div>
            </div>
          </div>
        );
      },
    },
    {
      key: 'instrument',
      header: 'Instrument',
      render: (t) => (
        <div>
          <span className="font-semibold text-[var(--text-primary)]">{t.instrument}</span>
          <div className="text-[11px] font-mono-num text-[var(--text-muted)]">
            Trade #{t.tradeNumberOfDay}
          </div>
        </div>
      ),
    },
    {
      key: 'direction',
      header: 'Side',
      render: (t) => (
        <span
          className={`font-medium ${
            t.direction === 'long' ? 'text-[var(--positive)]' : 'text-[var(--negative)]'
          }`}
        >
          {t.direction === 'long' ? 'Buy' : 'Sell'}
        </span>
      ),
    },
    {
      key: 'account',
      header: 'Account',
      render: (t) => (
        <span className="text-[var(--text-primary)] font-medium">{t.accountName}</span>
      ),
    },
    {
      key: 'sessionSetup',
      header: 'Session · Setup',
      render: (t) => (
        <div className="max-w-[200px]">
          <div className="truncate text-[var(--text-secondary)]">
            {t.isOutOfSession ? 'Out-of-Session' : t.sessionName ?? 'Session'}
          </div>
          <div className="truncate text-[11px] text-[var(--text-muted)]">
            {[t.setupLabel, t.timeframe].filter(Boolean).join(' · ') || '—'}
          </div>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (t) => (
        <span className="text-[var(--text-secondary)]">{TRADE_STATUS_LABELS[t.status]}</span>
      ),
    },
    {
      key: 'outcome',
      header: 'Result',
      render: (t) => (
        <span
          className={
            t.exitOutcome === 'win'
              ? 'text-[var(--positive)] font-semibold'
              : t.exitOutcome === 'loss'
              ? 'text-[var(--negative)] font-semibold'
              : 'text-[var(--text-secondary)]'
          }
        >
          {EXIT_OUTCOME_LABELS[t.exitOutcome]}
        </span>
      ),
    },
    {
      key: 'returnAndPnl',
      header: 'Return / P&L',
      align: 'right',
      render: (t) => {
        const currency = (
          t.currency ||
          accountCurrencyLookup.get(t.accountId) ||
          preferredCurrency ||
          'USD'
        ).toUpperCase();
        const pct = t.actualProfitPercent;
        const net = t.netPnl;
        return (
          <div className="text-right font-mono-num">
            {typeof pct === 'number' ? (
              <div
                className={`font-semibold ${
                  pct > 0
                    ? 'text-[var(--positive)]'
                    : pct < 0
                    ? 'text-[var(--negative)]'
                    : 'text-[var(--text-primary)]'
                }`}
              >
                {pct >= 0 ? '+' : ''}
                {pct}%
              </div>
            ) : (
              <div className="text-[var(--text-muted)]">—</div>
            )}
            {typeof net === 'number' && (
              <div className="text-[11px] text-[var(--text-muted)]">
                {net >= 0 ? '+' : ''}
                {net.toFixed(2)} {currency}
              </div>
            )}
          </div>
        );
      },
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: (t) => (
        <div
          className="inline-flex items-center justify-end gap-2.5"
          onClick={(e) => e.stopPropagation()}
        >
          {t.status !== 'closed' && (
            <button
              type="button"
              onClick={() => onRequestCloseTrade(t)}
              className="text-xs font-medium text-[var(--info)] hover:underline cursor-pointer"
            >
              Close
            </button>
          )}
          <button
            type="button"
            disabled={busyTradeId === t.id}
            onClick={() => void handleSoftDelete(t)}
            aria-label={`Move ${t.instrument} (${t.accountName}) to Trash`}
            title="Move to Trash"
            className="inline-flex items-center gap-1 text-xs font-medium text-[var(--negative)] hover:underline disabled:opacity-45 cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>{busyTradeId === t.id ? 'Moving...' : 'Trash'}</span>
          </button>
        </div>
      ),
    },
  ];

  const trashColumns: Array<DataColumn<Trade>> = [
    ...activeColumns.slice(0, 8),
    {
      key: 'trashActions',
      header: 'Restore / Purge',
      align: 'right',
      render: (t) => {
        const meta = groupVisualMap.get(t.id);
        return (
          <div
            className="inline-flex items-center justify-end gap-3"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              disabled={busyTradeId === t.id}
              onClick={() => void handleRestore(t)}
              className="inline-flex items-center gap-1 text-xs font-medium text-[var(--positive)] hover:underline disabled:opacity-45 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Restore</span>
            </button>
            {meta?.isLinked && t.tradeGroupId && (
              <button
                type="button"
                disabled={busyTradeId === t.id}
                onClick={() => void handleRestoreGroup(t)}
                className="text-xs font-medium text-[var(--info)] hover:underline disabled:opacity-45 cursor-pointer"
              >
                Restore Pair
              </button>
            )}
            <button
              type="button"
              disabled={busyTradeId === t.id}
              onClick={() => setPermanentTarget(t)}
              className="text-xs font-medium text-[var(--negative)] hover:underline disabled:opacity-45 cursor-pointer"
            >
              Purge
            </button>
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Trades"
        subtitle={`${activeTrades.length} active trade execution(s) · ${deletedTrades.length} in Trash`}
        actions={
          <SegmentedControl
            value={viewMode}
            onChange={(m) => {
              setViewMode(m);
              setSelectedTrade(null);
            }}
            options={[
              { value: 'active', label: `Active Ledger (${activeTrades.length})` },
              { value: 'trash', label: `Trash (${deletedTrades.length})` },
            ]}
          />
        }
      />

      {/* 1. Compact 5-Metric Summary Bar */}
      <section className="grid grid-cols-2 sm:grid-cols-5 border border-[var(--border)] rounded-lg bg-[var(--surface)] divide-y sm:divide-y-0 sm:divide-x divide-[var(--border)]">
        <div className="p-3.5">
          <div className="text-[11px] font-medium text-[var(--text-muted)]">Total Trades</div>
          <div className="text-base font-semibold font-mono-num text-[var(--text-primary)] mt-0.5">
            {summary.totalTrades}
          </div>
        </div>
        <div className="p-3.5">
          <div className="text-[11px] font-medium text-[var(--text-muted)]">Open Trades</div>
          <div className="text-base font-semibold font-mono-num text-[var(--info)] mt-0.5">
            {summary.openTrades}
          </div>
        </div>
        <div className="p-3.5">
          <div className="text-[11px] font-medium text-[var(--text-muted)]">Closed Trades</div>
          <div className="text-base font-semibold font-mono-num text-[var(--text-primary)] mt-0.5">
            {summary.closedTrades}
          </div>
        </div>
        <div className="p-3.5">
          <div className="text-[11px] font-medium text-[var(--text-muted)]">Win Rate</div>
          <div className="text-base font-semibold font-mono-num text-[var(--text-primary)] mt-0.5">
            {summary.winRate !== null ? `${summary.winRate}%` : '—'}
          </div>
          <div className="text-[11px] text-[var(--text-muted)]">Closed trades only</div>
        </div>
        <div className="p-3.5 col-span-2 sm:col-span-1">
          <div className="text-[11px] font-medium text-[var(--text-muted)]">Net P&amp;L</div>
          <div
            className={`text-base font-semibold font-mono-num mt-0.5 ${
              summary.netProfitPercent > 0
                ? 'text-[var(--positive)]'
                : summary.netProfitPercent < 0
                ? 'text-[var(--negative)]'
                : 'text-[var(--text-primary)]'
            }`}
          >
            {summary.closedTrades > 0
              ? `${summary.netProfitPercent >= 0 ? '+' : ''}${summary.netProfitPercent}%`
              : '—'}
          </div>
          <div className="text-[11px] font-mono-num text-[var(--text-muted)] truncate" title={netPnlMonetaryLabel}>
            {netPnlMonetaryLabel}
          </div>
        </div>
      </section>

      {actionError && (
        <ErrorBanner
          title="Trade Action Failed"
          message={actionError}
          onDismiss={() => setActionError(null)}
        />
      )}

      {statusNotice && (
        <div className="px-4 py-2.5 rounded-lg border border-[var(--positive)]/40 bg-[var(--positive-bg)] text-xs flex flex-wrap items-center justify-between gap-3">
          <span className="text-[var(--text-primary)]">{statusNotice}</span>
          <div className="flex items-center gap-3">
            {undoSoftDeleteTrade && (
              <button
                type="button"
                onClick={() => void handleRestore(undoSoftDeleteTrade)}
                className="font-semibold text-[var(--positive)] hover:underline cursor-pointer"
              >
                Undo Restore
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setStatusNotice(null);
                setUndoSoftDeleteTrade(null);
              }}
              className="text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* 2. Search and Filters */}
      <section className="p-4 rounded-lg bg-[var(--surface)] border border-[var(--border)] space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
          <TextInput
            label="Search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Instrument, setup, account, notes..."
          />
          <SelectInput
            label="Account"
            value={accountFilter}
            onChange={setAccountFilter}
            options={[
              { value: 'all', label: 'All Accounts' },
              ...uniqueAccounts.map((a) => ({ value: a.id, label: a.name })),
            ]}
          />
          <SelectInput
            label="Instrument"
            value={instrumentFilter}
            onChange={setInstrumentFilter}
            options={[
              { value: 'all', label: 'All Instruments' },
              ...uniqueInstruments.map((sym) => ({ value: sym, label: sym })),
            ]}
          />
          <SelectInput
            label="Session Scope"
            value={sessionFilter}
            onChange={setSessionFilter}
            options={[
              { value: 'all', label: 'All Sessions' },
              { value: 'in_session', label: 'In-Session Only' },
              { value: 'out_of_session', label: 'Out-of-Session Only' },
            ]}
          />
          <DatePicker
            label="Date"
            value={dateFilter}
            onChange={(val) => {
              setDateFilter(val);
              if (val) setMonthFilter('');
            }}
          />
          <MonthPicker
            label="Month"
            value={monthFilter}
            onChange={(val) => {
              setMonthFilter(val);
              if (val) setDateFilter('');
            }}
          />
          <SelectInput
            label="Result"
            value={resultFilter}
            onChange={setResultFilter}
            options={[
              { value: 'all', label: 'All Results' },
              { value: 'win', label: 'Win' },
              { value: 'loss', label: 'Loss' },
              { value: 'breakeven', label: 'Breakeven' },
              { value: 'pending', label: 'Pending' },
            ]}
          />
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <SelectInput
                label="Status"
                value={statusFilter}
                onChange={setStatusFilter}
                options={[
                  { value: 'all', label: 'All Statuses' },
                  { value: 'before_entry', label: 'Before Entry' },
                  { value: 'during_trade', label: 'During Trade' },
                  { value: 'closed', label: 'Closed' },
                ]}
              />
            </div>
            {hasFiltersApplied && (
              <SecondaryButton size="sm" type="button" onClick={clearFilters}>
                Clear
              </SecondaryButton>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[var(--text-muted)] pt-1 border-t border-[var(--border)]">
          <div className="inline-flex items-center gap-1.5">
            <Link2 className="w-3.5 h-3.5 text-[var(--positive)]" />
            <span>
              Green interlinking arrows highlight paired multi-account executions. Click any row to inspect or edit.
            </span>
          </div>
          <span className="font-mono-num">
            Showing {displayedRows.length}{' '}
            {viewMode === 'active' ? `of ${activeTrades.length} active` : `of ${deletedTrades.length} trashed`}
          </span>
        </div>
      </section>

      {/* 3. Master Trade Ledger (or Trash View) */}
      <DataTable
        columns={viewMode === 'active' ? activeColumns : trashColumns}
        rows={displayedRows}
        rowKey={(t) => t.id}
        onRowClick={(t) => setSelectedTrade(t)}
        onRowMouseEnter={(t) => setHoveredGroupId(t.tradeGroupId ?? null)}
        onRowMouseLeave={() => setHoveredGroupId(null)}
        rowClassName={(t) =>
          t.tradeGroupId && hoveredGroupId === t.tradeGroupId
            ? 'bg-[var(--positive-bg)]/50'
            : ''
        }
        emptyMessage={
          viewMode === 'active'
            ? 'No active trades match your current filters.'
            : 'Trash is empty. Soft-deleted trades appear here for recovery or permanent removal.'
        }
      />

      {/* 4. Trade Inspector Drawer */}
      <TradeInspectorDrawer
        trade={selectedTrade ? trades.find((t) => t.id === selectedTrade.id) ?? selectedTrade : null}
        tradeEvents={tradeEvents}
        attachments={attachments.filter((a) => a.relatedType === 'trade' && a.relatedId === selectedTrade?.id)}
        allAttachments={attachments}
        userId={uid}
        timezone={timezone}
        onClose={() => setSelectedTrade(null)}
        onSelectTrade={(sib) => setSelectedTrade(sib)}
        onTradeSoftDeleted={(deleted) => {
          setUndoSoftDeleteTrade(deleted);
          setStatusNotice(
            `Moved ${deleted.instrument} (${deleted.accountName}, ${deleted.date}) to Trash.`
          );
        }}
        onRequestCloseTrade={(t) => {
          setSelectedTrade(null);
          onRequestCloseTrade(t);
        }}
      />

      <ConfirmationDialog
        open={Boolean(permanentTarget)}
        onCancel={() => !purging && setPermanentTarget(null)}
        onConfirm={handleConfirmPermanentPurge}
        title="Permanently Delete Trashed Trade?"
        message={
          permanentTarget
            ? `Permanently purge ${permanentTarget.instrument} (${TRADE_DIRECTION_LABELS[permanentTarget.direction]}) on ${permanentTarget.date} for ${permanentTarget.accountName} along with its trade events and screenshots? This cannot be undone.`
            : ''
        }
        confirmLabel="Delete Permanently"
        destructive
        busy={purging}
      />
    </div>
  );
}
