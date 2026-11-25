export const SCHEMA_VERSION = 2;
export const APP_NAME = 'ATK Deck';
export const APP_VERSION = '2.0.0';
export const UTDS_FORMAT_NAME = 'ATK-UTDS';
export const UTDS_FORMAT_VERSION = '1.0';
export const DEFAULT_TIMEZONE = 'Asia/Kolkata';
export const DEFAULT_CURRENCY = 'USD';

export type AccountType = 'live' | 'funded' | 'evaluation' | 'demo' | 'personal';
export type SessionStatus = 'planned' | 'live' | 'completed' | 'missed' | 'cancelled';
export type SessionAttendance = 'attended' | 'missed' | 'planned' | 'cancelled';
export type SittingLocation = 'home' | 'office' | 'trading_desk' | 'travelling' | 'other';
export type SessionBias = 'bullish' | 'bearish' | 'neutral' | 'custom';
export type SetupAvailability = 'pending' | 'available' | 'limited' | 'none';
export type PlanAdherence = 'pending' | 'yes' | 'partial' | 'no';

export type SessionEventType =
  | 'levels_marked_cleanly'
  | 'waiting_for_setup'
  | 'no_valid_setup'
  | 'choppy_market'
  | 'fomo_resisted'
  | 'calm_and_present'
  | 'fatigued_distracted'
  | 'impatient'
  | 'changed_bias'
  | 'stepped_back'
  | 'guard_cancelled'
  | 'guard_passed'
  | 'session_started'
  | 'session_ended'
  | 'custom_observation';

export type TradeDirection = 'long' | 'short';
export type TradeStatus = 'before_entry' | 'during_trade' | 'closed';
export type ExitOutcome = 'pending' | 'win' | 'loss' | 'breakeven';
export type ExitReason = 'pending' | 'take_profit' | 'stop_loss' | 'manual_exit' | 'breakeven_exit' | 'other';
export type TpStatus = 'pending' | 'hit_full' | 'partial' | 'missed' | 'not_used';
export type SlStatus = 'pending' | 'hit' | 'trailed_breakeven' | 'moved' | 'untouched';
export type YesNoNa = 'yes' | 'no' | 'na';

export type TradeEventType =
  | 'sl_adjusted'
  | 'tp_adjusted'
  | 'partial_close'
  | 'added_to_position'
  | 'emotion_event'
  | 'market_observation'
  | 'trade_opened'
  | 'trade_closed';

export type AttachmentCategory = 'before_entry' | 'entry' | 'exit' | 'post_trade' | 'session_note';
export type AssetClass = 'forex' | 'metals' | 'crypto' | 'indices' | 'equities' | 'commodities' | 'other';
export type ThemeMode = 'light' | 'dark' | 'system';
export type ReviewType = 'daily' | 'weekly' | 'monthly' | 'strategy';

export type ErrorCategory =
  | 'validation'
  | 'authentication'
  | 'permission'
  | 'database'
  | 'network'
  | 'synchronisation'
  | 'conflict'
  | 'application';

export type SyncQueueStatus =
  | 'Pending'
  | 'Processing'
  | 'Synced'
  | 'Failed'
  | 'Conflict'
  | 'Requires Attention';

// --- Central Label <-> Canonical DB Mappings ---

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  live: 'Live',
  funded: 'Funded',
  evaluation: 'Evaluation',
  demo: 'Demo',
  personal: 'Personal',
};

export const SESSION_STATUS_LABELS: Record<SessionStatus, string> = {
  planned: 'Planned',
  live: 'Live',
  completed: 'Completed',
  missed: 'Missed',
  cancelled: 'Cancelled',
};

export const SESSION_ATTENDANCE_LABELS: Record<SessionAttendance, string> = {
  attended: 'Attended',
  missed: 'Missed',
  planned: 'Planned',
  cancelled: 'Cancelled',
};

export const SITTING_LOCATION_LABELS: Record<SittingLocation, string> = {
  home: 'Home',
  office: 'Office',
  trading_desk: 'Trading Desk',
  travelling: 'Travelling',
  other: 'Other',
};

export const SESSION_BIAS_LABELS: Record<SessionBias, string> = {
  bullish: 'Bullish',
  bearish: 'Bearish',
  neutral: 'Neutral',
  custom: 'Custom',
};

export const SETUP_AVAILABILITY_LABELS: Record<SetupAvailability, string> = {
  pending: 'Pending',
  available: 'Available',
  limited: 'Limited',
  none: 'No Valid Setup',
};

export const PLAN_ADHERENCE_LABELS: Record<PlanAdherence, string> = {
  pending: 'Pending',
  yes: 'Yes',
  partial: 'Partial',
  no: 'No',
};

export const SESSION_EVENT_LABELS: Record<SessionEventType, string> = {
  levels_marked_cleanly: 'Levels Marked Cleanly',
  waiting_for_setup: 'Waiting for Setup',
  no_valid_setup: 'No Valid Setup',
  choppy_market: 'Choppy Market',
  fomo_resisted: 'FOMO Resisted',
  calm_and_present: 'Calm & Present',
  fatigued_distracted: 'Fatigued / Distracted',
  impatient: 'Impatient',
  changed_bias: 'Changed Bias',
  stepped_back: 'Stepped Back',
  guard_cancelled: 'Guard Cancelled',
  guard_passed: 'Guard Passed',
  session_started: 'Session Started',
  session_ended: 'Session Ended',
  custom_observation: 'Custom Observation',
};

export const QUICK_SESSION_EVENT_TYPES: SessionEventType[] = [
  'levels_marked_cleanly',
  'waiting_for_setup',
  'no_valid_setup',
  'choppy_market',
  'fomo_resisted',
  'calm_and_present',
  'fatigued_distracted',
  'impatient',
  'changed_bias',
  'stepped_back',
  'custom_observation',
];

export const TRADE_DIRECTION_LABELS: Record<TradeDirection, string> = {
  long: 'Long',
  short: 'Short',
};

export const TRADE_STATUS_LABELS: Record<TradeStatus, string> = {
  before_entry: 'Before Entry',
  during_trade: 'During Trade',
  closed: 'Closed',
};

export const EXIT_OUTCOME_LABELS: Record<ExitOutcome, string> = {
  pending: 'Pending',
  win: 'Win',
  loss: 'Loss',
  breakeven: 'Breakeven',
};

export const EXIT_REASON_LABELS: Record<ExitReason, string> = {
  pending: 'Pending',
  take_profit: 'Take Profit Hit',
  stop_loss: 'Stop Loss Hit',
  manual_exit: 'Manual Exit',
  breakeven_exit: 'Breakeven Exit',
  other: 'Other',
};

export const TP_STATUS_LABELS: Record<TpStatus, string> = {
  pending: 'Pending',
  hit_full: 'Hit Full TP',
  partial: 'Partial TP',
  missed: 'Missed',
  not_used: 'Not Used',
};

export const SL_STATUS_LABELS: Record<SlStatus, string> = {
  pending: 'Pending',
  hit: 'Hit',
  trailed_breakeven: 'Trailed to Breakeven',
  moved: 'Moved',
  untouched: 'Untouched / Not Used',
};

export const YES_NO_NA_LABELS: Record<YesNoNa, string> = {
  yes: 'Yes',
  no: 'No',
  na: 'N/A',
};

export const TRADE_EVENT_LABELS: Record<TradeEventType, string> = {
  sl_adjusted: 'Stop-Loss Adjusted',
  tp_adjusted: 'Take-Profit Adjusted',
  partial_close: 'Partial Close',
  added_to_position: 'Added to Position',
  emotion_event: 'Emotion Event',
  market_observation: 'Market Observation',
  trade_opened: 'Trade Opened',
  trade_closed: 'Trade Closed',
};

export const QUICK_TRADE_EVENT_TYPES: TradeEventType[] = [
  'sl_adjusted',
  'tp_adjusted',
  'partial_close',
  'added_to_position',
  'emotion_event',
  'market_observation',
];

export const ATTACHMENT_CATEGORY_LABELS: Record<AttachmentCategory, string> = {
  before_entry: 'Before Entry',
  entry: 'Entry',
  exit: 'Exit',
  post_trade: 'Post Trade',
  session_note: 'Session Note',
};

export const PRE_SESSION_EMOTIONS = [
  'Calm',
  'Focused',
  'Confident',
  'Neutral',
  'Excited',
  'Anxious',
  'Frustrated',
  'Impatient',
  'Tired',
  'Distracted',
] as const;

export const POST_TRADE_EMOTIONS = [
  'Calm & Focused',
  'Present',
  'Confident',
  'Neutral',
  'Cautious',
  'Anxious',
  'Impatient',
  'FOMO',
  'Frustrated',
  'Overconfident',
  'Tired',
  'Fatigued / Distracted',
] as const;

export const TRADE_MISTAKES = [
  'Chased Entry',
  'Moved Stop Loss Wider',
  'Oversized Position',
  'Entered Without Setup',
  'Cut Winner Early',
  'Revenge Trade',
  'Ignored HTF Levels',
  'No Anti-Bias Pause',
] as const;

export const DEFAULT_DAILY_CHECKLIST = [
  'Meditation',
  'Exercise',
  'Visualization',
  'Oxygenation',
  'Reading',
];

export const DEFAULT_SESSION_CHECKLIST = [
  'Higher-Timeframe Levels Marked',
  'Economic Calendar Checked',
  'Risk Limit Confirmed',
  'Invalidation Defined',
];

export const DEFAULT_SESSION_TEMPLATES = [
  { id: 'asian', name: 'Asian', startTime: '05:30', endTime: '11:30', isActive: true, sortOrder: 1 },
  { id: 'london', name: 'London', startTime: '11:30', endTime: '17:30', isActive: true, sortOrder: 2 },
  { id: 'new_york', name: 'New York', startTime: '17:30', endTime: '22:30', isActive: true, sortOrder: 3 },
];

export const DEFAULT_INSTRUMENTS: Array<{ symbol: string; assetClass: AssetClass }> = [
  { symbol: 'XAUUSD', assetClass: 'metals' },
  { symbol: 'XAGUSD', assetClass: 'metals' },
  { symbol: 'BTCUSD', assetClass: 'crypto' },
  { symbol: 'EURUSD', assetClass: 'forex' },
  { symbol: 'GBPUSD', assetClass: 'forex' },
  { symbol: 'USDJPY', assetClass: 'forex' },
  { symbol: 'USDCHF', assetClass: 'forex' },
  { symbol: 'AUDUSD', assetClass: 'forex' },
  { symbol: 'USDCAD', assetClass: 'forex' },
  { symbol: 'NZDUSD', assetClass: 'forex' },
];

export const DEFAULT_TIMEFRAMES = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1', 'W1'];
export const DEFAULT_ENTRY_TYPES = ['Limit Order', 'Market Execution', 'Stop Order', 'Breakout Retest', 'Liquidity Sweep'];
export const DEFAULT_SETUP_LABELS = ['HTF Liquidity Sweep', 'BOS Pullback', 'Session Open Drive', 'Range Deviation', 'Trend Continuation'];
