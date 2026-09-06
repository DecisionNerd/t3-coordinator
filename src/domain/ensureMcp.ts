import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export type McpProviderStatus = {
  provider: 'codex' | 'cursor' | 'opencode';
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
  if (fromPath) return fromPath;
  const fallback = path.join(os.homedir(), '.local', 'bin', 't3-coordinator');
  return fallback;
}

function ensureCursorMcp(bin: string): McpProviderStatus {
  const mcpPath = path.join(os.homedir(), '.cursor', 'mcp.json');
  let data: { mcpServers?: Record<string, { command?: string; args?: string[] }> } = {};
  if (fs.existsSync(mcpPath)) {
    try {
      data = JSON.parse(fs.readFileSync(mcpPath, 'utf8')) as typeof data;
    } catch {
      data = {};
    }
  }
  data.mcpServers = data.mcpServers ?? {};
  const existing = data.mcpServers['t3-coordinator'];
  if (
    existing?.command === bin &&
    Array.isArray(existing.args) &&
    existing.args.length === 1 &&
    existing.args[0] === 'mcp'
  ) {
    return {
      provider: 'cursor',
      configured: true,
      path: mcpPath,
      detail: 't3-coordinator already in ~/.cursor/mcp.json',
    };
  }
  data.mcpServers['t3-coordinator'] = { command: bin, args: ['mcp'] };
  fs.mkdirSync(path.dirname(mcpPath), { recursive: true });
  fs.writeFileSync(mcpPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
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
    // Remove stale entry then add with absolute binary so every new Codex/T3 chat sees it
    spawnSync(codex, ['mcp', 'remove', 't3-coordinator'], { encoding: 'utf8' });
    const add = spawnSync(codex, ['mcp', 'add', 't3-coordinator', '--', bin, 'mcp'], {
      encoding: 'utf8',
    });
    if (add.status === 0) {
      return {
        provider: 'codex',
        configured: true,
        path: configPath,
        detail: `Registered via codex mcp add → ${bin} mcp`,
        action: 'updated',
      };
    }
  }

  // Fallback: edit config.toml directly
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
      block.trim() + '\n',
    );
  } else {
    toml = `${toml.trimEnd()}\n${block}`;
  }
  fs.writeFileSync(configPath, toml.endsWith('\n') ? toml : `${toml}\n`, 'utf8');
  return {
    provider: 'codex',
    configured: true,
    path: configPath,
    detail: codex
      ? `codex mcp add failed; wrote ${configPath} directly`
      : `Wrote ${configPath} (codex CLI not on PATH)`,
    action: 'updated',
  };
}

function ensureOpenCodeMcp(bin: string): McpProviderStatus {
  const candidates = [
    path.join(os.homedir(), '.config', 'opencode', 'opencode.json'),
    path.join(os.homedir(), '.config', 'opencode', 'opencode.jsonc'),
    path.join(os.homedir(), '.opencode', 'config.json'),
  ];
  const existing = candidates.find((p) => fs.existsSync(p));
  if (!existing) {
    return {
      provider: 'opencode',
      configured: false,
      detail: 'No OpenCode config found — skipped',
    };
  }
  // OpenCode JSONC may have comments — only rewrite pure JSON files
  if (existing.endsWith('.jsonc')) {
    return {
      provider: 'opencode',
      configured: false,
      path: existing,
      detail: `Found ${existing}; add mcp.t3-coordinator manually if you use OpenCode as supervisor`,
    };
  }
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(fs.readFileSync(existing, 'utf8')) as Record<string, unknown>;
  } catch {
    return {
      provider: 'opencode',
      configured: false,
      path: existing,
      detail: `Could not parse ${existing}`,
    };
  }
  const mcp = (data.mcp as Record<string, unknown> | undefined) ?? {};
  mcp['t3-coordinator'] = {
    type: 'local',
    command: [bin, 'mcp'],
    enabled: true,
  };
  data.mcp = mcp;
  fs.writeFileSync(existing, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  return {
    provider: 'opencode',
    configured: true,
    path: existing,
    detail: `Wrote t3-coordinator into ${existing}`,
    action: 'updated',
  };
}

/** Register t3-coordinator MCP on supervisor providers so every new T3 chat can see the tools. */
export function ensureMcpProviders(): {
  bin: string;
  providers: McpProviderStatus[];
  hint: string;
} {
  const bin = coordinatorBin();
  const providers = [ensureCodexMcp(bin), ensureCursorMcp(bin), ensureOpenCodeMcp(bin)];
  return {
    bin,
    providers,
    hint: 'New T3 chats use the provider MCP config (Codex/Cursor). Start a new chat (or restart the provider session) to load tools — no bind-supervisor required to see MCP.',
  };
}

export function mcpProviderReport(): McpProviderStatus[] {
  const bin = coordinatorBin();
  const codexConfig = path.join(os.homedir(), '.codex', 'config.toml');
  const cursorMcp = path.join(os.homedir(), '.cursor', 'mcp.json');
  const out: McpProviderStatus[] = [];

  const codexConfigured =
    fs.existsSync(codexConfig) &&
    fs.readFileSync(codexConfig, 'utf8').includes('[mcp_servers.t3-coordinator]');
  out.push({
    provider: 'codex',
    configured: codexConfigured,
    path: codexConfig,
    detail: codexConfigured
      ? 'mcp_servers.t3-coordinator present'
      : 'Missing — run t3-coordinator ensure-mcp (T3 Astra/Codex chats need this)',
  });

  let cursorConfigured = false;
  if (fs.existsSync(cursorMcp)) {
    try {
      const j = JSON.parse(fs.readFileSync(cursorMcp, 'utf8')) as {
        mcpServers?: Record<string, unknown>;
      };
      cursorConfigured = Boolean(j.mcpServers?.['t3-coordinator']);
    } catch {
      cursorConfigured = false;
    }
  }
  out.push({
    provider: 'cursor',
    configured: cursorConfigured,
    path: cursorMcp,
    detail: cursorConfigured ? 'present in mcp.json' : 'Missing — run t3-coordinator ensure-mcp',
  });

  void bin;
  return out;
}
