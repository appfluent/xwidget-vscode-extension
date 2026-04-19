import * as vscode from 'vscode';
import {
  CMD_ADD_XWIDGET,
  CMD_ADD_XWIDGET_BUILDER,
  CMD_GENERATE_ALL,
  CMD_GENERATE_CONTROLLERS,
  CMD_GENERATE_ICONS,
  CMD_GENERATE_INFLATERS,
  CMD_INIT_EXISTING_APP,
  CMD_INIT_NEW_APP,
  isLegacyVersion,
  LEGACY_CMD_GENERATE_ALL,
  LEGACY_CMD_GENERATE_CONTROLLERS,
  LEGACY_CMD_GENERATE_ICONS,
  LEGACY_CMD_GENERATE_INFLATERS,
  LEGACY_CMD_INIT_EXISTING_APP,
  LEGACY_CMD_INIT_NEW_APP,
} from '../util/constants';
import { Version } from '../util/version';
import { XWidgetService } from '../services/xwidget-service';
import { XWidgetTerminal } from '../util/terminal';

/**
 * Builds the user-visible command strings for generate and init operations,
 * selecting between legacy (xwidget <= 0.0.52) and current (xwidget_builder)
 * CLIs based on the detected package version. Behaviour mirrors
 * MenuActions.kt in the IntelliJ plugin.
 *
 * If no version is detected — i.e. pubspec.lock missing or xwidget not
 * installed — we prefer the current commands so fresh projects and
 * Initialize flows work without first running `flutter pub get`.
 */
export function buildGenerateAll(version: Version | undefined): string {
  return isLegacyVersion(version) ? LEGACY_CMD_GENERATE_ALL : CMD_GENERATE_ALL;
}

export function buildGenerateInflaters(version: Version | undefined): string {
  return isLegacyVersion(version)
    ? LEGACY_CMD_GENERATE_INFLATERS
    : CMD_GENERATE_INFLATERS;
}

export function buildGenerateIcons(version: Version | undefined): string {
  return isLegacyVersion(version) ? LEGACY_CMD_GENERATE_ICONS : CMD_GENERATE_ICONS;
}

export function buildGenerateControllers(version: Version | undefined): string {
  return isLegacyVersion(version)
    ? LEGACY_CMD_GENERATE_CONTROLLERS
    : CMD_GENERATE_CONTROLLERS;
}

export function buildInitNewApp(version: Version | undefined): string {
  return isLegacyVersion(version)
    ? `${CMD_ADD_XWIDGET} && ${LEGACY_CMD_INIT_NEW_APP}`
    : `${CMD_ADD_XWIDGET} && ${CMD_ADD_XWIDGET_BUILDER} && ${CMD_INIT_NEW_APP}`;
}

export function buildInitExistingApp(version: Version | undefined): string {
  return isLegacyVersion(version)
    ? `${CMD_ADD_XWIDGET} && ${LEGACY_CMD_INIT_EXISTING_APP}`
    : `${CMD_ADD_XWIDGET} && ${CMD_ADD_XWIDGET_BUILDER} && ${CMD_INIT_EXISTING_APP}`;
}

/**
 * Registers all generate/init command handlers. Each one resolves the
 * correct CLI invocation based on the currently-detected xwidget version
 * and dispatches to the shared XWidget terminal.
 */
export function registerGenerateCommands(
  context: vscode.ExtensionContext,
  service: XWidgetService,
  terminal: XWidgetTerminal,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('flutter-xwidget.generateAll', () => {
      terminal.run(buildGenerateAll(service.xwidgetVersion));
    }),
    vscode.commands.registerCommand('flutter-xwidget.generateInflaters', () => {
      terminal.run(buildGenerateInflaters(service.xwidgetVersion));
    }),
    vscode.commands.registerCommand('flutter-xwidget.generateIcons', () => {
      terminal.run(buildGenerateIcons(service.xwidgetVersion));
    }),
    vscode.commands.registerCommand('flutter-xwidget.generateControllers', () => {
      terminal.run(buildGenerateControllers(service.xwidgetVersion));
    }),
    vscode.commands.registerCommand('flutter-xwidget.initializeNewProject', () => {
      terminal.run(buildInitNewApp(service.xwidgetVersion));
    }),
    vscode.commands.registerCommand('flutter-xwidget.initializeExistingProject', () => {
      terminal.run(buildInitExistingApp(service.xwidgetVersion));
    }),
  );
}
