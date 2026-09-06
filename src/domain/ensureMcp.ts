import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export type ProviderId = 'codex' | 'cursor' | 'claude' | 'opencode' | 'grok' | 't3-settings';

export type McpProviderStatus = {
  provider: ProviderId;
  configured: boolean;
  path?: string;
  detail: string;
  action?: string;
};

function which(cmd: string): string | null {
  const res = spawnSync('bash', ['-lc', `command -v ${cmd}`], { encoding: 'utf8' });
  const out = (res.stdout || '').trim();
  return out || null;
}

function coordinatorBin(): string {
  const fromPath = which('t3-coordinator');
  if (fromPath && fs.existsSync(fromPath)) return fromPath;
  const fallback = path.join(os.homedir(), '.local', 'bin', 't3-coordinator');
  return fallback;
}

function writeJson(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function readJsonObject(filePath: string): Record<string, unknown> {
  if (!fs.existsSync(filePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function stdioEntry(bin: string): { command: string; args: string[] } {
  return { command: bin, args: ['mcp'] };
}

function ensureCursorMcp(bin: string): McpProviderStatus {
  const mcpPath = path.join(os.homedir(), '.cursor', 'mcp.json');
  const data = readJsonObject(mcpPath) as {
    mcpServers?: Record<string, { command?: string; args?: string[] }>;
  };
  data.mcpServers = data.mcpServers ?? {};
  const existing = data.mcpServers['t3-coordinator'];
  if (
    existing?.command === bin &&
    Array.isArray(existing.args) &&
    existing.args.join(' ') === 'mcp'
  ) {
    return {
      provider: 'cursor',
      configured: true,
      path: mcpPath,
      detail: 'already present in ~/.cursor/mcp.json',
    };
  }
  data.mcpServers['t3-coordinator'] = stdioEntry(bin);
  writeJson(mcpPath, data);
  return {
    provider: 'cursor',
    configured: true,
    path: mcpPath,
    detail: 'Wrote t3-coordinator into ~/.cursor/mcp.json',
    action: 'updated',
  };
}

function ensureCodexMcp(bin: string): McpProviderStatus {
  const configPath = path.join(os.homedir(), '.codex', 'config.toml');
  const codex = which('codex');
  if (codex) {
    spawnSync(codex, ['mcp', 'remove', 't3-coordinator'], { encoding: 'utf8' });
    const add = spawnSync(codex, ['mcp', 'add', 't3-coordinator', '--', bin, 'mcp'], {
      encoding: 'utf8',
    });
    if (add.status === 0) {
      return {
        provider: 'codex',
        configured: true,
        path: configPath,
        detail: `codex mcp add → ${bin} mcp`,
        action: 'updated',
      };
    }
  }

  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  let toml = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : '';
  const block = [
    '',
    '[mcp_servers.t3-coordinator]',
    `command = "${bin.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`,
    'args = ["mcp"]',
    '',
  ].join('\n');
  if (/\[mcp_servers\.t3-coordinator\]/.test(toml)) {
    toml = toml.replace(
      /\[mcp_servers\.t3-coordinator\][\s\S]*?(?=\n\[|$)/,
      `${block.trim()}\n`,
    );
  } else {
    toml = `${toml.trimEnd()}\n${block}`;
  }
  fs.writeFileSync(configPath, toml.endsWith('\n') ? toml : `${toml}\n`, 'utf8');
  return {
    provider: 'codex',
    configured: true,
    path: configPath,
    detail: codex ? 'wrote config.toml (codex mcp add failed)' : 'wrote config.toml',
    action: 'updated',
  };
}

function ensureClaudeMcp(bin: string): McpProviderStatus {
  const claude = which('claude');
  const userSettings = path.join(os.homedir(), '.claude', 'settings.json');
  const legacy = path.join(os.homedir(), '.claude.json');

  if (claude) {
    spawnSync(claude, ['mcp', 'remove', '-s', 'user', 't3-coordinator'], { encoding: 'utf8' });
    const add = spawnSync(
      claude,
      ['mcp', 'add', '-s', 'user', 't3-coordinator', '--', bin, 'mcp'],
      { encoding: 'utf8' },
    );
    if (add.status === 0) {
      return {
        provider: 'claude',
        configured: true,
        path: userSettings,
        detail: `claude mcp add -s user → ${bin} mcp`,
        action: 'updated',
      };
    }
  }

  // Fallback: user settings mcpServers
  const target = fs.existsSync(userSettings) || !fs.existsSync(legacy) ? userSettings : legacy;
  const data = readJsonObject(target);
  const mcpServers = (data.mcpServers as Record<string, unknown> | undefined) ?? {};
  mcpServers['t3-coordinator'] = stdioEntry(bin);
  data.mcpServers = mcpServers;
  writeJson(target, data);
  return {
    provider: 'claude',
    configured: true,
    path: target,
    detail: claude ? `wrote ${target} (claude mcp add failed)` : `wrote ${target}`,
    action: 'updated',
  };
}

function ensureOpenCodeMcp(bin: string): McpProviderStatus {
  // Prefer a real JSON file we can own; create alongside jsonc if needed
  const jsonPath = path.join(os.homedir(), '.config', 'opencode', 'opencode.json');
  const data = readJsonObject(jsonPath);
  if (!data.$schema) data.$schema = 'https://opencode.ai/config.json';
  const mcp = (data.mcp as Record<string, unknown> | undefined) ?? {};
  mcp['t3-coordinator'] = {
    type: 'local',
    command: [bin, 'mcp'],
    enabled: true,
  };
  data.mcp = mcp;
  writeJson(jsonPath, data);
  return {
    provider: 'opencode',
    configured: true,
    path: jsonPath,
    detail: `Wrote t3-coordinator into ${jsonPath}`,
    action: 'updated',
  };
}

/** Grok / xAI agent — best-effort Cursor-shaped mcp.json under ~/.grok if the dir exists. */
function ensureGrokMcp(bin: string): McpProviderStatus {
  const grokHome = path.join(os.homedir(), '.grok');
  if (!fs.existsSync(grokHome) && !which('grok')) {
    return {
      provider: 'grok',
      configured: false,
      detail: 'Grok not installed — skipped',
    };
  }
  const mcpPath = path.join(grokHome, 'mcp.json');
  const data = readJsonObject(mcpPath) as {
    mcpServers?: Record<string, { command?: string; args?: string[] }>;
  };
  data.mcpServers = data.mcpServers ?? {};
  data.mcpServers['t3-coordinator'] = stdioEntry(bin);
  writeJson(mcpPath, data);
  return {
    provider: 'grok',
    configured: true,
    path: mcpPath,
    detail: `Wrote t3-coordinator into ${mcpPath}`,
    action: 'updated',
  };
}

/**
 * Enable all common provider drivers in T3 settings so the operator can pick any supervisor.
 * Does not disable anything already enabled.
 */
function ensureT3ProvidersEnabled(): McpProviderStatus {
  const settingsPath = path.join(os.homedir(), '.t3', 'userdata', 'settings.json');
  if (!fs.existsSync(path.dirname(settingsPath))) {
    return {
      provider: 't3-settings',
      configured: false,
      detail: 'No ~/.t3/userdata — T3 not installed here',
    };
  }
  const data = readJsonObject(settingsPath);
  const providers = (data.providers as Record<string, { enabled?: boolean }> | undefined) ?? {};
  const instances =
    (data.providerInstances as Record<
      string,
      { driver?: string; enabled?: boolean; config?: Record<string, unknown> }
    > | undefined) ?? {};

  const wanted = ['codex', 'cursor', 'claude', 'opencode', 'grok'] as const;
  const changed: string[] = [];
  for (const id of wanted) {
    if (!providers[id]) providers[id] = { enabled: true };
    else if (providers[id].enabled === false) {
      providers[id].enabled = true;
      changed.push(id);
    }
    if (!instances[id]) {
      instances[id] = {
        driver: id === 'claude' ? 'claude' : id,
        enabled: true,
        config: {},
      };
      changed.push(`${id}:instance`);
    } else if (instances[id].enabled === false) {
      instances[id].enabled = true;
      changed.push(`${id}:instance`);
    }
  }
  data.providers = providers;
  data.providerInstances = instances;
  writeJson(settingsPath, data);
  return {
    provider: 't3-settings',
    configured: true,
    path: settingsPath,
    detail:
      changed.length > 0
        ? `Enabled providers/instances: ${changed.join(', ')}`
        : 'All common providers already enabled (or created)',
    action: changed.length > 0 ? 'updated' : undefined,
  };
}

function hasMcpInJson(filePath: string, keyPaths: string[]): boolean {
  if (!fs.existsSync(filePath)) return false;
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw.includes('t3-coordinator')) return false;
    const data = JSON.parse(raw) as Record<string, unknown>;
    for (const kp of keyPaths) {
      const parts = kp.split('.');
      let cur: unknown = data;
      for (const p of parts) {
        if (!cur || typeof cur !== 'object') {
          cur = undefined;
          break;
        }
        cur = (cur as Record<string, unknown>)[p];
      }
      if (cur && typeof cur === 'object' && 't3-coordinator' in (cur as object)) return true;
    }
    return raw.includes('t3-coordinator');
  } catch {
    return fs.readFileSync(filePath, 'utf8').includes('t3-coordinator');
  }
}

/** Register t3-coordinator MCP on every common supervisor provider. */
export function ensureMcpProviders(): {
  bin: string;
  providers: McpProviderStatus[];
  hint: string;
} {
  const bin = coordinatorBin();
  const providers = [
    ensureCodexMcp(bin),
    ensureCursorMcp(bin),
    ensureClaudeMcp(bin),
    ensureOpenCodeMcp(bin),
    ensureGrokMcp(bin),
    ensureT3ProvidersEnabled(),
  ];
  return {
    bin,
    providers,
    hint: 'Pick any supervisor provider in a NEW T3 chat — MCP is registered on Codex, Cursor, Claude, OpenCode, and Grok (when present). Restart/new chat required to load tools.',
  };
}

export function mcpProviderReport(): McpProviderStatus[] {
  const home = os.homedir();
  const codexConfig = path.join(home, '.codex', 'config.toml');
  const cursorMcp = path.join(home, '.cursor', 'mcp.json');
  const claudeSettings = path.join(home, '.claude', 'settings.json');
  const claudeLegacy = path.join(home, '.claude.json');
  const opencodeJson = path.join(home, '.config', 'opencode', 'opencode.json');
  const grokMcp = path.join(home, '.grok', 'mcp.json');
  const t3Settings = path.join(home, '.t3', 'userdata', 'settings.json');

  const codexOk =
    fs.existsSync(codexConfig) &&
    fs.readFileSync(codexConfig, 'utf8').includes('[mcp_servers.t3-coordinator]');
  const cursorOk = hasMcpInJson(cursorMcp, ['mcpServers']);
  const claudeOk =
    hasMcpInJson(claudeSettings, ['mcpServers']) || hasMcpInJson(claudeLegacy, ['mcpServers']);
  const opencodeOk = hasMcpInJson(opencodeJson, ['mcp']);
  const grokOk = hasMcpInJson(grokMcp, ['mcpServers']);

  return [
    {
      provider: 'codex',
      configured: codexOk,
      path: codexConfig,
      detail: codexOk ? 'ok' : 'missing — run ensure-mcp',
    },
    {
      provider: 'cursor',
      configured: cursorOk,
      path: cursorMcp,
      detail: cursorOk ? 'ok' : 'missing — run ensure-mcp',
    },
    {
      provider: 'claude',
      configured: claudeOk,
      path: fs.existsSync(claudeSettings) ? claudeSettings : claudeLegacy,
      detail: claudeOk ? 'ok' : 'missing — run ensure-mcp',
    },
    {
      provider: 'opencode',
      configured: opencodeOk,
      path: opencodeJson,
      detail: opencodeOk ? 'ok' : 'missing — run ensure-mcp',
    },
    {
      provider: 'grok',
      configured: grokOk,
      path: grokMcp,
      detail: grokOk ? 'ok' : fs.existsSync(path.join(home, '.grok')) ? 'missing' : 'not installed',
    },
    {
      provider: 't3-settings',
      configured: fs.existsSync(t3Settings),
      path: t3Settings,
      detail: fs.existsSync(t3Settings) ? 'present' : 'no T3 userdata',
    },
  ];
}
