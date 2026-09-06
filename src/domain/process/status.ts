import * as fs from 'node:fs';
import * as path from 'node:path';
import type { FailureClass, OnFailAction } from './types';

export interface ProcessInstanceStatus {
  processInstanceId: string;
  processId: string;
  state: 'running' | 'blocked' | 'cancelled' | 'completed';
  stepId?: string;
  failureClass?: FailureClass;
  allowedNext?: OnFailAction[];
  assignmentId?: string;
  updatedAt?: string;
}

export function instancesRoot(projectCwd: string): string {
  return path.join(projectCwd, '.t3', 'instances');
}

export function writeInstanceStatus(
  projectCwd: string,
  status: ProcessInstanceStatus,
): string {
  const dir = path.join(instancesRoot(projectCwd), status.processInstanceId);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, 'status.json');
  const next: ProcessInstanceStatus = {
    ...status,
    updatedAt: status.updatedAt || new Date().toISOString(),
  };
  fs.writeFileSync(filePath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  const current = path.join(instancesRoot(projectCwd), 'current.json');
  fs.writeFileSync(
    current,
    `${JSON.stringify({ processInstanceId: status.processInstanceId, updatedAt: next.updatedAt }, null, 2)}\n`,
    'utf8',
  );
  return filePath;
}

export function readInstanceStatus(
  projectCwd: string,
  processInstanceId: string,
): ProcessInstanceStatus | null {
  const filePath = path.join(instancesRoot(projectCwd), processInstanceId, 'status.json');
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as ProcessInstanceStatus;
}

export function readCurrentInstanceId(projectCwd: string): string | null {
  const filePath = path.join(instancesRoot(projectCwd), 'current.json');
  if (!fs.existsSync(filePath)) return null;
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as { processInstanceId?: string };
  return parsed.processInstanceId ?? null;
}

export function listProcessInstances(projectCwd: string): ProcessInstanceStatus[] {
  const root = instancesRoot(projectCwd);
  if (!fs.existsSync(root)) return [];
  const out: ProcessInstanceStatus[] = [];
  for (const name of fs.readdirSync(root)) {
    if (name === 'current.json') continue;
    const status = readInstanceStatus(projectCwd, name);
    if (status) out.push(status);
  }
  return out.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
}

export function listBlockedProcessInstances(projectCwd: string): ProcessInstanceStatus[] {
  return listProcessInstances(projectCwd).filter((s) => s.state === 'blocked' || s.state === 'cancelled');
}
