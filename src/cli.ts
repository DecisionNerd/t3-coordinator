#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { bindSupervisor, bindingsPath, getSupervisorBinding } from './domain/bindings';
import { defaultsPath, mergeDefaults, readDefaults } from './domain/defaults';
import { ensureMcpProviders, mcpProviderReport } from './domain/ensureMcp';
import { runDxIntent } from './domain/dx';
import { tryResolveProjectContext } from './domain/repoContext';
import { credentialsPath, readT3Credentials, writeT3Credentials } from './t3/credentials';
import { createConfiguredT3Adapter } from './t3/httpAdapter';
import { FakeT3Adapter } from './t3/adapter';

function usage(): never {
  console.error(`Usage:
  t3-coordinator start [--no-temporal]
  t3-coordinator mcp
  t3-coordinator run ["<phrase>"]      # empty / omitted = next (orient); e.g. "complete M2" or "192"
  t3-coordinator defaults
  t3-coordinator defaults-set [--t3-project <uuid>] [--instance <id>] [--model <id>] [--env env-local] [--branch main] [--cwd <hint>]
      # GitHub repo is detected from the current T3 checkout — do not set a sticky --github default
  t3-coordinator ensure-mcp              # register MCP on Codex/Cursor so every new T3 chat sees tools
  t3-coordinator bind-supervisor --environment <id> --thread <threadId>   # optional; assign auto-binds from calling thread
  t3-coordinator get-binding --environment <id>
  t3-coordinator auth-issue [--ttl 30d] [--label t3-coordinator]
  t3-coordinator doctor
  t3-coordinator version`);
  process.exit(2);
}

function readFlag(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx === -1) return undefined;
  return args[idx + 1];
}

function operatingProfilePaths(): {
  active: string | null;
  defaultTemplate: string | null;
} {
  const home = process.env.HOME ?? '';
  const active = path.join(home, '.t3-coordinator', 'operating-profile.json');
  const defaultTemplate = path.resolve(__dirname, '..', 'templates', 'operating-profile.default.json');
  return {
    active: fs.existsSync(active) ? active : null,
    defaultTemplate: fs.existsSync(defaultTemplate) ? defaultTemplate : null,
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const cmd = args[0];

  if (cmd === 'start') {
    const { runDev } = await import('./dev.js');
    await runDev(['node', 't3-coordinator', ...args.slice(1)]);
    return;
  }
  if (cmd === 'mcp') {
    const { runMcpServer } = await import('./mcp/server.js');
    await runMcpServer();
    return;
  }
  if (cmd === 'run') {
    const phrase = args.slice(1).join(' ').trim();
    const out = await runDxIntent(phrase);
    console.log(JSON.stringify(out, null, 2));
    if (
      out.result &&
      typeof out.result === 'object' &&
      'ok' in out.result &&
      (out.result as { ok: boolean }).ok === false
    ) {
      process.exit(1);
    }
    return;
  }
  if (cmd === 'defaults') {
    const detected = tryResolveProjectContext();
    console.log(
      JSON.stringify(
        {
          ok: true,
          path: defaultsPath(),
          defaults: readDefaults(),
          note: 'GitHub repo is detected from the current checkout, not a sticky default.',
          detectedRepo: detected.ok
            ? {
                githubRepo: detected.context.githubRepo,
                projectCwd: detected.context.projectCwd,
                source: detected.context.source,
              }
            : { error: detected.error, ask: detected.ask, detail: detected.detail },
        },
        null,
        2,
      ),
    );
    return;
  }
  if (cmd === 'defaults-set') {
    const t3ProjectId = readFlag(args, '--t3-project');
    const projectCwd = readFlag(args, '--cwd');
    const instanceId = readFlag(args, '--instance');
    const modelId = readFlag(args, '--model');
    const environmentId = readFlag(args, '--env');
    const baseBranch = readFlag(args, '--branch');
    const deprecatedGithub = readFlag(args, '--github');
    if (deprecatedGithub) {
      console.error(
        'Warning: --github is ignored. Repo is detected from the current T3 checkout (git root + remote/gh).',
      );
    }
    if (!t3ProjectId && !instanceId && !modelId && !projectCwd && !environmentId && !baseBranch) {
      usage();
    }
    if (projectCwd) {
      const absCwd = path.resolve(projectCwd);
      if (!fs.existsSync(absCwd)) {
        console.error(`cwd does not exist: ${absCwd}`);
        process.exit(1);
      }
    }
    const defaults = mergeDefaults({
      ...(t3ProjectId ? { t3ProjectId } : {}),
      ...(instanceId ? { instanceId } : {}),
      ...(modelId ? { modelId } : {}),
      ...(environmentId ? { environmentId } : {}),
      ...(baseBranch ? { baseBranch } : {}),
      ...(projectCwd ? { projectCwd: path.resolve(projectCwd) } : {}),
      githubRepo: undefined,
    });
    const detected = tryResolveProjectContext();
    console.log(
      JSON.stringify(
        {
          ok: true,
          path: defaultsPath(),
          defaults,
          detectedRepo: detected.ok
            ? {
                githubRepo: detected.context.githubRepo,
                projectCwd: detected.context.projectCwd,
                source: detected.context.source,
              }
            : { error: detected.error, ask: detected.ask },
        },
        null,
        2,
      ),
    );
    return;
  }
  if (cmd === 'version' || cmd === '--version' || cmd === '-v') {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pkg = require('../package.json') as { version: string; name: string };
    console.log(`${pkg.name} ${pkg.version}`);
    return;
  }
  if (cmd === 'ensure-mcp') {
    console.log(JSON.stringify({ ok: true, ...ensureMcpProviders() }, null, 2));
    return;
  }
  if (cmd === 'bind-supervisor') {
    const environmentId = readFlag(args, '--environment');
    const thread = readFlag(args, '--thread');
    if (!environmentId || !thread) usage();
    const binding = bindSupervisor({
      environmentId,
      supervisorThreadId: thread,
    });
    console.log(JSON.stringify({ ok: true, binding, path: bindingsPath() }, null, 2));
    return;
  }
  if (cmd === 'get-binding') {
    const environmentId = readFlag(args, '--environment');
    if (!environmentId) usage();
    const binding = getSupervisorBinding(environmentId);
    console.log(JSON.stringify({ ok: true, binding: binding ?? null, path: bindingsPath() }, null, 2));
    return;
  }
  if (cmd === 'auth-issue') {
    const ttl = readFlag(args, '--ttl') ?? '30d';
    const label = readFlag(args, '--label') ?? 't3-coordinator';
    const issued = spawnSync(
      'npx',
      ['--yes', 't3@0.0.38', 'auth', 'session', 'issue', '--ttl', ttl, '--label', label, '--json'],
      { encoding: 'utf8' },
    );
    if (issued.status !== 0) {
      console.error(issued.stderr || issued.stdout);
      process.exit(issued.status ?? 1);
    }
    const payload = JSON.parse(issued.stdout) as {
      sessionId: string;
      token: string;
      expiresAt?: string;
    };
    const runtime = spawnSync('cat', [`${process.env.HOME}/.t3/userdata/server-runtime.json`], {
      encoding: 'utf8',
    });
    let baseUrl = process.env.T3_BASE_URL ?? 'http://127.0.0.1:3773';
    if (runtime.status === 0 && runtime.stdout.trim()) {
      try {
        const parsed = JSON.parse(runtime.stdout) as { origin?: string };
        if (parsed.origin) baseUrl = parsed.origin;
      } catch {
        /* keep default */
      }
    }
    writeT3Credentials({
      baseUrl,
      token: payload.token,
      sessionId: payload.sessionId,
      expiresAt: payload.expiresAt,
      label,
      t3Version: '0.0.38',
    });
    console.log(
      JSON.stringify(
        {
          ok: true,
          path: credentialsPath(),
          baseUrl,
          sessionId: payload.sessionId,
          expiresAt: payload.expiresAt,
        },
        null,
        2,
      ),
    );
    return;
  }
  if (cmd === 'doctor') {
    const creds = readT3Credentials();
    const adapter = createConfiguredT3Adapter();
    const kind = adapter instanceof FakeT3Adapter ? 'fake' : 'http';
    let snapshotOk: boolean | string = false;
    if (creds) {
      try {
        const res = await fetch(`${creds.baseUrl}/api/orchestration/snapshot`, {
          headers: { Authorization: `Bearer ${creds.token}` },
        });
        snapshotOk = res.ok ? true : `status ${res.status}`;
      } catch (err) {
        snapshotOk = String(err);
      }
    }
    console.log(
      JSON.stringify(
        {
          adapter: kind,
          credentials: creds
            ? {
                path: credentialsPath(),
                baseUrl: creds.baseUrl,
                sessionId: creds.sessionId ?? null,
                expiresAt: creds.expiresAt ?? null,
                t3Version: creds.t3Version ?? null,
              }
            : null,
          snapshotOk,
          bindingEnvLocal: getSupervisorBinding('env-local') ?? null,
          mcpProviders: mcpProviderReport(),
          operatingProfile: operatingProfilePaths(),
        },
        null,
        2,
      ),
    );
    return;
  }
  usage();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
