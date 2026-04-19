# Change Log

## [0.1.0] - 2026-04-19

Initial release.

### Features

- **EL syntax highlighting** for `${...}` expressions in XML attribute values.
- **XML completion, validation, and hover docs** for fragment and resource files, via automatic registration of the generated XSD schema with the Red Hat XML extension.
- **Navigation** from `<fragment>` and `<Controller>` references — Cmd-click / Ctrl-click, CodeLens, and hover previews. Fragment names with URL-style params and explicit extensions are handled.
- **Hot reload** of fragments and resource values during a Flutter debug session. Save the file, the running app updates without a restart. Requires `xwidget >= 0.4.2`.
- **Activity Bar tree view** with commands for code generation, project initialization, and documentation.
- **Status surface** in the tree view that flags project health issues — ungenerated schema, missing dependencies, removed schema registration, xwidget version below the hot-reload threshold. Each item is clickable to run the appropriate fix. Numeric badge on the Activity Bar icon.
- **Auto-regeneration** of inflaters, icons, and controllers when their spec sources change (opt-in via the status bar toggle).
- Install prompts for recommended companion extensions (Red Hat XML, Dart) with "Don't Ask Again" option.