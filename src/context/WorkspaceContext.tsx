import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_CURRENCY,
  DEFAULT_TIMEZONE,
  ThemeMode,
} from '../domain/enums';
import {
  AppErrorDiagnostic,
  AttachmentMeta,
  AuditLogEntry,
  ChecklistConfig,
  DailyJournal,
  InstrumentConfig,
  PendingOperation,
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
import {
  ApiRequestError,
  AuthUser,
  changePasswordApi,
  fetchAuthStatus,
  fetchWorkspaceBootstrap,
  loginWithPasswordApi,
  logoutAllOtherSessionsApi,
  logoutApi,
  onLocalWorkspaceSync,
  setupAccountApi,
} from '../storage/apiClient';
import { updateRecord } from '../storage/repository';
import {
  clearErrorHistory,
  getErrorHistory,
  getPendingOperations,
} from '../storage/syncQueue';

interface WorkspaceContextValue {
  user: AuthUser | null;
  authLoading: boolean;
  authInitialized: boolean;
  registrationOpen: boolean;
  authError: string | null;
  signInWithPassword: (identifier: string, password: string) => Promise<void>;
  setupOwnerAccount: (input: {
    username: string;
    email: string;
    displayName: string;
    password: string;
  }) => Promise<void>;
  changePassword: (
    currentPassword: string,
    newPassword: string,
    revokeOtherSessions?: boolean
  ) => Promise<void>;
  signOutOtherDevices: () => Promise<void>;
  signOutUser: () => Promise<void>;
  refreshWorkspace: () => Promise<void>;
  dataLoading: boolean;
  syncError: string | null;
  dismissSyncError: () => void;
  accounts: TradingAccount[];
  dailyJournals: DailyJournal[];
  sessions: TradingSession[];
  sessionEvents: SessionEvent[];
  trades: Trade[];
  activeTrades: Trade[];
  deletedTrades: Trade[];
  tradeEvents: TradeEvent[];
  tradeGroups: TradeGroup[];
  attachments: AttachmentMeta[];
  sessionTemplates: SessionTemplate[];
  checklists: ChecklistConfig[];
  instruments: InstrumentConfig[];
  preferences: UserProfilePreferences | null;
  reviews: TradingReview[];
  auditLogs: AuditLogEntry[];
  pendingOperations: PendingOperation[];
  errorHistory: AppErrorDiagnostic[];
  refreshDiagnostics: () => void;
  clearLocalDiagnostics: () => void;
  theme: ThemeMode;
  setThemeMode: (theme: ThemeMode) => Promise<void>;
  timezone: string;
  preferredCurrency: string;
  liveSession: TradingSession | null;
  openTrades: Trade[];
}

const WorkspaceContext = createContext<WorkspaceContextValue | undefined>(undefined);

function applyThemeToDocument(theme: ThemeMode) {
  const root = document.documentElement;
  const prefersDark =
    typeof window !== 'undefined' &&
    window.matchMedia &&
    window.matchMedia('(prefers-color-scheme: dark)').matches;
  const isDark = theme === 'dark' || (theme === 'system' && prefersDark);
  root.classList.toggle('dark', isDark);
}

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authInitialized, setAuthInitialized] = useState(true);
  const [registrationOpen, setRegistrationOpen] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [dataLoading, setDataLoading] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  const [accounts, setAccounts] = useState<TradingAccount[]>([]);
  const [dailyJournals, setDailyJournals] = useState<DailyJournal[]>([]);
  const [sessions, setSessions] = useState<TradingSession[]>([]);
  const [sessionEvents, setSessionEvents] = useState<SessionEvent[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [tradeEvents, setTradeEvents] = useState<TradeEvent[]>([]);
  const [tradeGroups, setTradeGroups] = useState<TradeGroup[]>([]);
  const [attachments, setAttachments] = useState<AttachmentMeta[]>([]);
  const [sessionTemplates, setSessionTemplates] = useState<SessionTemplate[]>([]);
  const [checklists, setChecklists] = useState<ChecklistConfig[]>([]);
  const [instruments, setInstruments] = useState<InstrumentConfig[]>([]);
  const [preferencesList, setPreferencesList] = useState<UserProfilePreferences[]>([]);
  const [reviews, setReviews] = useState<TradingReview[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);

  const [pendingOperations, setPendingOperations] = useState<PendingOperation[]>([]);
  const [errorHistory, setErrorHistory] = useState<AppErrorDiagnostic[]>([]);
  const [localTheme, setLocalTheme] = useState<ThemeMode>('light');

  const preferences = useMemo(
    () => preferencesList.find((p) => p.id === 'default') ?? preferencesList[0] ?? null,
    [preferencesList]
  );

  const theme: ThemeMode = preferences?.theme ?? localTheme;

  useEffect(() => {
    applyThemeToDocument(theme);
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const listener = () => applyThemeToDocument('system');
    mq.addEventListener('change', listener);
    return () => mq.removeEventListener('change', listener);
  }, [theme]);

  // Check current session cookie on startup
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const status = await fetchAuthStatus();
        if (cancelled) return;
        setAuthInitialized(status.initialized);
        setRegistrationOpen(status.registrationOpen);
        setUser(status.user);
        setAuthError(null);
      } catch (err) {
        if (!cancelled) {
          setAuthError(
            err instanceof Error ? err.message : 'Unable to reach ATK Deck server.'
          );
        }
      } finally {
        if (!cancelled) setAuthLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshDiagnostics = useCallback(() => {
    if (!user?.uid) return;
    setPendingOperations(getPendingOperations(user.uid));
    setErrorHistory(getErrorHistory(user.uid));
  }, [user?.uid]);

  const clearLocalDiagnostics = useCallback(() => {
    if (!user?.uid) return;
    clearErrorHistory(user.uid);
    refreshDiagnostics();
  }, [user?.uid, refreshDiagnostics]);

  const applyBootstrapCollections = useCallback((cols: Record<string, unknown[]>) => {
    setAccounts((cols.accounts ?? []) as TradingAccount[]);
    setDailyJournals((cols.daily_journals ?? []) as DailyJournal[]);
    setSessions((cols.sessions ?? []) as TradingSession[]);
    setSessionEvents((cols.session_events ?? []) as SessionEvent[]);
    setTrades((cols.trades ?? []) as Trade[]);
    setTradeEvents((cols.trade_events ?? []) as TradeEvent[]);
    setTradeGroups((cols.trade_groups ?? []) as TradeGroup[]);
    setAttachments((cols.attachments ?? []) as AttachmentMeta[]);
    const tpls = (cols.session_templates ?? []) as SessionTemplate[];
    setSessionTemplates([...tpls].sort((a, b) => a.sortOrder - b.sortOrder));
    setChecklists((cols.checklists ?? []) as ChecklistConfig[]);
    setInstruments((cols.instruments ?? []) as InstrumentConfig[]);
    setPreferencesList((cols.preferences ?? []) as UserProfilePreferences[]);
    setReviews((cols.reviews ?? []) as TradingReview[]);
    setAuditLogs((cols.audit_logs ?? []) as AuditLogEntry[]);
  }, []);

  const refreshWorkspace = useCallback(async () => {
    if (!user?.uid) return;
    try {
      const res = await fetchWorkspaceBootstrap();
      applyBootstrapCollections(res.collections);
      setSyncError(null);
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 401) {
        setAuthError('Your session expired or was signed out. Please sign in again.');
        setUser(null);
        return;
      }
      setSyncError(
        err instanceof Error ? err.message : 'Failed synchronizing workspace from local server.'
      );
    }
  }, [user?.uid, applyBootstrapCollections]);

  useEffect(() => {
    if (!user?.uid) {
      setAccounts([]);
      setDailyJournals([]);
      setSessions([]);
      setSessionEvents([]);
      setTrades([]);
      setTradeEvents([]);
      setTradeGroups([]);
      setAttachments([]);
      setSessionTemplates([]);
      setChecklists([]);
      setInstruments([]);
      setPreferencesList([]);
      setReviews([]);
      setAuditLogs([]);
      setPendingOperations([]);
      setErrorHistory([]);
      setDataLoading(false);
      return;
    }

    let cancelled = false;
    setDataLoading(true);
    refreshDiagnostics();

    const loadAll = async () => {
      try {
        const res = await fetchWorkspaceBootstrap();
        if (cancelled) return;
        applyBootstrapCollections(res.collections);
        setSyncError(null);
      } catch (err) {
        if (!cancelled) {
          if (err instanceof ApiRequestError && err.status === 401) {
            setAuthError(
              'Unable to verify your session cookie. Please allow cookies for this site and sign in again.'
            );
            setUser(null);
            return;
          }
          setSyncError(
            err instanceof Error
              ? err.message
              : 'Failed loading workspace from local server.'
          );
        }
      } finally {
        if (!cancelled) setDataLoading(false);
      }
    };

    void loadAll();

    // Instant refresh whenever local mutations complete
    const unsubLocal = onLocalWorkspaceSync(() => {
      if (!cancelled) {
        void refreshWorkspace();
      }
    });

    // Lightweight SSE stream for automatic multi-tab & multi-device sync
    let eventSource: EventSource | null = null;
    if (typeof EventSource !== 'undefined') {
      try {
        eventSource = new EventSource('/api/workspace/stream', { withCredentials: true });
        eventSource.addEventListener('sync', () => {
          if (!cancelled) {
            void refreshWorkspace();
          }
        });
      } catch {
        // SSE is optional enhancement; local sync still works synchronously
      }
    }

    return () => {
      cancelled = true;
      unsubLocal();
      eventSource?.close();
    };
  }, [user?.uid, applyBootstrapCollections, refreshWorkspace, refreshDiagnostics]);

  const signInWithPassword = async (identifier: string, password: string) => {
    setAuthError(null);
    try {
      const { user: loggedIn } = await loginWithPasswordApi({ identifier, password });
      setUser(loggedIn);
      setAuthInitialized(true);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Sign-in failed.';
      setAuthError(msg);
      throw error;
    }
  };

  const setupOwnerAccount = async (input: {
    username: string;
    email: string;
    displayName: string;
    password: string;
  }) => {
    setAuthError(null);
    try {
      const { user: created } = await setupAccountApi(input);
      setUser(created);
      setAuthInitialized(true);
      setRegistrationOpen(false);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Account setup failed.';
      setAuthError(msg);
      throw error;
    }
  };

  const changePassword = async (
    currentPassword: string,
    newPassword: string,
    revokeOtherSessions: boolean = true
  ) => {
    await changePasswordApi({ currentPassword, newPassword, revokeOtherSessions });
  };

  const signOutOtherDevices = async () => {
    await logoutAllOtherSessionsApi();
  };

  const signOutUser = async () => {
    setAuthError(null);
    try {
      await logoutApi();
    } finally {
      setUser(null);
    }
  };

  const setThemeMode = async (nextTheme: ThemeMode) => {
    setLocalTheme(nextTheme);
    applyThemeToDocument(nextTheme);
    if (user?.uid && preferences) {
      await updateRecord(user.uid, 'preferences', preferences.id, { theme: nextTheme }, 'Preferences');
    }
  };

  const liveSession = useMemo(
    () =>
      sessions
        .filter((s) => s.status === 'live')
        .sort((a, b) =>
          (b.actualStartTime ?? b.createdAt).localeCompare(a.actualStartTime ?? a.createdAt)
        )[0] ?? null,
    [sessions]
  );

  const activeTrades = useMemo(() => trades.filter((t) => !t.isDeleted), [trades]);

  const deletedTrades = useMemo(
    () =>
      trades
        .filter((t) => Boolean(t.isDeleted))
        .sort((a, b) => (b.deletedAt ?? b.updatedAt).localeCompare(a.deletedAt ?? a.updatedAt)),
    [trades]
  );

  const openTrades = useMemo(
    () =>
      activeTrades
        .filter((t) => t.status !== 'closed')
        .sort((a, b) => a.openedAt.localeCompare(b.openedAt)),
    [activeTrades]
  );

  const value: WorkspaceContextValue = {
    user,
    authLoading,
    authInitialized,
    registrationOpen,
    authError,
    signInWithPassword,
    setupOwnerAccount,
    changePassword,
    signOutOtherDevices,
    signOutUser,
    refreshWorkspace,
    dataLoading,
    syncError,
    dismissSyncError: () => setSyncError(null),
    accounts,
    dailyJournals,
    sessions,
    sessionEvents,
    trades,
    activeTrades,
    deletedTrades,
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
    timezone: preferences?.timezone || DEFAULT_TIMEZONE,
    preferredCurrency: preferences?.preferredCurrency || DEFAULT_CURRENCY,
    liveSession,
    openTrades,
  };

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('useWorkspace must be used within WorkspaceProvider');
  return ctx;
}
