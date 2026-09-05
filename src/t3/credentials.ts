import * as fs from 'node:fs';
import * as path from 'node:path';
import { coordinatorHome } from '../domain/bindings';

export interface T3Credentials {
  baseUrl: string;
  token: string;
  sessionId?: string;
  expiresAt?: string;
  label?: string;
  t3Version?: string;
}

interface CredentialsFile {
  version: 1;
  t3?: T3Credentials;
}

export function credentialsPath(home = coordinatorHome()): string {
  return path.join(home, 'credentials.json');
}

export function readT3Credentials(filePath = credentialsPath()): T3Credentials | undefined {
  const fromEnvBase = process.env.T3_BASE_URL;
  const fromEnvToken = process.env.T3_TOKEN;
  if (fromEnvBase && fromEnvToken) {
    return {
      baseUrl: fromEnvBase.replace(/\/$/, ''),
      token: fromEnvToken,
      t3Version: process.env.T3_VERSION,
    };
  }
  if (!fs.existsSync(filePath)) return undefined;
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as CredentialsFile;
  if (parsed.version !== 1 || !parsed.t3?.baseUrl || !parsed.t3?.token) {
    throw new Error(`Invalid credentials file: ${filePath}`);
  }
  return {
    ...parsed.t3,
    baseUrl: parsed.t3.baseUrl.replace(/\/$/, ''),
  };
}

export function writeT3Credentials(
  creds: T3Credentials,
  filePath = credentialsPath(),
): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const next: CredentialsFile = {
    version: 1,
    t3: {
      ...creds,
      baseUrl: creds.baseUrl.replace(/\/$/, ''),
    },
  };
  fs.writeFileSync(filePath, `${JSON.stringify(next, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.chmodSync(filePath, 0o600);
}
