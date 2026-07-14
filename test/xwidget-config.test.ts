import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readXWidgetConfig, XWidgetConfigError } from '../src/config/xwidget-config';

// The config reader is the extension's source of truth for fragment/values
// paths — these tests pin the two-location discovery (builder >= 0.7.0 puts
// the file in .xwidget/, older projects at the root) and the defaulting.
describe('readXWidgetConfig', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'xwidget-config-test-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function writeRoot(content: string) {
    writeFileSync(path.join(root, 'xwidget_config.yaml'), content);
  }

  function writeConfigDir(content: string) {
    mkdirSync(path.join(root, '.xwidget'), { recursive: true });
    writeFileSync(path.join(root, '.xwidget', 'xwidget_config.yaml'), content);
  }

  it('returns defaults when no config exists anywhere', async () => {
    const config = await readXWidgetConfig(root);
    expect(config.fragmentsPath).toBe('resources/fragments');
    expect(config.valuesPath).toBe('resources/values');
    expect(config.inflaters.sources).toEqual(['lib/xwidget/inflater_spec.dart']);
  });

  it('reads from the project root (pre-0.7.0 layout)', async () => {
    writeRoot('fragmentsPath: legacy/fragments');
    const config = await readXWidgetConfig(root);
    expect(config.fragmentsPath).toBe('legacy/fragments');
  });

  it('reads from .xwidget/ (0.7.0 layout)', async () => {
    writeConfigDir('fragmentsPath: modern/fragments');
    const config = await readXWidgetConfig(root);
    expect(config.fragmentsPath).toBe('modern/fragments');
  });

  it('prefers .xwidget/ when both locations exist', async () => {
    writeConfigDir('fragmentsPath: modern/fragments');
    writeRoot('fragmentsPath: stale/fragments');
    const config = await readXWidgetConfig(root);
    expect(config.fragmentsPath).toBe('modern/fragments');
  });

  it('fills defaults for everything a partial config omits', async () => {
    writeConfigDir('valuesPath: custom/values');
    const config = await readXWidgetConfig(root);
    expect(config.valuesPath).toBe('custom/values');
    expect(config.fragmentsPath).toBe('resources/fragments');
    expect(config.icons.sources).toEqual(['lib/xwidget/icon_spec.dart']);
    expect(config.schema.types).toEqual({});
  });

  it('parses nested snake_case keys', async () => {
    writeConfigDir(
      [
        'inflaters:',
        '  constructor_exclusions:',
        '    - "TestExclusions:excludedArg"',
        '  constructor_arg_defaults:',
        '    "TestExclusions:visible": "\'fallback\'"',
      ].join('\n'),
    );
    const config = await readXWidgetConfig(root);
    expect(config.inflaters.constructorExclusions).toEqual(['TestExclusions:excludedArg']);
    expect(config.inflaters.constructorArgDefaults).toEqual({
      'TestExclusions:visible': "'fallback'",
    });
  });

  it('returns defaults for an empty file', async () => {
    writeConfigDir('');
    const config = await readXWidgetConfig(root);
    expect(config.fragmentsPath).toBe('resources/fragments');
  });

  it('throws XWidgetConfigError on malformed YAML', async () => {
    writeConfigDir('fragmentsPath: [unclosed');
    await expect(readXWidgetConfig(root)).rejects.toThrow(XWidgetConfigError);
  });

  it('throws XWidgetConfigError when the document is not a map', async () => {
    writeConfigDir('- just\n- a\n- list');
    await expect(readXWidgetConfig(root)).rejects.toThrow(XWidgetConfigError);
  });
});
