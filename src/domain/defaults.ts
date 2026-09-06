import * as fs from 'node:fs';
import * as path from 'node:path';
import { coordinatorHome } from './bindings';

/**
 * Optional worker / assign prefs. GitHub repo is NOT stored as a sticky default —
 * it is detected from the current T3 project checkout (git root + remote / gh).
 */
export interface ProjectDefaults {
  version: 1;
  environmentId?: string;
  /** T3 project id — passed as assign_work.repo */
  t3ProjectId?: string;
  /**
   * @deprecated Do not set a sticky default repo. Prefer the current checkout.
   * Ignored by resolveProjectContext except as a last-resort cwd hint.
   */
  githubRepo?: string;
  /** Optional cwd hint when MCP cwd is wrong; prefer COORD_PROJECT_CWD. */
  projectCwd?: string;
  baseBranch?: string;
  instanceId?: string;
  modelId?: string;
  /** Optional author for coordinator-made commits (spec SHA). Never writes git config. */
  gitUserName?: string;
  gitUserEmail?: string;
}

export function defaultsPath(home = coordinatorHome()): string {
  return path.join(home, 'defaults.json');
}

export function readDefaults(filePath = defaultsPath()): ProjectDefaults | null {
  if (!fs.existsSync(filePath)) return null;
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as ProjectDefaults;
  if (parsed.version !== 1) {
    throw new Error(`Invalid defaults file (version): ${filePath}`);
  }
  return parsed;
}

export function writeDefaults(
  defaults: ProjectDefaults,
  filePath = defaultsPath(),
): ProjectDefaults {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  // Strip empty githubRepo so we don't encourage sticky default repos
  const cleaned: ProjectDefaults = { ...defaults, version: 1 };
  if (!cleaned.githubRepo) delete cleaned.githubRepo;
  fs.writeFileSync(filePath, `${JSON.stringify(cleaned, null, 2)}\n`, 'utf8');
  return cleaned;
}

/** Merge patch into existing defaults (partial updates). */
export function mergeDefaults(
  patch: Partial<Omit<ProjectDefaults, 'version'>>,
  filePath = defaultsPath(),
): ProjectDefaults {
  const current = readDefaults(filePath) ?? { version: 1 as const };
  const next: ProjectDefaults = {
    ...current,
    ...patch,
    version: 1,
  };
  // Explicitly clearing githubRepo
  if ('githubRepo' in patch && !patch.githubRepo) {
    delete next.githubRepo;
  }
  return writeDefaults(next, filePath);
}
