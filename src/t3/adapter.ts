/**
 * T3 adapter boundary. Live HTTP is stubbed until OVHC pairing is configured.
 * Tests inject a fake adapter.
 */

export interface T3ThreadBusySnapshot {
  latestTurnState: string | null;
  sessionStatus: string | null;
  hasQueuedTurnStart: boolean;
  hasRaisedHand: boolean;
}

export interface T3DispatchTurnInput {
  commandId: string;
  threadId: string;
  projectId?: string;
  messageText: string;
  instanceId?: string;
  modelId?: string;
  prepareWorktree?: {
    projectCwd: string;
    baseBranch: string;
    branch?: string;
  };
  createThread?: {
    projectId: string;
    title: string;
    instanceId: string;
    modelId: string;
    worktreePath: string | null;
  };
}

export interface T3DispatchResult {
  sequence: number;
  adopted: boolean;
}

export interface T3Adapter {
  dispatchTurn(input: T3DispatchTurnInput): Promise<T3DispatchResult>;
  getThreadBusy(threadId: string): Promise<T3ThreadBusySnapshot>;
  waitForTurnEnd(input: {
    threadId: string;
    pollMs?: number;
  }): Promise<{ turnId: string | null; state: string }>;
  interruptTurn(input: { commandId: string; threadId: string }): Promise<void>;
}

/**
 * In-memory fake for unit/workflow tests and local dry-runs without T3.
 */
export class FakeT3Adapter implements T3Adapter {
  readonly dispatches: T3DispatchTurnInput[] = [];
  busy: T3ThreadBusySnapshot = {
    latestTurnState: null,
    sessionStatus: 'stopped',
    hasQueuedTurnStart: false,
    hasRaisedHand: false,
  };
  turnEndState = 'completed';
  private readonly receipts = new Map<string, number>();
  private sequence = 0;

  async dispatchTurn(input: T3DispatchTurnInput): Promise<T3DispatchResult> {
    const existing = this.receipts.get(input.commandId);
    if (existing !== undefined) {
      return { sequence: existing, adopted: true };
    }
    this.dispatches.push(input);
    this.sequence += 1;
    this.receipts.set(input.commandId, this.sequence);
    return { sequence: this.sequence, adopted: false };
  }

  async getThreadBusy(): Promise<T3ThreadBusySnapshot> {
    return this.busy;
  }

  async waitForTurnEnd(): Promise<{ turnId: string | null; state: string }> {
    return { turnId: 'turn-fake', state: this.turnEndState };
  }

  async interruptTurn(): Promise<void> {
    /* no-op */
  }
}

let activeAdapter: T3Adapter | undefined;

export function setT3Adapter(adapter: T3Adapter): void {
  activeAdapter = adapter;
}

export function getT3Adapter(): T3Adapter {
  if (!activeAdapter) {
    // Lazy load to avoid pulling credentials into workflow bundles.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createConfiguredT3Adapter } = require('./httpAdapter') as typeof import('./httpAdapter');
    activeAdapter = createConfiguredT3Adapter();
  }
  return activeAdapter;
}
