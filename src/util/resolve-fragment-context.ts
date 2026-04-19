import * as vscode from 'vscode';
import { FragmentReference } from './fragment-reference-parser';
import { resolveFragment } from './fragment-resolver';
import type { XWidgetService } from '../services/xwidget-service';

/**
 * Singleton service reference. Populated by `setXWidgetService` from the
 * extension entry point. Allows the providers (DefinitionProvider,
 * CodeLensProvider, HoverProvider) and the openReference command to resolve
 * fragment references without threading the service through every layer.
 *
 * Nullable because activation happens in phases — the service is constructed
 * and activated before the providers register, but the guard here keeps the
 * code safe if ordering ever changes.
 */
let serviceRef: XWidgetService | undefined;

export function setXWidgetService(service: XWidgetService): void {
  serviceRef = service;
}

/**
 * Resolves a fragment reference using the current workspace's configuration.
 * Reads `workspaceRoot` and `fragmentsPath` from the service each call —
 * picks up config changes without needing to re-wire anything.
 */
export async function resolveFragmentFromContext(
  reference: FragmentReference,
  token?: vscode.CancellationToken,
): Promise<vscode.Uri[]> {
  const workspaceRoot = serviceRef?.workspaceRoot;
  const fragmentsPath = serviceRef?.config?.fragmentsPath;
  return resolveFragment(reference, workspaceRoot, fragmentsPath, token);
}
