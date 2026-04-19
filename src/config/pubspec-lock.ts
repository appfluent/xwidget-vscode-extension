import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { parse as parseYaml } from 'yaml';
import { PUBSPEC_LOCK_FILE } from '../util/constants';
import { Version } from '../util/version';

/**
 * Lightweight reader for pubspec.lock. Only exposes what the extension needs
 * (package versions) — mirrors the IntelliJ plugin's PubspecLock class.
 */
export class PubspecLock {
  constructor(private readonly data: Record<string, unknown>) {}

  /**
   * Returns the resolved version for the given package, or undefined when
   * the package is not present in the lockfile. Unparseable version strings
   * also return undefined rather than throwing.
   */
  getPackageVersion(packageName: string): Version | undefined {
    const packages = this.data['packages'];
    if (packages === null || typeof packages !== 'object') return undefined;

    const pkg = (packages as Record<string, unknown>)[packageName];
    if (pkg === null || typeof pkg !== 'object') return undefined;

    const version = (pkg as Record<string, unknown>)['version'];
    if (typeof version !== 'string') return undefined;

    try {
      return Version.parse(version);
    } catch {
      return undefined;
    }
  }
}

/**
 * Reads and parses pubspec.lock from the given workspace root. Returns
 * undefined when the file is missing or cannot be parsed — callers treat
 * that the same as "XWidget not installed" (no version-gated features).
 */
export async function readPubspecLock(workspaceRoot: string): Promise<PubspecLock | undefined> {
  const lockPath = path.join(workspaceRoot, PUBSPEC_LOCK_FILE);
  let raw: string;
  try {
    raw = await fs.readFile(lockPath, 'utf8');
  } catch {
    return undefined;
  }

  try {
    const parsed = parseYaml(raw);
    if (parsed === null || typeof parsed !== 'object') return undefined;
    return new PubspecLock(parsed as Record<string, unknown>);
  } catch {
    return undefined;
  }
}
