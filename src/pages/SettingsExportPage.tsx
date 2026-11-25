import React, { useMemo, useState } from 'react';
import { Trash2 } from 'lucide-react';
import {
  DestructiveButton,
  NumberInput,
  PrimaryButton,
  SecondaryButton,
  SegmentedControl,
  SelectInput,
  TextInput,
  TimeInput12Hour,
} from '../components/ui/Controls';
import { PageHeader } from '../components/ui/DataDisplay';
import { ConfirmationDialog, ErrorBanner } from '../components/ui/Overlays';
import { useWorkspace } from '../context/WorkspaceContext';
import {
  ACCOUNT_TYPE_LABELS,
  AccountType,
  AssetClass,
  ThemeMode,
} from '../domain/enums';
import { COMMON_TIMEZONES, checkTemplatesOverlap, formatTime12Hour } from '../domain/timezone';
import { generateRecordId } from '../domain/validation';
import {
  commitParsedImport,
  exportBackupZip,
  exportCompleteReportCsv,
  exportJsonBundle,
  exportPerformanceMetricsCsv,
  exportSessionsCsv,
  exportTradesCsv,
  exportWorkbookXlsx,
  ImportConflictStrategy,
  ImportCommitReport,
  ParsedImportPackage,
  parseAndValidateImportFile,
  triggerFileDownload,
  WorkspaceExportBundle,
} from '../portability/utds';
import {
  createRecord,
  deleteRecord,
  retryPendingOperation,
  updateRecord,
} from '../storage/repository';
import { downloadServerSnapshotZip } from '../storage/apiClient';
import { removePendingOperation } from '../storage/syncQueue';

type SettingsTab = 'portability' | 'profile' | 'accounts' | 'templates' | 'instruments' | 'diagnostics';

export function SettingsExportPage() {
  const {
    user,
    accounts,
    dailyJournals,
    sessions,
    sessionEvents,
    trades,
    activeTrades,
    tradeEvents,
    tradeGroups,
    attachments,
    sessionTemplates,
    checklists,
    instruments,
    preferences,
    reviews,
    auditLogs,
    pendingOperations,
    errorHistory,
    refreshDiagnostics,
    clearLocalDiagnostics,
    theme,
    setThemeMode,
    changePassword,
    signOutOtherDevices,
  } = useWorkspace();

  const uid = user?.uid ?? '';
  const [tab, setTab] = useState<SettingsTab>('portability');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // --- Tab 1: Portability ---
  const [exportBusy, setExportBusy] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [addingAccount, setAddingAccount] = useState(false);
  const [addingTemplate, setAddingTemplate] = useState(false);
  const [savingLogger, setSavingLogger] = useState(false);
  const [parsedImport, setParsedImport] = useState<ParsedImportPackage | null>(null);
  const [conflictStrategy, setConflictStrategy] = useState<ImportConflictStrategy>('skip');
  const [confirmReplaceOpen, setConfirmReplaceOpen] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [importReport, setImportReport] = useState<ImportCommitReport | null>(null);
  const [retryingOpId, setRetryingOpId] = useState<string | null>(null);

  const exportBundle: WorkspaceExportBundle = useMemo(
    () => ({
      profile: preferences,
      accounts,
      daily_journals: dailyJournals,
      sessions,
      session_events: sessionEvents,
      trades,
      trade_events: tradeEvents,
      trade_groups: tradeGroups,
      reviews,
      settings: preferences,
      templates: sessionTemplates,
      instruments,
      checklists,
      attachments_index: attachments,
    }),
    [
      preferences,
      accounts,
      dailyJournals,
      sessions,
      sessionEvents,
      trades,
      tradeEvents,
      tradeGroups,
      reviews,
      sessionTemplates,
      instruments,
      checklists,
      attachments,
    ]
  );

  const existingIdSets = useMemo(
    () => ({
      accounts: new Set(accounts.map((r) => r.id)),
      daily_journals: new Set(dailyJournals.map((r) => r.id)),
      sessions: new Set(sessions.map((r) => r.id)),
      session_events: new Set(sessionEvents.map((r) => r.id)),
      trades: new Set(trades.map((r) => r.id)),
      trade_events: new Set(tradeEvents.map((r) => r.id)),
      trade_groups: new Set(tradeGroups.map((r) => r.id)),
      reviews: new Set(reviews.map((r) => r.id)),
      templates: new Set(sessionTemplates.map((r) => r.id)),
      instruments: new Set(instruments.map((r) => r.id)),
      checklists: new Set(checklists.map((r) => r.id)),
      attachments: new Set(attachments.map((r) => r.id)),
    }),
    [
      accounts,
      dailyJournals,
      sessions,
      sessionEvents,
      trades,
      tradeEvents,
      tradeGroups,
      reviews,
      sessionTemplates,
      instruments,
      checklists,
      attachments,
    ]
  );

  const handleExportZip = async () => {
    setExportBusy(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const { blob, manifest, warnings } = await exportBackupZip(exportBundle);
      triggerFileDownload(blob, 'ATK_Trading_Backup.zip');
      setStatusMessage(
        `Exported ATK_Trading_Backup.zip (SHA-256: ${manifest.checksumSha256.slice(0, 12)}...)${
          warnings.length > 0 ? ` · Warnings: ${warnings.join(' ')}` : ''
        }`
      );
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'ZIP backup export failed.');
    } finally {
      setExportBusy(false);
    }
  };

  const handleSelectImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorMessage(null);
    setImportReport(null);
    try {
      const parsed = await parseAndValidateImportFile(file, existingIdSets);
      setParsedImport(parsed);
    } catch (err) {
      setParsedImport(null);
      setErrorMessage(err instanceof Error ? err.message : 'Failed to parse backup file.');
    } finally {
      e.target.value = '';
    }
  };

  const executeImportCommit = async () => {
    if (!uid || !parsedImport) return;
    setImportBusy(true);
    setErrorMessage(null);
    try {
      const report = await commitParsedImport(uid, parsedImport, conflictStrategy, existingIdSets);
      setImportReport(report);
      setParsedImport(null);
      setConfirmReplaceOpen(false);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Import failed.');
    } finally {
      setImportBusy(false);
    }
  };

  // --- Tab 2: Profile & Theme ---
  const [displayName, setDisplayName] = useState(preferences?.displayName ?? 'Trader');
  const [deskName, setDeskName] = useState(preferences?.tradingDeskName ?? 'Personal Desk');
  const [tz, setTz] = useState(preferences?.timezone ?? 'Asia/Kolkata');
  const [currency, setCurrency] = useState(preferences?.preferredCurrency ?? 'USD');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const [revokingSessions, setRevokingSessions] = useState(false);

  React.useEffect(() => {
    if (preferences) {
      setDisplayName(preferences.displayName);
      setDeskName(preferences.tradingDeskName);
      setTz(preferences.timezone);
      setCurrency(preferences.preferredCurrency);
      setAntiBiasEnabled(preferences.antiBiasPauseEnabled);
      setAntiBiasSeconds(preferences.antiBiasPauseSeconds);
      setMaxSessionsPerDay(preferences.maxSessionsPerDay);
      setTimeframesText(preferences.timeframes.join(', '));
      setEntryTypesText(preferences.entryTypes.join(', '));
      setSetupLabelsText(preferences.setupLabels.join(', '));
    }
  }, [preferences?.updatedAt]);

  // --- Tab 3: Accounts ---
  const [accName, setAccName] = useState('');
  const [accBroker, setAccBroker] = useState('');
  const [accType, setAccType] = useState<AccountType>('personal');
  const [accCapital, setAccCapital] = useState<number | ''>(10000);
  const [accCurrency, setAccCurrency] = useState('USD');
  const [accRisk, setAccRisk] = useState<number | ''>(1);
  const [accountRiskDrafts, setAccountRiskDrafts] = useState<Record<string, number | ''>>({});
  const [savingAccountRiskId, setSavingAccountRiskId] = useState<string | null>(null);
  const [accountToDelete, setAccountToDelete] = useState<{
    id: string;
    name: string;
    linkedTradesCount: number;
  } | null>(null);
  const [deletingAccountBusy, setDeletingAccountBusy] = useState(false);

  React.useEffect(() => {
    setAccountRiskDrafts((prev) => {
      const next: Record<string, number | ''> = { ...prev };
      for (const acc of accounts) {
        if (!(acc.id in next)) {
          next[acc.id] = acc.defaultRiskPercent;
        }
      }
      return next;
    });
  }, [accounts]);

  // --- Tab 4: Templates & Checklists ---
  const [tplName, setTplName] = useState('');
  const [tplStart, setTplStart] = useState('09:00');
  const [tplEnd, setTplEnd] = useState('11:00');
  const dailyChecklist = checklists.find((c) => c.scope === 'daily');
  const sessionChecklist = checklists.find((c) => c.scope === 'session');
  const [newDailyItem, setNewDailyItem] = useState('');
  const [newSessionItem, setNewSessionItem] = useState('');

  // --- Tab 5: Instruments & Logger ---
  const [newSymbol, setNewSymbol] = useState('');
  const [newAssetClass, setNewAssetClass] = useState<AssetClass>('forex');
  const [antiBiasEnabled, setAntiBiasEnabled] = useState(true);
  const [antiBiasSeconds, setAntiBiasSeconds] = useState<number | ''>(5);
  const [maxSessionsPerDay, setMaxSessionsPerDay] = useState<number | ''>(4);
  const [timeframesText, setTimeframesText] = useState('');
  const [entryTypesText, setEntryTypesText] = useState('');
  const [setupLabelsText, setSetupLabelsText] = useState('');

  const saveProfile = async () => {
    if (!uid || !preferences || savingProfile) return;
    const cleanDisplayName = displayName.trim() || 'Trader';
    const cleanDeskName = deskName.trim();
    const cleanCurrency = currency.trim().toUpperCase() || 'USD';
    if (cleanDisplayName.length > 100) {
      setErrorMessage('Display name must be 100 characters or fewer.');
      return;
    }
    if (cleanDeskName.length > 100) {
      setErrorMessage('Trading desk name must be 100 characters or fewer.');
      return;
    }
    if (cleanCurrency.length < 3 || cleanCurrency.length > 10) {
      setErrorMessage('Preferred currency code must be between 3 and 10 characters (e.g. USD, INR, EUR).');
      return;
    }
    setSavingProfile(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      await updateRecord(
        uid,
        'preferences',
        preferences.id,
        {
          displayName: cleanDisplayName,
          tradingDeskName: cleanDeskName,
          timezone: tz,
          preferredCurrency: cleanCurrency,
        },
        'SettingsProfile'
      );
      setStatusMessage('Profile preferences saved.');
      refreshDiagnostics();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed saving profile.');
      refreshDiagnostics();
    } finally {
      setSavingProfile(false);
    }
  };

  const handleCreateAccount = async () => {
    if (addingAccount) return;
    const cleanName = accName.trim();
    const cleanBroker = accBroker.trim();
    const cleanCurrency = accCurrency.trim().toUpperCase() || 'USD';
    const parsedCapital = accCapital === '' ? 0 : Number(accCapital);
    const parsedRisk = accRisk === '' ? 1 : Number(accRisk);

    if (!uid || !cleanName) {
      setErrorMessage('Account name is required.');
      return;
    }
    if (cleanName.length > 100) {
      setErrorMessage('Account name must be 100 characters or fewer.');
      return;
    }
    if (cleanBroker.length > 100) {
      setErrorMessage('Broker name must be 100 characters or fewer.');
      return;
    }
    if (cleanCurrency.length < 3 || cleanCurrency.length > 10) {
      setErrorMessage('Account currency code must be between 3 and 10 characters (e.g. USD, INR, EUR).');
      return;
    }
    if (!Number.isFinite(parsedCapital) || parsedCapital < 0) {
      setErrorMessage('Starting capital must be a valid non-negative number.');
      return;
    }
    if (!Number.isFinite(parsedRisk) || parsedRisk < 0) {
      setErrorMessage('Default risk % must be a valid non-negative number.');
      return;
    }
    setAddingAccount(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      await createRecord(
        uid,
        'accounts',
        generateRecordId('acc'),
        {
          name: cleanName,
          broker: cleanBroker,
          accountType: accType,
          capital: parsedCapital,
          currency: cleanCurrency,
          defaultRiskPercent: parsedRisk,
          isActive: true,
        },
        'SettingsAccounts'
      );
      setAccName('');
      setAccBroker('');
      setStatusMessage('Trading account added.');
      refreshDiagnostics();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed adding account.');
      refreshDiagnostics();
    } finally {
      setAddingAccount(false);
    }
  };

  const handleAddTemplate = async () => {
    if (!uid || addingTemplate) return;
    if (!tplName.trim()) {
      setErrorMessage('Template name is required.');
      return;
    }
    const candidate = {
      id: generateRecordId('tpl'),
      name: tplName.trim(),
      startTime: tplStart,
      endTime: tplEnd,
      isActive: true,
      sortOrder: sessionTemplates.length + 1,
    };
    const overlapErr = checkTemplatesOverlap([...sessionTemplates, candidate]);
    if (overlapErr) {
      setErrorMessage(overlapErr);
      return;
    }
    setAddingTemplate(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      await createRecord(uid, 'session_templates', candidate.id, candidate, 'SettingsTemplates');
      setTplName('');
      setStatusMessage('Session template created.');
      refreshDiagnostics();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed creating session template.');
      refreshDiagnostics();
    } finally {
      setAddingTemplate(false);
    }
  };

  const handleSaveLoggerConfig = async () => {
    if (!uid || !preferences || savingLogger) return;
    const secs = Math.min(60, Math.max(1, Number(antiBiasSeconds) || 5));
    const maxSes = Math.min(20, Math.max(1, Number(maxSessionsPerDay) || 4));
    setSavingLogger(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      await updateRecord(
        uid,
        'preferences',
        preferences.id,
        {
          antiBiasPauseEnabled: antiBiasEnabled,
          antiBiasPauseSeconds: secs,
          maxSessionsPerDay: maxSes,
          timeframes: timeframesText
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
          entryTypes: entryTypesText
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
          setupLabels: setupLabelsText
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
        },
        'SettingsLogger'
      );
      setStatusMessage('Logger settings saved.');
      refreshDiagnostics();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed saving logger settings.');
      refreshDiagnostics();
    } finally {
      setSavingLogger(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings & Export"
        subtitle="ATK-UTDS v1.0 portability, workspace configuration, trading accounts, and diagnostics."
      />

      <div className="overflow-x-auto pb-1">
        <SegmentedControl
          value={tab}
          onChange={(next) => {
            setTab(next);
            setStatusMessage(null);
            setErrorMessage(null);
          }}
          options={[
            { value: 'portability', label: 'Export, Import & Backup' },
            { value: 'profile', label: 'Profile & Theme' },
            { value: 'accounts', label: 'Trading Accounts' },
            { value: 'templates', label: 'Templates & Checklists' },
            { value: 'instruments', label: 'Instruments & Logger' },
            { value: 'diagnostics', label: 'Error History & Diagnostics' },
          ]}
        />
      </div>

      {statusMessage && (
        <div className="px-4 py-2.5 rounded-lg border border-[var(--positive)]/40 bg-[var(--positive-bg)] text-xs text-[var(--text-primary)]">
          {statusMessage}
        </div>
      )}

      {errorMessage && <ErrorBanner title="Settings Error" message={errorMessage} />}

      {/* TAB 1: EXPORT, IMPORT & BACKUP */}
      {tab === 'portability' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <section className="p-5 rounded-lg bg-[var(--surface)] border border-[var(--border)] space-y-4">
            <div>
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                Export &amp; Full Backup (ATK-UTDS v1.0)
              </h2>
              <p className="text-xs text-[var(--text-muted)] mt-1">
                Download a complete portable archive including manifest, SHA-256 checksum, all
                records, and binary screenshot attachments.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <PrimaryButton type="button" disabled={exportBusy} onClick={handleExportZip}>
                {exportBusy ? 'Packaging ZIP...' : 'Export ATK_Trading_Backup.zip'}
              </PrimaryButton>
              <SecondaryButton
                type="button"
                disabled={exportBusy}
                onClick={async () => {
                  setExportBusy(true);
                  setErrorMessage(null);
                  setStatusMessage(null);
                  try {
                    const blob = await exportJsonBundle(exportBundle);
                    triggerFileDownload(blob, 'ATK_Trading_Export.json');
                    setStatusMessage('Exported ATK_Trading_Export.json.');
                  } catch (err) {
                    setErrorMessage(err instanceof Error ? err.message : 'JSON export failed.');
                  } finally {
                    setExportBusy(false);
                  }
                }}
              >
                Export JSON Bundle
              </SecondaryButton>
              <SecondaryButton
                type="button"
                disabled={exportBusy}
                onClick={() => {
                  setErrorMessage(null);
                  setStatusMessage(null);
                  try {
                    const blob = exportWorkbookXlsx(exportBundle);
                    triggerFileDownload(blob, 'ATK_Trading_Workbook.xlsx');
                    setStatusMessage('Exported ATK_Trading_Workbook.xlsx.');
                  } catch (err) {
                    setErrorMessage(err instanceof Error ? err.message : 'XLSX export failed.');
                  }
                }}
              >
                Export Genuine XLSX
              </SecondaryButton>
              <SecondaryButton
                type="button"
                disabled={exportBusy}
                onClick={async () => {
                  setExportBusy(true);
                  setErrorMessage(null);
                  setStatusMessage(null);
                  try {
                    const blob = await downloadServerSnapshotZip();
                    const dateStamp = new Date().toISOString().slice(0, 10);
                    triggerFileDownload(blob, `ATK_Deck_SQLite_Snapshot_${dateStamp}.zip`);
                    setStatusMessage(
                      `Exported ATK_Deck_SQLite_Snapshot_${dateStamp}.zip (live SQLite database + local uploads).`
                    );
                  } catch (err) {
                    setErrorMessage(
                      err instanceof Error ? err.message : 'SQLite server snapshot export failed.'
                    );
                  } finally {
                    setExportBusy(false);
                  }
                }}
              >
                Export SQLite DB Snapshot
              </SecondaryButton>
            </div>

            <div className="pt-4 border-t border-[var(--border)] space-y-3">
              <div>
                <h3 className="text-xs font-semibold text-[var(--text-primary)]">
                  CSV Data &amp; Performance Export
                </h3>
                <p className="text-[11px] text-[var(--text-muted)] mt-0.5 font-mono-num">
                  Includes {sessions.length} session(s), {activeTrades.length} active trade(s), and
                  full financial, activity, discipline, psychology, and 5-day week metrics.
                </p>
              </div>
              <PrimaryButton
                type="button"
                disabled={exportBusy}
                className="w-full"
                onClick={() => {
                  setErrorMessage(null);
                  setStatusMessage(null);
                  try {
                    const dateStamp = new Date().toISOString().slice(0, 10);
                    const fileName = `ATK_Trading_Complete_Report_${dateStamp}.csv`;
                    const blob = exportCompleteReportCsv(exportBundle);
                    triggerFileDownload(blob, fileName);
                    setStatusMessage(
                      `Exported ${fileName} (${sessions.length} sessions, ${activeTrades.length} active trades, and full performance metrics).`
                    );
                  } catch (err) {
                    setErrorMessage(
                      err instanceof Error ? err.message : 'Complete CSV export failed.'
                    );
                  }
                }}
              >
                Export All Sessions, Trades &amp; Performance Metrics (CSV)
              </PrimaryButton>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <SecondaryButton
                  size="sm"
                  type="button"
                  disabled={exportBusy}
                  onClick={() => {
                    setErrorMessage(null);
                    setStatusMessage(null);
                    try {
                      const blob = exportSessionsCsv(sessions, trades);
                      triggerFileDownload(blob, 'ATK_Sessions.csv');
                      setStatusMessage(`Exported ATK_Sessions.csv (${sessions.length} sessions).`);
                    } catch (err) {
                      setErrorMessage(
                        err instanceof Error ? err.message : 'Sessions CSV export failed.'
                      );
                    }
                  }}
                >
                  Sessions CSV
                </SecondaryButton>
                <SecondaryButton
                  size="sm"
                  type="button"
                  disabled={exportBusy}
                  onClick={() => {
                    setErrorMessage(null);
                    setStatusMessage(null);
                    try {
                      const blob = exportTradesCsv(trades);
                      triggerFileDownload(blob, 'ATK_Trades.csv');
                      setStatusMessage(`Exported ATK_Trades.csv (${activeTrades.length} active trades).`);
                    } catch (err) {
                      setErrorMessage(
                        err instanceof Error ? err.message : 'Trades CSV export failed.'
                      );
                    }
                  }}
                >
                  Trades CSV
                </SecondaryButton>
                <SecondaryButton
                  size="sm"
                  type="button"
                  disabled={exportBusy}
                  onClick={() => {
                    setErrorMessage(null);
                    setStatusMessage(null);
                    try {
                      const blob = exportPerformanceMetricsCsv(exportBundle);
                      triggerFileDownload(blob, 'ATK_Performance_Metrics.csv');
                      setStatusMessage('Exported ATK_Performance_Metrics.csv.');
                    } catch (err) {
                      setErrorMessage(
                        err instanceof Error ? err.message : 'Performance Metrics CSV export failed.'
                      );
                    }
                  }}
                >
                  Performance Metrics CSV
                </SecondaryButton>
              </div>
            </div>
          </section>

          <section className="p-5 rounded-lg bg-[var(--surface)] border border-[var(--border)] space-y-4">
            <div>
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                Import &amp; Restore
              </h2>
              <p className="text-xs text-[var(--text-muted)] mt-1">
                Select an ATK_Trading_Backup.zip or ATK-UTDS JSON file. Records are validated,
                checksum-verified, and previewed before committing.
              </p>
            </div>

            <input
              type="file"
              accept=".zip,.json"
              onChange={handleSelectImportFile}
              className="block w-full text-xs text-[var(--text-secondary)]"
            />

            {parsedImport && (
              <div className="p-4 rounded-lg bg-[var(--subtle-surface)] border border-[var(--border)] space-y-3 text-xs">
                <div className="font-semibold text-[var(--text-primary)]">
                  Archive Preview · {parsedImport.manifest.formatName} v
                  {parsedImport.manifest.formatVersion}
                </div>
                <div className="font-mono-num space-y-1 text-[var(--text-secondary)]">
                  <div>
                    Checksum:{' '}
                    <span
                      className={
                        parsedImport.checksumValid
                          ? 'text-[var(--positive)]'
                          : 'text-[var(--negative)]'
                      }
                    >
                      {parsedImport.checksumValid ? 'VERIFIED' : 'MISMATCH'}
                    </span>
                  </div>
                  {!parsedImport.checksumValid && (
                    <div className="text-[var(--negative)]">
                      Warning: Archive SHA-256 checksum does not match manifest. File may be edited
                      or corrupted.
                    </div>
                  )}
                  <div>
                    Records: {parsedImport.totalRecords} · Attachments:{' '}
                    {parsedImport.attachmentBlobs.size} · Duplicate IDs:{' '}
                    {parsedImport.totalDuplicates}
                  </div>
                </div>

                <SelectInput
                  label="Duplicate Conflict Strategy"
                  value={conflictStrategy}
                  onChange={(v) => setConflictStrategy(v as ImportConflictStrategy)}
                  options={[
                    { value: 'skip', label: 'Skip Existing (Safe Default)' },
                    { value: 'copy', label: 'Import as Separate Copy' },
                    { value: 'replace', label: 'Replace Existing (Requires Confirmation)' },
                  ]}
                />

                <PrimaryButton
                  type="button"
                  disabled={importBusy}
                  onClick={() => {
                    if (conflictStrategy === 'replace' && parsedImport.totalDuplicates > 0) {
                      setConfirmReplaceOpen(true);
                    } else {
                      void executeImportCommit();
                    }
                  }}
                >
                  {importBusy ? 'Importing...' : 'Confirm & Import Archive'}
                </PrimaryButton>
              </div>
            )}

            {importReport && (
              <div className="p-3 rounded-lg border border-[var(--positive)]/40 bg-[var(--positive-bg)] text-xs font-mono-num space-y-1">
                <div>
                  Import complete: Created {importReport.created} · Copied {importReport.copied} ·
                  Replaced {importReport.replaced} · Skipped {importReport.skipped} · Attachments{' '}
                  {importReport.attachmentsRestored}
                </div>
                {importReport.errors.length > 0 && (
                  <div className="text-[var(--negative)]">{importReport.errors.join(' ')}</div>
                )}
              </div>
            )}
          </section>
        </div>
      )}

      {/* TAB 2: PROFILE & THEME */}
      {tab === 'profile' && (
        <div className="space-y-6 max-w-2xl">
          <section className="p-5 rounded-lg bg-[var(--surface)] border border-[var(--border)] space-y-4">
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">Profile &amp; Theme</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <TextInput
                label="Display Name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
              <TextInput
                label="Trading Desk Name"
                value={deskName}
                onChange={(e) => setDeskName(e.target.value)}
              />
              <SelectInput
                label="Timezone"
                value={tz}
                onChange={setTz}
                options={COMMON_TIMEZONES.map((z) => ({ value: z, label: z }))}
              />
              <TextInput
                label="Preferred Currency"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <span className="text-xs font-medium text-[var(--text-secondary)]">Theme</span>
              <div>
                <SegmentedControl
                  value={theme}
                  onChange={(t) => void setThemeMode(t as ThemeMode)}
                  options={[
                    { value: 'light', label: 'Light' },
                    { value: 'dark', label: 'Dark' },
                    { value: 'system', label: 'System' },
                  ]}
                />
              </div>
            </div>
            <PrimaryButton type="button" disabled={savingProfile} onClick={saveProfile}>
              {savingProfile ? 'Saving...' : 'Save Profile'}
            </PrimaryButton>
          </section>

          <section className="p-5 rounded-lg bg-[var(--surface)] border border-[var(--border)] space-y-4">
            <div>
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                Account Security
              </h2>
              <p className="text-xs text-[var(--text-muted)] mt-1 font-mono-num">
                Signed in as {user?.username} ({user?.email})
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <TextInput
                label="Current Password"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                autoComplete="current-password"
              />
              <TextInput
                label="New Password (min 8)"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
              />
              <TextInput
                label="Confirm New Password"
                type="password"
                value={confirmNewPassword}
                onChange={(e) => setConfirmNewPassword(e.target.value)}
                autoComplete="new-password"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2.5">
              <PrimaryButton
                type="button"
                disabled={changingPassword}
                onClick={async () => {
                  setErrorMessage(null);
                  setStatusMessage(null);
                  if (!currentPassword || !newPassword) {
                    setErrorMessage('Please enter your current and new password.');
                    return;
                  }
                  if (newPassword.length < 8) {
                    setErrorMessage('New password must be at least 8 characters.');
                    return;
                  }
                  if (newPassword !== confirmNewPassword) {
                    setErrorMessage('New password confirmation does not match.');
                    return;
                  }
                  setChangingPassword(true);
                  try {
                    await changePassword(currentPassword, newPassword, true);
                    setCurrentPassword('');
                    setNewPassword('');
                    setConfirmNewPassword('');
                    setStatusMessage('Password updated and other device sessions signed out.');
                  } catch (err) {
                    setErrorMessage(
                      err instanceof Error ? err.message : 'Failed updating password.'
                    );
                  } finally {
                    setChangingPassword(false);
                  }
                }}
              >
                {changingPassword ? 'Updating Password...' : 'Update Password'}
              </PrimaryButton>
              <SecondaryButton
                type="button"
                disabled={revokingSessions}
                onClick={async () => {
                  setRevokingSessions(true);
                  setErrorMessage(null);
                  setStatusMessage(null);
                  try {
                    await signOutOtherDevices();
                    setStatusMessage('All other active sessions have been signed out.');
                  } catch (err) {
                    setErrorMessage(
                      err instanceof Error ? err.message : 'Failed revoking other sessions.'
                    );
                  } finally {
                    setRevokingSessions(false);
                  }
                }}
              >
                {revokingSessions ? 'Signing Out...' : 'Sign Out Other Devices'}
              </SecondaryButton>
            </div>
          </section>
        </div>
      )}

      {/* TAB 3: TRADING ACCOUNTS */}
      {tab === 'accounts' && (
        <div className="space-y-6">
          <section className="p-5 rounded-lg bg-[var(--surface)] border border-[var(--border)] space-y-4">
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">Add Trading Account</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <TextInput
                label="Account Name"
                value={accName}
                onChange={(e) => setAccName(e.target.value)}
                placeholder="e.g. FTMO 100k"
              />
              <TextInput
                label="Broker"
                value={accBroker}
                onChange={(e) => setAccBroker(e.target.value)}
              />
              <SelectInput
                label="Account Type"
                value={accType}
                onChange={(v) => setAccType(v as AccountType)}
                options={(Object.keys(ACCOUNT_TYPE_LABELS) as AccountType[]).map((k) => ({
                  value: k,
                  label: ACCOUNT_TYPE_LABELS[k],
                }))}
              />
              <NumberInput label="Capital" value={accCapital} onChange={setAccCapital} />
              <TextInput
                label="Currency"
                value={accCurrency}
                onChange={(e) => setAccCurrency(e.target.value)}
              />
              <NumberInput label="Default Risk %" value={accRisk} onChange={setAccRisk} />
            </div>
            <PrimaryButton type="button" disabled={addingAccount} onClick={handleCreateAccount}>
              {addingAccount ? 'Adding...' : 'Add Account'}
            </PrimaryButton>
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">
              Configured Accounts ({accounts.length})
            </h2>
            <div className="divide-y divide-[var(--border)] border border-[var(--border)] rounded-lg bg-[var(--surface)] text-xs">
              {accounts.map((acc) => {
                const draftRisk =
                  acc.id in accountRiskDrafts ? accountRiskDrafts[acc.id] : acc.defaultRiskPercent;
                const isChanged = draftRisk !== '' && Number(draftRisk) !== acc.defaultRiskPercent;
                return (
                  <div
                    key={acc.id}
                    className="px-4 py-3 flex flex-wrap items-center justify-between gap-3"
                  >
                    <div>
                      <div className="font-semibold text-[var(--text-primary)]">{acc.name}</div>
                      <div className="text-[var(--text-muted)] font-mono-num">
                        {acc.broker || 'No broker'} · {ACCOUNT_TYPE_LABELS[acc.accountType]} ·{' '}
                        {acc.capital.toLocaleString()} {acc.currency} · Default Risk{' '}
                        {acc.defaultRiskPercent}%
                      </div>
                    </div>
                    <div className="flex flex-wrap items-end gap-2">
                      <div className="w-28">
                        <NumberInput
                          label="Default Risk %"
                          min={0}
                          value={draftRisk}
                          onChange={(val) =>
                            setAccountRiskDrafts((prev) => ({ ...prev, [acc.id]: val }))
                          }
                        />
                      </div>
                      <SecondaryButton
                        size="sm"
                        type="button"
                        disabled={
                          savingAccountRiskId === acc.id ||
                          draftRisk === '' ||
                          Number(draftRisk) < 0 ||
                          !isChanged
                        }
                        onClick={async () => {
                          if (!uid || draftRisk === '' || Number(draftRisk) < 0) return;
                          setSavingAccountRiskId(acc.id);
                          setErrorMessage(null);
                          setStatusMessage(null);
                          try {
                            await updateRecord(
                              uid,
                              'accounts',
                              acc.id,
                              { defaultRiskPercent: Number(draftRisk) },
                              'SettingsAccounts'
                            );
                            setStatusMessage(
                              `Default Risk % updated to ${Number(draftRisk)}% for ${acc.name}.`
                            );
                            refreshDiagnostics();
                          } catch (err) {
                            setErrorMessage(
                              err instanceof Error ? err.message : 'Failed updating default risk.'
                            );
                            refreshDiagnostics();
                          } finally {
                            setSavingAccountRiskId(null);
                          }
                        }}
                      >
                        {savingAccountRiskId === acc.id ? 'Saving...' : 'Save Risk'}
                      </SecondaryButton>
                      <SecondaryButton
                        size="sm"
                        type="button"
                        onClick={async () => {
                          setErrorMessage(null);
                          try {
                            await updateRecord(
                              uid,
                              'accounts',
                              acc.id,
                              { isActive: !acc.isActive },
                              'SettingsAccounts'
                            );
                            refreshDiagnostics();
                          } catch (err) {
                            setErrorMessage(err instanceof Error ? err.message : 'Failed updating account.');
                            refreshDiagnostics();
                          }
                        }}
                      >
                        {acc.isActive ? 'Active' : 'Inactive'}
                      </SecondaryButton>
                      <DestructiveButton
                        size="sm"
                        type="button"
                        aria-label={`Remove account ${acc.name}`}
                        onClick={() => {
                          const linkedTradesCount = trades.filter((t) => t.accountId === acc.id).length;
                          setAccountToDelete({
                            id: acc.id,
                            name: acc.name,
                            linkedTradesCount,
                          });
                        }}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Remove
                      </DestructiveButton>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      )}

      {/* TAB 4: TEMPLATES & CHECKLISTS */}
      {tab === 'templates' && (
        <div className="space-y-6">
          <section className="p-5 rounded-lg bg-[var(--surface)] border border-[var(--border)] space-y-4">
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">
              Session Templates (Half-Open Intervals [start, end), Non-Overlapping)
            </h2>
            <div className="divide-y divide-[var(--border)] border border-[var(--border)] rounded-lg text-xs">
              {sessionTemplates.map((tpl) => (
                <div key={tpl.id} className="px-4 py-2.5 flex items-center justify-between gap-3">
                  <div>
                    <span className="font-semibold">{tpl.name}</span>{' '}
                    <span className="font-mono-num text-[var(--text-muted)]">
                      {formatTime12Hour(tpl.startTime)} – {formatTime12Hour(tpl.endTime)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <SecondaryButton
                      size="sm"
                      type="button"
                      onClick={async () => {
                        setErrorMessage(null);
                        try {
                          await updateRecord(
                            uid,
                            'session_templates',
                            tpl.id,
                            { isActive: !tpl.isActive },
                            'SettingsTemplates'
                          );
                          refreshDiagnostics();
                        } catch (err) {
                          setErrorMessage(
                            err instanceof Error ? err.message : 'Failed updating template.'
                          );
                          refreshDiagnostics();
                        }
                      }}
                    >
                      {tpl.isActive ? 'Active' : 'Inactive'}
                    </SecondaryButton>
                    <button
                      type="button"
                      onClick={async () => {
                        setErrorMessage(null);
                        try {
                          await deleteRecord(uid, 'session_templates', tpl.id, 'SettingsTemplates');
                        } catch (err) {
                          setErrorMessage(
                            err instanceof Error ? err.message : 'Failed deleting template.'
                          );
                          refreshDiagnostics();
                        }
                      }}
                      className="p-1 text-[var(--negative)] cursor-pointer"
                      aria-label="Delete template"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
              <TextInput
                label="Template Name"
                value={tplName}
                onChange={(e) => setTplName(e.target.value)}
                placeholder="e.g. Pre-London"
              />
              <TimeInput12Hour
                label="Start Time"
                value={tplStart}
                onChange={setTplStart}
              />
              <TimeInput12Hour
                label="End Time"
                value={tplEnd}
                onChange={setTplEnd}
              />
              <PrimaryButton type="button" disabled={addingTemplate} onClick={handleAddTemplate}>
                {addingTemplate ? 'Adding...' : 'Add Template'}
              </PrimaryButton>
            </div>
          </section>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Independent Daily Checklist */}
            <section className="p-5 rounded-lg bg-[var(--surface)] border border-[var(--border)] space-y-3">
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                Daily Checklist Defaults
              </h3>
              <ul className="divide-y divide-[var(--border)] border border-[var(--border)] rounded-lg text-xs">
                {(dailyChecklist?.items ?? []).map((item, idx) => (
                  <li key={`${item}-${idx}`} className="px-3 py-2 flex items-center justify-between">
                    <span>{item}</span>
                    <button
                      type="button"
                      onClick={async () => {
                        if (!dailyChecklist) return;
                        const next = dailyChecklist.items.filter((_, i) => i !== idx);
                        setErrorMessage(null);
                        try {
                          await updateRecord(uid, 'checklists', dailyChecklist.id, { items: next }, 'Checklists');
                          refreshDiagnostics();
                        } catch (err) {
                          setErrorMessage(
                            err instanceof Error ? err.message : 'Failed updating daily checklist.'
                          );
                          refreshDiagnostics();
                        }
                      }}
                      className="text-[var(--negative)] hover:underline cursor-pointer"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
              <div className="flex gap-2">
                <TextInput
                  value={newDailyItem}
                  onChange={(e) => setNewDailyItem(e.target.value)}
                  placeholder="Add daily checklist item..."
                />
                <SecondaryButton
                  size="sm"
                  type="button"
                  onClick={async () => {
                    if (!dailyChecklist || !newDailyItem.trim()) return;
                    const next = [...dailyChecklist.items, newDailyItem.trim()];
                    setErrorMessage(null);
                    try {
                      await updateRecord(uid, 'checklists', dailyChecklist.id, { items: next }, 'Checklists');
                      setNewDailyItem('');
                      refreshDiagnostics();
                    } catch (err) {
                      setErrorMessage(
                        err instanceof Error ? err.message : 'Failed adding daily checklist item.'
                      );
                      refreshDiagnostics();
                    }
                  }}
                >
                  Add
                </SecondaryButton>
              </div>
            </section>

            {/* Independent Session Checklist */}
            <section className="p-5 rounded-lg bg-[var(--surface)] border border-[var(--border)] space-y-3">
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                Session Checklist Defaults
              </h3>
              <ul className="divide-y divide-[var(--border)] border border-[var(--border)] rounded-lg text-xs">
                {(sessionChecklist?.items ?? []).map((item, idx) => (
                  <li key={`${item}-${idx}`} className="px-3 py-2 flex items-center justify-between">
                    <span>{item}</span>
                    <button
                      type="button"
                      onClick={async () => {
                        if (!sessionChecklist) return;
                        const next = sessionChecklist.items.filter((_, i) => i !== idx);
                        setErrorMessage(null);
                        try {
                          await updateRecord(uid, 'checklists', sessionChecklist.id, { items: next }, 'Checklists');
                          refreshDiagnostics();
                        } catch (err) {
                          setErrorMessage(
                            err instanceof Error ? err.message : 'Failed updating session checklist.'
                          );
                          refreshDiagnostics();
                        }
                      }}
                      className="text-[var(--negative)] hover:underline cursor-pointer"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
              <div className="flex gap-2">
                <TextInput
                  value={newSessionItem}
                  onChange={(e) => setNewSessionItem(e.target.value)}
                  placeholder="Add session checklist item..."
                />
                <SecondaryButton
                  size="sm"
                  type="button"
                  onClick={async () => {
                    if (!sessionChecklist || !newSessionItem.trim()) return;
                    const next = [...sessionChecklist.items, newSessionItem.trim()];
                    setErrorMessage(null);
                    try {
                      await updateRecord(uid, 'checklists', sessionChecklist.id, { items: next }, 'Checklists');
                      setNewSessionItem('');
                      refreshDiagnostics();
                    } catch (err) {
                      setErrorMessage(
                        err instanceof Error ? err.message : 'Failed adding session checklist item.'
                      );
                      refreshDiagnostics();
                    }
                  }}
                >
                  Add
                </SecondaryButton>
              </div>
            </section>
          </div>
        </div>
      )}

      {/* TAB 5: INSTRUMENTS & LOGGER */}
      {tab === 'instruments' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <section className="p-5 rounded-lg bg-[var(--surface)] border border-[var(--border)] space-y-4">
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">
              Instruments ({instruments.length})
            </h2>
            <div className="flex flex-wrap gap-2">
              {instruments.map((inst) => (
                <button
                  key={inst.id}
                  type="button"
                  onClick={async () => {
                    setErrorMessage(null);
                    try {
                      await updateRecord(
                        uid,
                        'instruments',
                        inst.id,
                        { isActive: !inst.isActive },
                        'SettingsInstruments'
                      );
                      refreshDiagnostics();
                    } catch (err) {
                      setErrorMessage(
                        err instanceof Error ? err.message : 'Failed updating instrument.'
                      );
                      refreshDiagnostics();
                    }
                  }}
                  className={`h-8 px-3 rounded-lg border text-xs font-mono-num cursor-pointer ${
                    inst.isActive
                      ? 'bg-[var(--surface)] text-[var(--text-primary)] border-[var(--border)]'
                      : 'bg-[var(--subtle-surface)] text-[var(--text-muted)] border-[var(--border)] line-through'
                  }`}
                >
                  {inst.symbol}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 items-end">
              <TextInput
                label="Custom Symbol"
                value={newSymbol}
                onChange={(e) => setNewSymbol(e.target.value)}
                placeholder="e.g. NAS100"
              />
              <SelectInput
                label="Asset Class"
                value={newAssetClass}
                onChange={(v) => setNewAssetClass(v as AssetClass)}
                options={[
                  { value: 'forex', label: 'Forex' },
                  { value: 'metals', label: 'Metals' },
                  { value: 'crypto', label: 'Crypto' },
                  { value: 'indices', label: 'Indices' },
                  { value: 'equities', label: 'Equities' },
                  { value: 'commodities', label: 'Commodities' },
                  { value: 'other', label: 'Other' },
                ]}
              />
              <PrimaryButton
                type="button"
                onClick={async () => {
                  const sym = newSymbol.trim().toUpperCase();
                  if (!uid || !sym) return;
                  setErrorMessage(null);
                  try {
                    await createRecord(
                      uid,
                      'instruments',
                      generateRecordId('inst'),
                      { symbol: sym, assetClass: newAssetClass, isActive: true },
                      'SettingsInstruments'
                    );
                    setNewSymbol('');
                    setStatusMessage(`Instrument ${sym} added.`);
                    refreshDiagnostics();
                  } catch (err) {
                    setErrorMessage(
                      err instanceof Error ? err.message : 'Failed adding instrument.'
                    );
                    refreshDiagnostics();
                  }
                }}
              >
                Add Instrument
              </PrimaryButton>
            </div>
          </section>

          <section className="p-5 rounded-lg bg-[var(--surface)] border border-[var(--border)] space-y-4">
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">
              Logger &amp; Anti-Bias Settings
            </h2>
            <label className="flex items-center gap-2 text-xs text-[var(--text-primary)] cursor-pointer">
              <input
                type="checkbox"
                checked={antiBiasEnabled}
                onChange={(e) => setAntiBiasEnabled(e.target.checked)}
              />
              <span>Enable Anti-Bias Pause before opening trades</span>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <NumberInput
                label="Anti-Bias Pause (1-60s)"
                min={1}
                max={60}
                value={antiBiasSeconds}
                onChange={setAntiBiasSeconds}
              />
              <NumberInput
                label="Max Sessions Per Day"
                min={1}
                max={20}
                value={maxSessionsPerDay}
                onChange={setMaxSessionsPerDay}
              />
            </div>
            <TextInput
              label="Timeframes (comma-separated)"
              value={timeframesText}
              onChange={(e) => setTimeframesText(e.target.value)}
            />
            <TextInput
              label="Entry Types (comma-separated)"
              value={entryTypesText}
              onChange={(e) => setEntryTypesText(e.target.value)}
            />
            <TextInput
              label="Setup Labels (comma-separated)"
              value={setupLabelsText}
              onChange={(e) => setSetupLabelsText(e.target.value)}
            />
            <PrimaryButton type="button" disabled={savingLogger} onClick={handleSaveLoggerConfig}>
              {savingLogger ? 'Saving...' : 'Save Logger Settings'}
            </PrimaryButton>
          </section>
        </div>
      )}

      {/* TAB 6: ERROR HISTORY & DIAGNOSTICS */}
      {tab === 'diagnostics' && (
        <div className="space-y-6">
          <section className="p-5 rounded-lg bg-[var(--surface)] border border-[var(--border)] space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                Pending Operation Queue ({pendingOperations.length})
              </h2>
              <SecondaryButton size="sm" type="button" onClick={refreshDiagnostics}>
                Refresh
              </SecondaryButton>
            </div>
            {pendingOperations.length === 0 ? (
              <p className="text-xs text-[var(--text-muted)]">No pending or failed operations in local queue.</p>
            ) : (
              <div className="divide-y divide-[var(--border)] border border-[var(--border)] rounded-lg text-xs">
                {pendingOperations.map((op) => (
                  <div key={op.operationId} className="p-3 space-y-1">
                    <div className="flex items-center justify-between gap-2 font-mono-num">
                      <span className="font-semibold">
                        {op.operationType} · {op.recordId}
                      </span>
                      <div className="flex items-center gap-2">
                        <span>{op.status}</span>
                        {op.status !== 'Synced' && (
                          <SecondaryButton
                            size="sm"
                            type="button"
                            disabled={retryingOpId === op.operationId}
                            onClick={async () => {
                              if (!uid) return;
                              setRetryingOpId(op.operationId);
                              setErrorMessage(null);
                              setStatusMessage(null);
                              try {
                                await retryPendingOperation(uid, op);
                                setStatusMessage(`Retried ${op.operationType} (${op.recordId}) successfully.`);
                                refreshDiagnostics();
                              } catch (err) {
                                const msg =
                                  err instanceof Error
                                    ? err.message
                                    : typeof err === 'object' &&
                                      err !== null &&
                                      'userMessage' in err &&
                                      typeof (err as { userMessage?: unknown }).userMessage === 'string'
                                    ? (err as { userMessage: string }).userMessage
                                    : `Retry failed for ${op.operationId}.`;
                                setErrorMessage(msg);
                                refreshDiagnostics();
                              } finally {
                                setRetryingOpId(null);
                              }
                            }}
                          >
                            {retryingOpId === op.operationId ? 'Retrying...' : 'Retry'}
                          </SecondaryButton>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            if (!uid) return;
                            removePendingOperation(uid, op.operationId);
                            refreshDiagnostics();
                          }}
                          className="text-[var(--text-muted)] hover:text-[var(--negative)] cursor-pointer"
                        >
                          Dismiss
                        </button>
                      </div>
                    </div>
                    <div className="text-[var(--text-muted)] font-mono-num">
                      Op ID: {op.operationId} · Retries: {op.retryCount}
                    </div>
                    {op.lastError && (
                      <div className="text-[var(--negative)]">
                        {op.lastError.errorCategory} ({op.lastError.firebaseErrorCode}):{' '}
                        {op.lastError.userMessage}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="p-5 rounded-lg bg-[var(--surface)] border border-[var(--border)] space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                Error History ({errorHistory.length} local · {auditLogs.length} server)
              </h2>
              <SecondaryButton size="sm" type="button" onClick={clearLocalDiagnostics}>
                Clear Local Error Log
              </SecondaryButton>
            </div>
            {errorHistory.length === 0 ? (
              <p className="text-xs text-[var(--text-muted)]">No errors recorded.</p>
            ) : (
              <div className="divide-y divide-[var(--border)] border border-[var(--border)] rounded-lg text-xs">
                {errorHistory.map((err, idx) => (
                  <div key={`${err.operationId}-${idx}`} className="p-3 space-y-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold text-[var(--negative)]">
                        {err.errorCategory.toUpperCase()} · {err.firebaseErrorCode}
                      </span>
                      <span className="font-mono-num text-[var(--text-muted)]">{err.timestamp}</span>
                    </div>
                    <div className="font-mono-num text-[11px] text-[var(--text-secondary)]">
                      Module: {err.module} · Op: {err.operationType} ({err.operationId}) · Path:{' '}
                      {err.documentPath}
                    </div>
                    <p className="text-[var(--text-primary)]">{err.userMessage}</p>
                    <div className="text-[var(--text-muted)]">
                      Local: {err.localSaveStatus} · Cloud: {err.cloudSaveStatus} · Retry Safe:{' '}
                      {err.retrySafe ? 'Yes' : 'No'} · Action: {err.recommendedAction}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      <ConfirmationDialog
        open={confirmReplaceOpen}
        onCancel={() => setConfirmReplaceOpen(false)}
        onConfirm={executeImportCommit}
        title="Confirm Replace Existing Records"
        message={`This import contains ${parsedImport?.totalDuplicates ?? 0} duplicate record ID(s). Choosing Replace Existing will overwrite matching records in your database. Proceed?`}
        confirmLabel="Replace & Import"
        destructive
        busy={importBusy}
      />

      <ConfirmationDialog
        open={Boolean(accountToDelete)}
        onCancel={() => setAccountToDelete(null)}
        onConfirm={async () => {
          if (!uid || !accountToDelete) return;
          setDeletingAccountBusy(true);
          setErrorMessage(null);
          setStatusMessage(null);
          try {
            await deleteRecord(uid, 'accounts', accountToDelete.id, 'SettingsAccounts');
            setStatusMessage(`Removed trading account "${accountToDelete.name}".`);
            setAccountToDelete(null);
            refreshDiagnostics();
          } catch (err) {
            setErrorMessage(err instanceof Error ? err.message : 'Failed removing trading account.');
            setAccountToDelete(null);
            refreshDiagnostics();
          } finally {
            setDeletingAccountBusy(false);
          }
        }}
        title="Remove Trading Account?"
        message={
          accountToDelete
            ? accountToDelete.linkedTradesCount > 0
              ? `Permanently remove "${accountToDelete.name}" from your trading accounts? Your ${accountToDelete.linkedTradesCount} existing trade record(s) will keep their stored account name.`
              : `Permanently remove "${accountToDelete.name}" from your trading accounts?`
            : ''
        }
        confirmLabel="Remove Account"
        destructive
        busy={deletingAccountBusy}
      />
    </div>
  );
}
