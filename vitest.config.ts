import { defineConfig } from 'vitest/config';
import * as path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      // Extension modules import the 'vscode' API, which only exists inside
      // the extension host. Unit tests run under Node, so alias it to a
      // minimal stub covering the few constructs the tested modules touch.
      vscode: path.resolve(__dirname, 'test/vscode-stub.ts'),
    },
  },
  test: {
    include: ['test/**/*.test.ts'],
  },
});
