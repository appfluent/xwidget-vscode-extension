# Change Log

## [0.2.0] - 2026-07-13

Support for xwidget_builder 0.7.0 projects, with full backward compatibility for older ones.

### Features

- **Schema catalog registration** — projects generated with builder >= 0.7.0 ship an XML
  catalog (`.xwidget/schema_catalog.g.xml`); the extension registers it via `xml.catalogs`,
  giving completion and validation to **fragments, routes, and values** documents by
  namespace. Pre-0.7 projects keep the original `xml.fileAssociations` mechanism — the
  extension picks the right mode by what exists on disk.
- **Automatic settings migration** — the first generate after upgrading a project swaps
  `.vscode/settings.json` from the legacy `fileAssociations` entry to the catalog entry.
  Downgrades are detected too: if the catalog disappears, the extension removes its stale
  entry and restores the legacy registration.
- **`.xwidget/` config discovery** — `xwidget_config.yaml` is read from the new config
  directory with fallback to the project root; both locations are watched, so migration is
  picked up live.
- **Dual namespace support** — navigation, hover previews, and CodeLens recognize both the
  new `https://xwidget.dev/fragments` namespace and the legacy
  `http://www.appfluent.us/xwidget`.
- **Era-aware status checks** — the Status panel validates whichever registration mode the
  project uses, and the restore action repairs either.

### Fixed

- A malformed `xwidget_config.yaml` whose document is a YAML list now raises the
  config-error notification instead of silently falling back to default paths.

## [0.1.0] - 2026-04-19

Initial release.

### Features

- **EL syntax highlighting** for `${...}` expressions in XML attribute values.
- **XML completion, validation, and hover docs** for fragment and resource files, via automatic registration of the generated XSD schema with the Red Hat XML extension.
- **Navigation** from `<fragment>` and `<Controller>` references — Cmd-click / Ctrl-click, CodeLens, and hover previews. Fragment names with URL-style params and explicit extensions are handled.
- **Hot reload** of fragments and resource values during a Flutter debug session. Save the file, the running app updates without a restart. Requires `xwidget >= 0.5.0`.
- **Activity Bar tree view** with commands for code generation, project initialization, and documentation.
- **Status surface** in the tree view that flags project health issues — ungenerated schema, missing dependencies, removed schema registration, xwidget version below the hot-reload threshold. Each item is clickable to run the appropriate fix. Numeric badge on the Activity Bar icon.
- **Auto-regeneration** of inflaters, icons, and controllers when their spec sources change (opt-in via the status bar toggle).
- Install prompts for recommended companion extensions (Red Hat XML, Dart) with "Don't Ask Again" option.