import { describe, expect, it } from 'vitest';
import type * as vscode from 'vscode';
import { isXWidgetFragment } from '../src/util/fragment-detection';

// Detection gates hover, codelens, and go-to-definition. These tests pin the
// language gate, both namespace eras, the scan limit, and the cache contract.
let nextUri = 0;

function fakeDocument(text: string, languageId = 'xml', uri?: string): vscode.TextDocument {
  const id = uri ?? `file:///test-${nextUri++}.xml`;
  return {
    languageId,
    uri: { toString: () => id },
    getText: (range?: { start: { character: number }; end: { character: number } }) =>
      range ? text.substring(range.start.character, range.end.character) : text,
    positionAt: (offset: number) => ({ line: 0, character: offset }),
  } as unknown as vscode.TextDocument;
}

describe('isXWidgetFragment', () => {
  it('accepts the current namespace', () => {
    expect(
      isXWidgetFragment(fakeDocument('<Text xmlns="https://xwidget.dev/fragments"/>')),
    ).toBe(true);
  });

  it('accepts the legacy namespace', () => {
    expect(
      isXWidgetFragment(fakeDocument('<Text xmlns="http://www.appfluent.us/xwidget"/>')),
    ).toBe(true);
  });

  it('accepts single-quoted and spaced xmlns declarations', () => {
    expect(
      isXWidgetFragment(fakeDocument("<Text xmlns = 'https://xwidget.dev/fragments'/>")),
    ).toBe(true);
  });

  it('rejects unrelated namespaces', () => {
    expect(
      isXWidgetFragment(fakeDocument('<svg xmlns="http://www.w3.org/2000/svg"/>')),
    ).toBe(false);
  });

  it('rejects non-xml documents even with a matching xmlns', () => {
    expect(
      isXWidgetFragment(
        fakeDocument('<Text xmlns="https://xwidget.dev/fragments"/>', 'plaintext'),
      ),
    ).toBe(false);
  });

  it('only scans the head of the document', () => {
    const padded = `<!--${' '.repeat(3000)}--><Text xmlns="https://xwidget.dev/fragments"/>`;
    expect(isXWidgetFragment(fakeDocument(padded))).toBe(false);
  });

  it('caches per uri until invalidated', () => {
    const uri = 'file:///cached.xml';
    expect(
      isXWidgetFragment(fakeDocument('<Text xmlns="https://xwidget.dev/fragments"/>', 'xml', uri)),
    ).toBe(true);
    // Same uri, different content: the cached verdict is returned — the
    // invalidation listeners (registered at activation) own cache eviction.
    expect(isXWidgetFragment(fakeDocument('<unrelated/>', 'xml', uri))).toBe(true);
  });
});
