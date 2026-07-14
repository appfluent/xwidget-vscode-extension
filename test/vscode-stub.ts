// Minimal stand-in for the 'vscode' module in unit tests. Only the pieces
// the tested modules actually construct or call are implemented.

export class Position {
  constructor(
    public readonly line: number,
    public readonly character: number,
  ) {}
}

export class Range {
  constructor(
    public readonly start: Position,
    public readonly end: Position,
  ) {}
}

export const workspace = {
  onDidChangeTextDocument: () => ({ dispose() {} }),
  onDidCloseTextDocument: () => ({ dispose() {} }),
};
