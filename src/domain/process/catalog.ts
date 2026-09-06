import * as fs from 'node:fs';
import * as path from 'node:path';
import { coordinatorHome } from '../bindings';
import { ON_FAIL_ACTIONS, STEP_ROLES, type ProcessDefinition, type ProcessStep } from './types';

export function shippedTemplatesRoot(): string {
  return path.resolve(__dirname, '../../../templates');
}

export function processSearchDirs(projectCwd?: string): string[] {
  const dirs = [
    path.join(coordinatorHome(), 'processes'),
    path.join(shippedTemplatesRoot(), 'processes'),
  ];
  if (projectCwd) dirs.unshift(path.join(projectCwd, '.t3', 'processes'));
  return dirs;
}

function isOnFailAction(value: unknown): value is ProcessStep['onFail'][number] {
  return typeof value === 'string' && (ON_FAIL_ACTIONS as readonly string[]).includes(value);
}

function parseTimeoutMs(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return raw;
  if (typeof raw === 'string') {
    const m = raw.trim().match(/^(\d+)\s*(ms|s|m|h)?$/i);
    if (m) {
      const n = Number(m[1]);
      const unit = (m[2] ?? 'ms').toLowerCase();
      if (unit === 'ms') return n;
      if (unit === 's') return n * 1000;
      if (unit === 'm') return n * 60 * 1000;
      if (unit === 'h') return n * 60 * 60 * 1000;
    }
  }
  return 600_000;
}

function parseStep(raw: Record<string, unknown>, processId: string): ProcessStep {
  const id = String(raw.id ?? '');
  const onFail = Array.isArray(raw.onFail) ? raw.onFail : [];
  if (!id) throw new Error(`Process ${processId}: step missing id`);
  if (onFail.length === 0 || !onFail.every(isOnFailAction)) {
    throw new Error(`Process ${processId} step ${id}: onFail is required and must be a non-empty list of known actions`);
  }
  const role = raw.role;
  if (typeof role !== 'string' || !(STEP_ROLES as readonly string[]).includes(role)) {
    throw new Error(`Process ${processId} step ${id}: invalid role`);
  }
  const engine = raw.engine === 'native' ? 'native' : 'worker';
  return {
    id,
    process: String(raw.process ?? processId),
    role: role as ProcessStep['role'],
    engine,
    in: Array.isArray(raw.in) ? raw.in.map(String) : [],
    out: Array.isArray(raw.out) ? raw.out.map(String) : [],
    timeoutMs: parseTimeoutMs(raw.timeoutMs ?? raw.timeout),
    dependsOn: Array.isArray(raw.dependsOn) ? raw.dependsOn.map(String) : undefined,
    onFail,
    retrySameMax: typeof raw.retrySameMax === 'number' ? raw.retrySameMax : undefined,
    retryRoleMax: typeof raw.retryRoleMax === 'number' ? raw.retryRoleMax : undefined,
    goalTemplate: typeof raw.goalTemplate === 'string' ? raw.goalTemplate : undefined,
  };
}

export function parseProcessDefinition(raw: unknown, source: string): ProcessDefinition {
  if (!raw || typeof raw !== 'object') throw new Error(`Invalid process file: ${source}`);
  const rec = raw as Record<string, unknown>;
  const id = String(rec.id ?? '');
  if (!id) throw new Error(`Process missing id: ${source}`);
  const stepsRaw = rec.steps;
  if (!Array.isArray(stepsRaw)) {
    throw new Error(`Process ${id}: steps required`);
  }
  const steps = stepsRaw.map((s) => parseStep(s as Record<string, unknown>, id));
  return {
    id,
    consumes: Array.isArray(rec.consumes) ? rec.consumes.map(String) : [],
    produces: Array.isArray(rec.produces) ? rec.produces.map(String) : [],
    classify: rec.classify !== false,
    classification:
      rec.classification && typeof rec.classification === 'object'
        ? {
            signals: Array.isArray((rec.classification as { signals?: unknown }).signals)
              ? ((rec.classification as { signals: unknown[] }).signals).map(String)
              : [],
            excludes: Array.isArray((rec.classification as { excludes?: unknown }).excludes)
              ? ((rec.classification as { excludes: unknown[] }).excludes).map(String)
              : [],
            threshold: Number((rec.classification as { threshold?: unknown }).threshold ?? 0.75),
          }
        : undefined,
    steps,
  };
}

export function typeCheckProcess(def: ProcessDefinition): void {
  const produced = new Set(def.consumes);
  for (const step of def.steps) {
    for (const need of step.in) {
      if (!produced.has(need)) {
        throw new Error(`Process ${def.id} step ${step.id}: input ${need} is not produced earlier`);
      }
    }
    for (const out of step.out) produced.add(out);
  }
}

function readJsonFiles(dir: string): ProcessDefinition[] {
  if (!fs.existsSync(dir)) return [];
  const out: ProcessDefinition[] = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.json') || name.startsWith('_') || name.includes('.schema.')) continue;
    const full = path.join(dir, name);
    const parsed = JSON.parse(fs.readFileSync(full, 'utf8')) as unknown;
    const def = parseProcessDefinition(parsed, full);
    typeCheckProcess(def);
    out.push(def);
  }
  return out;
}

/** Later dirs win on id collision (overlay → shipped). Search order: project, home, shipped. */
export function loadProcessCatalog(projectCwd?: string): ProcessDefinition[] {
  const byId = new Map<string, ProcessDefinition>();
  for (const dir of [...processSearchDirs(projectCwd)].reverse()) {
    for (const def of readJsonFiles(dir)) {
      byId.set(def.id, def);
    }
  }
  return [...byId.values()];
}

export function getProcess(id: string, projectCwd?: string): ProcessDefinition {
  const found = loadProcessCatalog(projectCwd).find((p) => p.id === id);
  if (!found) throw new Error(`Unknown process: ${id}`);
  return found;
}
