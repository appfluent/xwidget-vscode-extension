/**
 * SemVer-like version parsing and comparison. Matches the behaviour of the
 * IntelliJ plugin's Version.kt so legacy-vs-current command gating produces
 * identical results.
 */
export class Version {
  constructor(
    readonly major: number,
    readonly minor: number,
    readonly patch: number,
    readonly preRelease: string[] = [],
    readonly build: string[] = [],
  ) {}

  static parse(raw: string): Version {
    const [mainAndPre, ...buildParts] = raw.split('+');
    const build = buildParts.join('+').split('.').filter((s) => s.length > 0);

    const [core, ...preParts] = mainAndPre.split('-');
    const pre = preParts.join('-').split('.').filter((s) => s.length > 0);

    const coreParts = core.split('.');
    const major = parseIntSafe(coreParts[0]);
    const minor = parseIntSafe(coreParts[1]);
    const patch = parseIntSafe(coreParts[2]);

    return new Version(major, minor, patch, pre, build);
  }

  /**
   * Returns <0 if this < other, 0 if equal, >0 if this > other.
   * Build metadata is ignored for ordering (same as IntelliJ port).
   */
  compareTo(other: Version): number {
    const core =
      this.major - other.major ||
      this.minor - other.minor ||
      this.patch - other.patch;
    if (core !== 0) return core;

    // A release is greater than a pre-release with the same core.
    if (this.preRelease.length === 0 && other.preRelease.length > 0) return 1;
    if (this.preRelease.length > 0 && other.preRelease.length === 0) return -1;

    const max = Math.max(this.preRelease.length, other.preRelease.length);
    for (let i = 0; i < max; i++) {
      const a = this.preRelease[i];
      const b = other.preRelease[i];
      if (a === undefined) return -1;
      if (b === undefined) return 1;
      const numA = toIntOrUndefined(a);
      const numB = toIntOrUndefined(b);
      let cmp: number;
      if (numA !== undefined && numB !== undefined) {
        cmp = numA - numB;
      } else if (numA !== undefined) {
        cmp = -1; // numbers < strings
      } else if (numB !== undefined) {
        cmp = 1;
      } else {
        cmp = a < b ? -1 : a > b ? 1 : 0;
      }
      if (cmp !== 0) return cmp;
    }
    return 0;
  }

  isGreaterThan(other: Version): boolean {
    return this.compareTo(other) > 0;
  }

  isGreaterThanOrEqualTo(other: Version): boolean {
    return this.compareTo(other) >= 0;
  }

  toString(): string {
    let s = `${this.major}.${this.minor}.${this.patch}`;
    if (this.preRelease.length > 0) s += `-${this.preRelease.join('.')}`;
    if (this.build.length > 0) s += `+${this.build.join('.')}`;
    return s;
  }
}

function parseIntSafe(s: string | undefined): number {
  if (s === undefined) return 0;
  const n = parseInt(s, 10);
  return Number.isNaN(n) ? 0 : n;
}

function toIntOrUndefined(s: string): number | undefined {
  if (!/^-?\d+$/.test(s)) return undefined;
  const n = parseInt(s, 10);
  return Number.isNaN(n) ? undefined : n;
}
