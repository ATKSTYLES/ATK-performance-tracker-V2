import {
  AccountType,
  AssetClass,
  AttachmentCategory,
  ErrorCategory,
  ExitOutcome,
  ExitReason,
  PlanAdherence,
  ReviewType,
  SessionAttendance,
  SessionBias,
  SessionEventType,
  SessionStatus,
  SetupAvailability,
  SittingLocation,
  SlStatus,
  SyncQueueStatus,
  ThemeMode,
  TpStatus,
  TradeDirection,
  TradeEventType,
  TradeStatus,
  YesNoNa,
} from './enums';

export interface BaseRecord {
  id: string;
  userId: string;
  schemaVersion: number;
  createdAt: string;
  updatedAt: string;
  originalCreatedAt?: string;
}

export interface ChecklistItemState {
  id: string;
  label: string;
  completed: boolean;
}

export interface TradingAccount extends BaseRecord {
  name: string;
  broker: string;
  accountType: AccountType;
  capital: number;
  currency: string;
  defaultRiskPercent: number;
  isActive: boolean;
}

export interface DailyJournal extends BaseRecord {
  date: string; // YYYY-MM-DD (also document id)
  timezone: string;
  plannedActivities: string;
  morningNotes: string;
  dailyEmotionalState: string;
  disciplineRating: number;
  dailyReflection: string;
  checklistItems: ChecklistItemState[];
}

export interface TradingSession extends BaseRecord {
  date: string;
  timezone: string;
  templateId?: string;
  sessionName: string;
  scheduledStart?: string;
  scheduledEnd?: string;
  status: SessionStatus;
  attendance: SessionAttendance;
  sittingLocation: SittingLocation;
  sittingLocationCustom?: string;
  preSessionEmotion: string;
  preSessionEmotionNote?: string;
  sessionBias: SessionBias;
  sessionBiasCustom?: string;
  keyLevels?: string;
  marketExpectations?: string;
  liquidityTargets?: string;
  invalidationConditions?: string;
  preparationNotes?: string;
  checklistItems: ChecklistItemState[];
  actualStartTime?: string;
  actualEndTime?: string;
  setupAvailability?: SetupAvailability;
  planAdherence?: PlanAdherence;
  postSessionEmotion?: string;
  closingReflection?: string;
}

export interface SessionEvent extends BaseRecord {
  sessionId: string;
  date: string;
  eventType: SessionEventType;
  description: string;
  timestamp: string;
}

export interface Trade extends BaseRecord {
  date: string;
  timezone: string;
  tradeNumberOfDay: number;
  accountId: string;
  accountName: string;
  sessionId?: string;
  sessionName?: string;
  isOutOfSession: boolean;
  tradeGroupId?: string;
  instrument: string;
  direction: TradeDirection;
  setupLabel?: string;
  entryType?: string;
  timeframe?: string;
  status: TradeStatus;
  riskPercent: number;
  expectedProfitPercent: number;
  actualProfitPercent?: number;
  entryReasoning?: string;
  expectedOutcome?: string;
  preTradeEmotion: string;
  confidence: number;
  guardPassed?: boolean;
  openedAt: string;
  closedAt?: string;
  exitOutcome: ExitOutcome;
  exitReason: ExitReason;
  tpStatus: TpStatus;
  slStatus: SlStatus;
  actualOutcomeNotes?: string;
  entryPrice?: number;
  exitPrice?: number;
  stopLossPrice?: number;
  takeProfitPrice?: number;
  positionSize?: number;
  grossPnl?: number;
  commission?: number;
  otherCharges?: number;
  netPnl?: number;
  realisedR?: number;
  currency?: string;
  followedPlan: YesNoNa;
  followedRiskRules: YesNoNa;
  impulsiveEntry: YesNoNa;
  exitedPerPlan: YesNoNa;
  postTradeEmotion?: string;
  mistakes: string[];
  lessonsLearned?: string;
  closureOperationId?: string;
  isDeleted?: boolean;
  deletedAt?: string;
  deletedBy?: string;
}

export interface TradeEvent extends BaseRecord {
  tradeId: string;
  eventType: TradeEventType;
  description: string;
  partialClosePercent?: number;
  emotion?: string;
  operationId?: string;
  timestamp: string;
}

export interface TradeGroup extends BaseRecord {
  date: string;
  instrument: string;
  direction: TradeDirection;
  setupLabel?: string;
  tradeIds: string[];
  accountIds: string[];
}

export interface AttachmentMeta extends BaseRecord {
  relatedType: 'trade' | 'session';
  relatedId: string;
  category: AttachmentCategory;
  fileName: string;
  storagePath: string;
  contentType: string;
  fileSize: number;
  checksum?: string;
}

export interface SessionTemplate extends BaseRecord {
  name: string;
  startTime: string;
  endTime: string;
  isActive: boolean;
  sortOrder: number;
}

export interface ChecklistConfig extends BaseRecord {
  scope: 'daily' | 'session';
  items: string[];
}

export interface InstrumentConfig extends BaseRecord {
  symbol: string;
  assetClass: AssetClass;
  isActive: boolean;
}

export interface UserProfilePreferences extends BaseRecord {
  displayName: string;
  tradingDeskName: string;
  timezone: string;
  preferredCurrency: string;
  theme: ThemeMode;
  antiBiasPauseEnabled: boolean;
  antiBiasPauseSeconds: number;
  maxSessionsPerDay: number;
  timeframes: string[];
  entryTypes: string[];
  setupLabels: string[];
  quickSessionEvents: string[];
  quickTradeEvents?: string[];
}

export interface TradingReview extends BaseRecord {
  reviewType: ReviewType;
  periodLabel: string;
  date: string;
  summary: string;
  tradingMistakes: string;
  lessonsLearned: string;
  behaviouralPatterns: string;
  improvementGoals: string;
  rating: number;
}

export interface AuditLogEntry extends BaseRecord {
  operationId: string;
  module: string;
  operationType: string;
  recordId: string;
  documentPath: string;
  errorCategory: ErrorCategory;
  errorCode: string;
  message: string;
}

export interface AppErrorDiagnostic {
  operationId: string;
  module: string;
  operationType: string;
  recordId: string;
  documentPath: string;
  timestamp: string;
  errorCategory: ErrorCategory;
  firebaseErrorCode: string;
  userMessage: string;
  localSaveStatus: 'saved' | 'preserved_in_form' | 'not_saved';
  cloudSaveStatus: 'confirmed' | 'failed' | 'pending';
  retrySafe: boolean;
  recommendedAction: string;
  failedStage?: string;
  failedEventPath?: string;
}

export interface PendingOperation {
  operationId: string;
  userId: string;
  recordId: string;
  operationType: string;
  payloadVersion: number;
  payload: unknown;
  retryCount: number;
  attemptHistory: Array<{ timestamp: string; errorCode?: string; errorMessage?: string }>;
  lastError?: AppErrorDiagnostic;
  status: SyncQueueStatus;
  createdAt: string;
  updatedAt: string;
}
