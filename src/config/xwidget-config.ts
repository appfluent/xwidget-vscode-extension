import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { parse as parseYaml } from 'yaml';
import {
  DEFAULT_FRAGMENTS_PATH,
  DEFAULT_ICON_SOURCES,
  DEFAULT_INFLATER_SOURCES,
  DEFAULT_VALUES_PATH,
  CONFIG_FILE,
} from '../util/constants';

/**
 * Typed representation of xwidget_config.yaml. Mirrors the IntelliJ plugin's
 * XWidgetConfig class (XWidgetService.kt) including all defaults, so values
 * behave identically between the two IDEs.
 */
export interface XWidgetConfig {
  fragmentsPath: string;
  valuesPath: string;
  inflaters: XWidgetInflaters;
  icons: XWidgetIcons;
  controllers: XWidgetControllers;
  schema: XWidgetSchema;
}

export interface XWidgetInflaters {
  target: string;
  imports: string[];
  sources: string[];
  includes: string[];
  constructorExclusions: string[];
  constructorArgDefaults: Record<string, string>;
  constructorArgParsers: Record<string, string>;
}

export interface XWidgetIcons {
  target: string;
  imports: string[];
  sources: string[];
}

export interface XWidgetControllers {
  target: string;
  imports: string[];
  sources: string[];
}

export interface XWidgetSchema {
  target: string;
  template: string;
  types: Record<string, string>;
  attributeExclusions: string[];
}

/**
 * Errors raised by readXWidgetConfig are user-actionable — the caller
 * (XWidgetService) surfaces them via a notification. Bad YAML shouldn't
 * crash activation, hence the try/catch in the service rather than here.
 */
export class XWidgetConfigError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'XWidgetConfigError';
  }
}

/**
 * Reads xwidget_config.yaml from the given workspace folder root. Returns
 * defaults when the file is absent (so downstream code can always rely on
 * populated values). Throws XWidgetConfigError on malformed YAML.
 */
export async function readXWidgetConfig(workspaceRoot: string): Promise<XWidgetConfig> {
  const configPath = path.join(workspaceRoot, CONFIG_FILE);
  let raw: string;
  try {
    raw = await fs.readFile(configPath, 'utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return buildConfig({});
    }
    throw new XWidgetConfigError(`Failed to read ${CONFIG_FILE}`, err);
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (err) {
    throw new XWidgetConfigError(`Failed to parse ${CONFIG_FILE}`, err);
  }

  if (parsed === null || parsed === undefined) {
    return buildConfig({});
  }
  if (typeof parsed !== 'object') {
    throw new XWidgetConfigError(`${CONFIG_FILE} must be a YAML map`);
  }
  return buildConfig(parsed as RawConfig);
}

/**
 * Builds a fully-populated XWidgetConfig from a possibly-partial raw object,
 * applying defaults for every missing field. Accepts `undefined` / empty
 * input and returns the all-defaults config.
 */
function buildConfig(raw: RawConfig): XWidgetConfig {
  return {
    fragmentsPath: stringOr(raw.fragmentsPath, DEFAULT_FRAGMENTS_PATH),
    valuesPath: stringOr(raw.valuesPath, DEFAULT_VALUES_PATH),
    inflaters: {
      target: stringOr(raw.inflaters?.target, ''),
      imports: stringArrayOr(raw.inflaters?.imports, []),
      sources: stringArrayOr(raw.inflaters?.sources, DEFAULT_INFLATER_SOURCES),
      includes: stringArrayOr(raw.inflaters?.includes, []),
      constructorExclusions: stringArrayOr(raw.inflaters?.constructor_exclusions, []),
      constructorArgDefaults: stringMapOr(raw.inflaters?.constructor_arg_defaults, {}),
      constructorArgParsers: stringMapOr(raw.inflaters?.constructor_arg_parsers, {}),
    },
    icons: {
      target: stringOr(raw.icons?.target, ''),
      imports: stringArrayOr(raw.icons?.imports, []),
      sources: stringArrayOr(raw.icons?.sources, DEFAULT_ICON_SOURCES),
    },
    controllers: {
      target: stringOr(raw.controllers?.target, ''),
      imports: stringArrayOr(raw.controllers?.imports, []),
      sources: stringArrayOr(raw.controllers?.sources, []),
    },
    schema: {
      target: stringOr(raw.schema?.target, ''),
      template: stringOr(raw.schema?.template, ''),
      types: stringMapOr(raw.schema?.types, {}),
      attributeExclusions: stringArrayOr(raw.schema?.attribute_exclusions, []),
    },
  };
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function stringArrayOr(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  return value.filter((v): v is string => typeof v === 'string');
}

function stringMapOr(
  value: unknown,
  fallback: Record<string, string>,
): Record<string, string> {
  if (value === null || value === undefined || typeof value !== 'object') return fallback;
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === 'string') result[k] = v;
  }
  return result;
}

/**
 * Shape of the raw YAML object before defaulting. Uses snake_case for fields
 * that appear with that spelling in xwidget_config.yaml (matching the
 * IntelliJ plugin's JsonProperty annotations).
 */
interface RawConfig {
  fragmentsPath?: unknown;
  valuesPath?: unknown;
  inflaters?: {
    target?: unknown;
    imports?: unknown;
    sources?: unknown;
    includes?: unknown;
    constructor_exclusions?: unknown;
    constructor_arg_defaults?: unknown;
    constructor_arg_parsers?: unknown;
  };
  icons?: {
    target?: unknown;
    imports?: unknown;
    sources?: unknown;
  };
  controllers?: {
    target?: unknown;
    imports?: unknown;
    sources?: unknown;
  };
  schema?: {
    target?: unknown;
    template?: unknown;
    types?: unknown;
    attribute_exclusions?: unknown;
  };
}
