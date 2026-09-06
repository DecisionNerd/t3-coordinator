/**
 * One-command local operator entrypoint.
 *
 * Day-to-day: `t3-coordinator start` / `npm start` ensures Temporal (optionally starting it)
 * and runs the worker. MCP is not started here — the supervisor host spawns
 * `t3-coordinator mcp` over stdio when configured.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import * as net from 'node:net';
import { getSupervisorBinding } from './domain/bindings';
import { refreshAaCatalogIfStale } from './domain/models/aaCache';
import { runWorker } from './runWorker';

const DEFAULT_ADDRESS = process.env.TEMPORAL_ADDRESS ?? 'localhost:7233';
const DEFAULT_ENV = process.env.T3_COORDINATOR_ENV ?? 'env-local';

function parseHostPort(address: string): { host: string; port: number } {
  const [host, portRaw] = address.split(':');
  const port = Number(portRaw ?? 7233);
  if (!host || !Number.isFinite(port)) {
    throw new Error(`Invalid TEMPORAL_ADDRESS: ${address}`);
  }
  return { host, port };
}

function canConnect(host: string, port: number, timeoutMs = 500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (ok: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

async function waitForTemporal(address: string, timeoutMs: number): Promise<boolean> {
  const { host, port } = parseHostPort(address);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await canConnect(host, port)) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

function startTemporalDev(address: string): ChildProcess {
  const { port } = parseHostPort(address);
  console.error(`[t3-coordinator] Temporal not reachable at ${address}; starting \`temporal server start-dev\``);
  const child = spawn(
    'temporal',
    ['server', 'start-dev', '--headless', '--port', String(port)],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    },
  );
  child.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'ENOENT') {
      console.error(
        '[t3-coordinator] `temporal` CLI not found on PATH.\n' +
          '  Install: https://docs.temporal.io/cli#install\n' +
          '  Or start Temporal yourself, then re-run `t3-coordinator start` / `npm start`.',
      );
    } else {
      console.error('[t3-coordinator] failed to spawn Temporal:', err);
    }
  });
  child.stdout?.on('data', (buf: Buffer) => {
    process.stderr.write(`[temporal] ${buf.toString()}`);
  });
  child.stderr?.on('data', (buf: Buffer) => {
    process.stderr.write(`[temporal] ${buf.toString()}`);
  });
  child.on('exit', (code, signal) => {
    if (code !== 0 && code !== null) {
      console.error(`[t3-coordinator] Temporal exited code=${code} signal=${signal ?? ''}`);
    }
  });
  return child;
}

function printOperatorBanner(): void {
  const binding = getSupervisorBinding(DEFAULT_ENV);
  console.error('');
  console.error('[t3-coordinator] operator process = Temporal worker only');
  console.error('[t3-coordinator] MCP is host-spawned — point the supervisor provider at:');
  console.error(
    JSON.stringify(
      {
        mcpServers: {
          't3-coordinator': {
            command: 't3-coordinator',
            args: ['mcp'],
          },
        },
      },
      null,
      2,
    ),
  );
  if (!binding) {
    console.error('');
    console.error(
      `[t3-coordinator] no supervisor binding for ${DEFAULT_ENV}. One-time setup:\n` +
        `  t3-coordinator bind-supervisor --environment ${DEFAULT_ENV} --thread <supervisorThreadId>`,
    );
  } else {
    console.error(
      `[t3-coordinator] bound ${DEFAULT_ENV} → ${binding.supervisorThreadId}`,
    );
  }
  console.error('');
}

export async function runDev(argv: string[] = process.argv): Promise<void> {
  const address = DEFAULT_ADDRESS;
  const autoStart =
    process.env.T3_COORDINATOR_AUTO_TEMPORAL !== '0' &&
    argv.includes('--no-temporal') === false;

  let temporalChild: ChildProcess | undefined;
  const up = await waitForTemporal(address, 1_000);
  if (!up) {
    if (!autoStart) {
      throw new Error(
        `Temporal not reachable at ${address}. Start it, or omit --no-temporal / set T3_COORDINATOR_AUTO_TEMPORAL=1.`,
      );
    }
    temporalChild = startTemporalDev(address);
    const ready = await Promise.race([
      waitForTemporal(address, 30_000).then((ok) => ({ ok, reason: ok ? '' : 'timeout' })),
      new Promise<{ ok: false; reason: string }>((resolve) => {
        temporalChild?.once('error', (err) => resolve({ ok: false, reason: String(err) }));
        temporalChild?.once('exit', (code) =>
          resolve({ ok: false, reason: `temporal exited with code ${code}` }),
        );
      }),
    ]);
    if (!ready.ok) {
      temporalChild.kill('SIGTERM');
      throw new Error(
        `Could not start Temporal at ${address} (${ready.reason}). Install the Temporal CLI or start a server yourself.`,
      );
    }
  } else {
    console.error(`[t3-coordinator] Temporal already up at ${address}`);
  }

  const shutdown = () => {
    if (temporalChild && !temporalChild.killed) {
      temporalChild.kill('SIGTERM');
    }
  };
  process.on('SIGINT', () => {
    shutdown();
    process.exit(130);
  });
  process.on('SIGTERM', () => {
    shutdown();
    process.exit(143);
  });

  printOperatorBanner();
  const aaTimer = setInterval(() => {
    void refreshAaCatalogIfStale({}).catch((err) =>
      console.error('[t3-coordinator] AA cache refresh failed', err),
    );
  }, 60 * 60 * 1000);
  void refreshAaCatalogIfStale({}).catch((err) =>
    console.error('[t3-coordinator] AA cache refresh failed', err),
  );
  try {
    await runWorker({ address });
  } finally {
    clearInterval(aaTimer);
    shutdown();
  }
}

if (require.main === module) {
  runDev().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
