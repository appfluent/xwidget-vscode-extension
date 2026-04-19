import * as vscode from 'vscode';

/**
 * Resolves a `<Controller name="..."/>` reference to zero or more Dart class
 * definition locations.
 *
 * Mechanism: queries VSCode's `vscode.executeWorkspaceSymbolProvider`
 * command, which under the hood asks every registered language server
 * (including Dart-Code's) for symbols matching the name. We filter the
 * results to symbols of kind `Class` whose names match exactly.
 *
 * Why exact name match, not fuzzy: VSCode's workspace symbol provider does
 * fuzzy / prefix matching by default, returning many candidates. For
 * navigation we want only the symbols whose name is precisely the requested
 * controller name — `MyController` should not match `MyControllerHelper`.
 *
 * Why filter to classes only: workspace symbols include functions, methods,
 * variables, constants, etc. A controller is always a class in XWidget's
 * model, so anything else is noise.
 *
 * If Dart-Code isn't installed the request returns no results — gracefully
 * degrades to "controller not found" rather than crashing. The user is
 * separately prompted to install Dart-Code on activation.
 */
export async function resolveController(
  controllerName: string,
  token?: vscode.CancellationToken,
): Promise<vscode.Location[]> {
  // executeWorkspaceSymbolProvider is the documented bridge between
  // extension code and the language server's symbol index. The command
  // accepts a query string and returns SymbolInformation[] | undefined.
  const symbols = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
    'vscode.executeWorkspaceSymbolProvider',
    controllerName,
  );
  if (token?.isCancellationRequested) return [];
  if (!symbols || symbols.length === 0) return [];

  // Exact-name + Class-kind filter.
  const matches = symbols.filter(
    (symbol) =>
      symbol.kind === vscode.SymbolKind.Class && symbol.name === controllerName,
  );

  // Map to Locations. SymbolInformation has a `location: Location` field.
  return matches.map((symbol) => symbol.location);
}
