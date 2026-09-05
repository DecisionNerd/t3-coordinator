import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { BindingsFile, SupervisorBinding } from './contracts';

export function coordinatorHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.T3_COORDINATOR_HOME ?? path.join(os.homedir(), '.t3-coordinator');
}

export function bindingsPath(home = coordinatorHome()): string {
  return path.join(home, 'bindings.json');
}

function emptyBindings(): BindingsFile {
  return { version: 1, supervisors: {} };
}

export function readBindings(filePath = bindingsPath()): BindingsFile {
  if (!fs.existsSync(filePath)) {
    return emptyBindings();
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(raw) as BindingsFile;
  if (parsed.version !== 1 || typeof parsed.supervisors !== 'object') {
    throw new Error(`Invalid bindings file: ${filePath}`);
  }
  return parsed;
}

export function writeBindings(bindings: BindingsFile, filePath = bindingsPath()): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(bindings, null, 2)}\n`, 'utf8');
}

export function getSupervisorBinding(
  environmentId: string,
  filePath = bindingsPath(),
): SupervisorBinding | undefined {
  return readBindings(filePath).supervisors[environmentId];
}

export function bindSupervisor(input: {
  environmentId: string;
  supervisorThreadId: string;
  filePath?: string;
}): SupervisorBinding {
  const filePath = input.filePath ?? bindingsPath();
  const bindings = readBindings(filePath);
  const binding: SupervisorBinding = {
    environmentId: input.environmentId,
    supervisorThreadId: input.supervisorThreadId,
    boundAt: new Date().toISOString(),
  };
  bindings.supervisors[input.environmentId] = binding;
  writeBindings(bindings, filePath);
  return binding;
}
