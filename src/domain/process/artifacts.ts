import * as fs from 'node:fs';
import * as path from 'node:path';

export function instanceDir(projectCwd: string, processInstanceId: string): string {
  return path.join(projectCwd, '.t3', 'instances', processInstanceId);
}

export function writeArtifact(
  projectCwd: string,
  processInstanceId: string,
  name: string,
  value: unknown,
): string {
  const dir = instanceDir(projectCwd, processInstanceId);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${name}.json`);
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return filePath;
}

export function readArtifact<T>(projectCwd: string, processInstanceId: string, name: string): T | null {
  const filePath = path.join(instanceDir(projectCwd, processInstanceId), `${name}.json`);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
}
