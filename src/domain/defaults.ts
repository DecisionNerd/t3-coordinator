import * as fs from 'node:fs';
import * as path from 'node:path';
import { coordinatorHome } from './bindings';

/** Operator defaults so `@t3-coordinator 192` does not need every assign_work field. */
export interface ProjectDefaults {
  version: 1;
  environmentId: string;
  /** T3 project id — passed as assign_work.repo */
  t3ProjectId: string;
  /** GitHub `owner/name` for issue/milestone lookup */
  githubRepo: string;
  projectCwd: string;
  baseBranch: string;
  instanceId: string;
  modelId: string;
}

export function defaultsPath(home = coordinatorHome()): string {
  return path.join(home, 'defaults.json');
}

export function readDefaults(filePath = defaultsPath()): ProjectDefaults | null {
  if (!fs.existsSync(filePath)) return null;
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as ProjectDefaults;
  if (parsed.version !== 1 || !parsed.t3ProjectId || !parsed.githubRepo || !parsed.projectCwd) {
    throw new Error(`Invalid defaults file: ${filePath}`);
  }
  return parsed;
}

export function writeDefaults(
  defaults: ProjectDefaults,
  filePath = defaultsPath(),
): ProjectDefaults {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(defaults, null, 2)}\n`, 'utf8');
  return defaults;
}

export function requireDefaults(filePath = defaultsPath()): ProjectDefaults {
  const d = readDefaults(filePath);
  if (!d) {
    throw new Error(
      `Missing ${filePath}. Set once with: t3-coordinator defaults-set --github owner/repo --t3-project <uuid> --cwd <path> --instance <id> --model <id>`,
    );
  }
  return d;
}
