import { describe, expect, it } from 'vitest';
import { isLegacyVersion, LEGACY_LAST_VERSION } from '../src/util/constants';
import { Version } from '../src/util/version';

describe('Version', () => {
  it('parses and compares semantic versions', () => {
    expect(Version.parse('1.2.3').compareTo(Version.parse('1.2.3'))).toBe(0);
    expect(Version.parse('0.7.0').compareTo(Version.parse('0.6.9'))).toBeGreaterThan(0);
    expect(Version.parse('0.6.9').compareTo(Version.parse('0.7.0'))).toBeLessThan(0);
  });
});

describe('isLegacyVersion', () => {
  it('treats the legacy boundary inclusively', () => {
    expect(LEGACY_LAST_VERSION.toString()).toBe(Version.parse('0.0.52').toString());
    expect(isLegacyVersion(Version.parse('0.0.52'))).toBe(true);
    expect(isLegacyVersion(Version.parse('0.0.51'))).toBe(true);
    expect(isLegacyVersion(Version.parse('0.0.53'))).toBe(false);
    expect(isLegacyVersion(Version.parse('0.7.0'))).toBe(false);
  });

  it('treats unknown versions as current, not legacy', () => {
    expect(isLegacyVersion(undefined)).toBe(false);
  });
});
