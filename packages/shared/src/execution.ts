export const EXECUTION_STATUSES = [
  'QUEUED',
  'RUNNING',
  'WAITING_FOR_TOOL',
  'WAITING_FOR_APPROVAL',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'TIMED_OUT',
] as const;
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];

export const TERMINAL_STATUSES: ReadonlySet<ExecutionStatus> = new Set([
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'TIMED_OUT',
]);

/** Explicit state machine: the only legal transitions for an execution. */
export const EXECUTION_TRANSITIONS: Readonly<Record<ExecutionStatus, readonly ExecutionStatus[]>> =
  {
    QUEUED: ['RUNNING', 'CANCELLED', 'FAILED'],
    RUNNING: [
      'WAITING_FOR_TOOL',
      'WAITING_FOR_APPROVAL',
      'COMPLETED',
      'FAILED',
      'CANCELLED',
      'TIMED_OUT',
    ],
    WAITING_FOR_TOOL: ['RUNNING', 'FAILED', 'CANCELLED', 'TIMED_OUT'],
    WAITING_FOR_APPROVAL: ['RUNNING', 'FAILED', 'CANCELLED', 'TIMED_OUT'],
    COMPLETED: [],
    FAILED: [],
    CANCELLED: [],
    TIMED_OUT: [],
  };

export function canTransition(from: ExecutionStatus, to: ExecutionStatus): boolean {
  return EXECUTION_TRANSITIONS[from].includes(to);
}

/** Statuses from which a transition to `to` is legal (used for atomic conditional updates). */
export function sourcesFor(to: ExecutionStatus): ExecutionStatus[] {
  return EXECUTION_STATUSES.filter((s) => EXECUTION_TRANSITIONS[s].includes(to));
}

export const EXECUTION_EVENT_TYPES = [
  'execution.queued',
  'execution.started',
  'execution.resumed',
  'execution.cancel_requested',
  'llm.request',
  'llm.retry',
  'llm.response',
  'llm.error',
  'tool.requested',
  'tool.denied',
  'tool.invalid',
  'tool.started',
  'tool.succeeded',
  'tool.failed',
  'execution.completed',
  'execution.failed',
  'execution.cancelled',
  'execution.timed_out',
] as const;
export type ExecutionEventType = (typeof EXECUTION_EVENT_TYPES)[number];

export const EXECUTION_ERROR_CODES = [
  'PROVIDER_NOT_CONFIGURED',
  'PROVIDER_TIMEOUT',
  'PROVIDER_RATE_LIMITED',
  'PROVIDER_UNAVAILABLE',
  'PROVIDER_INVALID_RESPONSE',
  'PROVIDER_REQUEST_REJECTED',
  'CONTEXT_LIMIT_EXCEEDED',
  'TOKEN_BUDGET_EXCEEDED',
  'MAX_STEPS_EXCEEDED',
  'EXECUTION_TIMEOUT',
  'AGENT_VERSION_MISSING',
  'TOOL_OUTCOME_UNKNOWN',
  'INTERNAL_ERROR',
] as const;
export type ExecutionErrorCode = (typeof EXECUTION_ERROR_CODES)[number];
