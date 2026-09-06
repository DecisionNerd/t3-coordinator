/**
 * Live T3 HTTP adapter against stock OVHC / desktop server.
 *
 * Important: `bootstrap.createThread` / `prepareWorktree` are expanded on the
 * WebSocket dispatch path only. Over HTTP we must `thread.create` (and create
 * the git worktree ourselves) before `thread.turn.start`.
 *
 * Provider inventory is WS RPC `server.getConfig` / `server.refreshProviders`
 * (orchestration:read) — not `/api/orchestration/*`.
 */
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { providersFromServerConfig } from '../domain/models/inventory';
import type { T3Provider } from '../domain/models/types';
import {
  FakeT3Adapter,
  type T3Adapter,
  type T3DispatchResult,
  type T3DispatchTurnInput,
  type T3ThreadBusySnapshot,
  type T3WaitForTurnEndInput,
} from './adapter';
import { readT3Credentials, type T3Credentials } from './credentials';

const execFileAsync = promisify(execFile);

interface ThreadDetail {
  thread?: {
    id: string;
    worktreePath?: string | null;
    branch?: string | null;
    latestTurn?: { turnId: string; state: string } | null;
    session?: {
      status: string | null;
      activeTurnId?: string | null;
    } | null;
    pendingApprovalCount?: number;
    pendingUserInputCount?: number;
  };
  session?: { status: string | null } | null;
}

function isoNow(): string {
  return new Date().toISOString();
}

/** Stable message id so activity retries adopt instead of minting a second user message. */
export function messageIdForCommand(commandId: string): string {
  return `msg_${commandId}`;
}

function toWsUrl(baseUrl: string, token: string): string {
  const u = new URL(baseUrl);
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  u.searchParams.set('token', token);
  return u.toString();
}

function loadWebSocket(): typeof WebSocket {
  if (typeof globalThis.WebSocket === 'function') return globalThis.WebSocket;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const undici = require('undici') as { WebSocket?: typeof WebSocket };
  if (typeof undici.WebSocket === 'function') return undici.WebSocket;
  throw new Error('WebSocket is not available in this Node runtime');
}

async function wsRpc<T>(creds: T3Credentials, tag: string, payload: Record<string, unknown> = {}): Promise<T> {
  const WS = loadWebSocket();
  const url = toWsUrl(creds.baseUrl, creds.token);
  const id = randomUUID();
  return new Promise<T>((resolve, reject) => {
    const ws = new WS(url);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error(`T3 WS ${tag} timed out`));
    }, 15_000);
    const finish = (err?: Error, result?: T) => {
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      if (err) reject(err);
      else resolve(result as T);
    };
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ id, body: { _tag: tag, ...payload } }));
    });
    ws.addEventListener('message', (ev: MessageEvent) => {
      const data = typeof ev.data === 'string' ? ev.data : String(ev.data);
      let parsed: { id?: string; result?: T; error?: { message?: string }; type?: string };
      try {
        parsed = JSON.parse(data) as typeof parsed;
      } catch {
        return;
      }
      if (parsed.type === 'push' || parsed.id !== id) return;
      if (parsed.error) {
        finish(new Error(parsed.error.message ?? `T3 WS ${tag} error`));
        return;
      }
      finish(undefined, parsed.result);
    });
    ws.addEventListener('error', () => finish(new Error(`T3 WS ${tag} connection error`)));
  });
}

async function ensureWorktree(input: {
  projectCwd: string;
  baseBranch: string;
  branch: string;
  worktreePath: string;
}): Promise<void> {
  const projectReal = fs.realpathSync(input.projectCwd);
  fs.mkdirSync(path.dirname(input.worktreePath), { recursive: true });
  if (fs.existsSync(input.worktreePath)) {
    const wtReal = fs.realpathSync(input.worktreePath);
    if (wtReal === projectReal) {
      throw new Error(
        `Refusing to use project cwd as worktree (${wtReal}). Omit worktreePath so the adapter creates an isolated checkout.`,
      );
    }
    return;
  }
  await execFileAsync(
    'git',
    ['worktree', 'add', '-B', input.branch, input.worktreePath, input.baseBranch],
    { cwd: input.projectCwd },
  );
}

export class HttpT3Adapter implements T3Adapter {
  private readonly receipts = new Map<string, number>();

  constructor(private readonly creds: T3Credentials) {}

  private async request<T>(method: string, apiPath: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.creds.baseUrl}${apiPath}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.creds.token}`,
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let parsed: unknown = undefined;
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
    if (!res.ok) {
      throw new Error(
        `T3 ${method} ${apiPath} failed: ${res.status} ${typeof parsed === 'string' ? parsed : JSON.stringify(parsed)}`,
      );
    }
    return parsed as T;
  }

  async dispatchTurn(input: T3DispatchTurnInput): Promise<T3DispatchResult> {
    const existing = this.receipts.get(input.commandId);
    if (existing !== undefined) {
      return { sequence: existing, adopted: true };
    }
    const createdAt = isoNow();
    let lastSequence = 0;
    let worktreePath = input.createThread?.worktreePath ?? null;
    let branch: string | null = input.prepareWorktree?.branch ?? null;

    if (input.prepareWorktree) {
      const branchName = input.prepareWorktree.branch ?? `coord/${input.threadId.slice(0, 8)}`;
      const wt =
        worktreePath ??
        path.join(os.homedir(), '.t3-coordinator', 'worktrees', input.threadId);
      await ensureWorktree({
        projectCwd: input.prepareWorktree.projectCwd,
        baseBranch: input.prepareWorktree.baseBranch,
        branch: branchName,
        worktreePath: wt,
      });
      worktreePath = wt;
      branch = branchName;
    }

    if (input.createThread) {
      const created = await this.request<{ sequence: number }>(
        'POST',
        '/api/orchestration/dispatch',
        {
          type: 'thread.create',
          commandId: `${input.commandId}:create`,
          threadId: input.threadId,
          projectId: input.createThread.projectId,
          title: input.createThread.title,
          modelSelection: {
            instanceId: input.createThread.instanceId,
            model: input.createThread.modelId,
          },
          runtimeMode: 'full-access',
          interactionMode: 'default',
          branch,
          worktreePath,
          createdAt,
        },
      );
      lastSequence = created.sequence;
    }

    const turnCommand: Record<string, unknown> = {
      type: 'thread.turn.start',
      commandId: input.commandId,
      threadId: input.threadId,
      message: {
        messageId: input.messageId ?? messageIdForCommand(input.commandId),
        role: 'user',
        text: input.messageText,
        attachments: [],
      },
      runtimeMode: 'full-access',
      interactionMode: 'default',
      createdAt: isoNow(),
    };
    if (input.instanceId && input.modelId) {
      turnCommand.modelSelection = {
        instanceId: input.instanceId,
        model: input.modelId,
      };
    }

    const started = await this.request<{ sequence: number }>(
      'POST',
      '/api/orchestration/dispatch',
      turnCommand,
    );
    lastSequence = started.sequence;
    this.receipts.set(input.commandId, lastSequence);
    return { sequence: lastSequence, adopted: false };
  }

  async getThreadSnapshot(threadId: string): Promise<{
    worktreePath: string | null;
    branch: string | null;
    busy: T3ThreadBusySnapshot;
    latestTurnState: string | null;
    turnId: string | null;
  }> {
    const detail = await this.request<ThreadDetail>(
      'GET',
      `/api/orchestration/threads/${encodeURIComponent(threadId)}?turnLimit=1`,
    );
    const thread = detail.thread;
    const session = thread?.session ?? detail.session;
    const pendingApprovals = thread?.pendingApprovalCount ?? 0;
    const pendingInputs = thread?.pendingUserInputCount ?? 0;
    return {
      worktreePath: thread?.worktreePath ?? null,
      branch: thread?.branch ?? null,
      latestTurnState: thread?.latestTurn?.state ?? null,
      turnId: thread?.latestTurn?.turnId ?? null,
      busy: {
        latestTurnState: thread?.latestTurn?.state ?? null,
        sessionStatus: session?.status ?? null,
        hasQueuedTurnStart: Boolean(session && 'activeTurnId' in session && session.activeTurnId),
        hasRaisedHand: pendingApprovals > 0 || pendingInputs > 0,
      },
    };
  }

  async getThreadBusy(threadId: string): Promise<T3ThreadBusySnapshot> {
    return (await this.getThreadSnapshot(threadId)).busy;
  }

  async waitForTurnEnd(input: T3WaitForTurnEndInput): Promise<{ turnId: string | null; state: string }> {
    const pollMs = input.pollMs ?? 2_000;
    const deadline = input.timeoutMs != null ? Date.now() + input.timeoutMs : Number.POSITIVE_INFINITY;
    for (;;) {
      if (input.signal?.aborted) {
        const snap = await this.getThreadSnapshot(input.threadId);
        return { turnId: snap.turnId, state: snap.latestTurnState ?? 'interrupted' };
      }
      const snap = await this.getThreadSnapshot(input.threadId);
      const sessionBusy =
        snap.busy.sessionStatus === 'starting' || snap.busy.sessionStatus === 'running';
      const turnBusy = snap.latestTurnState === 'running';
      if (!sessionBusy && !turnBusy && snap.latestTurnState) {
        return { turnId: snap.turnId, state: snap.latestTurnState };
      }
      if (Date.now() >= deadline) {
        return { turnId: snap.turnId, state: 'timeout' };
      }
      await new Promise((r) => setTimeout(r, pollMs));
    }
  }

  async interruptTurn(input: { commandId: string; threadId: string }): Promise<void> {
    await this.request('POST', '/api/orchestration/dispatch', {
      type: 'thread.turn.interrupt',
      commandId: input.commandId,
      threadId: input.threadId,
      createdAt: isoNow(),
    });
  }

  async getServerConfig(): Promise<{ providers: T3Provider[] }> {
    const config = await wsRpc<unknown>(this.creds, 'server.getConfig');
    return { providers: providersFromServerConfig(config) };
  }

  async refreshProviders(instanceId?: string): Promise<{ providers: T3Provider[] }> {
    const payload = instanceId ? { instanceId } : {};
    const updated = await wsRpc<{ providers?: unknown }>(this.creds, 'server.refreshProviders', payload);
    if (Array.isArray(updated?.providers)) {
      return { providers: providersFromServerConfig({ providers: updated.providers }) };
    }
    return this.getServerConfig();
  }
}

/** Prefer live credentials; fall back to in-memory fake for unit tests / dry-run. */
export function createConfiguredT3Adapter(): T3Adapter {
  const creds = readT3Credentials();
  if (!creds) {
    return new FakeT3Adapter();
  }
  return new HttpT3Adapter(creds);
}
