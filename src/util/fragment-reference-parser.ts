/**
 * Parsed shape of a `<fragment name="..."/>` reference value.
 *
 * The `name` attribute can carry runtime parameters appended URL-style:
 *   <fragment name="profile/password?id='3'&name='chris'"/>
 * Only the path-like portion before the `?` is meaningful for file lookup;
 * everything after is passed to the runtime and ignored by navigation.
 *
 * The path can also include an explicit file extension:
 *   <fragment name="profile.xml"/>
 * If present we use the path as-is; if absent we try the standard `.xml`
 * and `/index.xml` resolutions.
 */
export interface FragmentReference {
  /**
   * Path portion before any `?`. This is what gets matched against file
   * paths during resolution. May or may not include a `.xml` extension.
   */
  readonly basename: string;

  /**
   * Whether `basename` already ends in `.xml`. When true, the resolver uses
   * `basename` directly. When false, the resolver tries `basename + '.xml'`
   * then `basename + '/index.xml'`.
   */
  readonly hasExtension: boolean;
}

/**
 * Parses a fragment name attribute value into its components.
 * Mirrors XWidgetUtils.kt's `FileInfo` handling in the IntelliJ plugin.
 */
export function parseFragmentReference(name: string): FragmentReference {
  const queryIndex = name.indexOf('?');
  const basename = queryIndex === -1 ? name : name.substring(0, queryIndex);
  return {
    basename,
    hasExtension: basename.endsWith('.xml'),
  };
}

/**
 * Returns the candidate file paths (relative, forward-slash separated) that
 * the fragment name could resolve to. Used by the suffix-match search to
 * decide which file matches.
 *
 *  parseFragmentReference("profile.xml")        -> ["profile.xml"]
 *  parseFragmentReference("profile")            -> ["profile.xml", "profile/index.xml"]
 *  parseFragmentReference("profile/password")   -> ["profile/password.xml", "profile/password/index.xml"]
 *  parseFragmentReference("profile?id=3")       -> ["profile.xml", "profile/index.xml"]
 */
export function fragmentReferenceCandidates(ref: FragmentReference): string[] {
  if (ref.hasExtension) return [ref.basename];
  return [`${ref.basename}.xml`, `${ref.basename}/index.xml`];
}

/**
 * Returns just the filename component (no path) of each candidate, for
 * use with VSCode's `findFiles` glob — the search starts by basename match,
 * then suffix-filters by the full candidate path.
 *
 *  candidates = ["profile/password.xml", "profile/password/index.xml"]
 *  -> ["password.xml", "index.xml"]
 */
export function candidateBasenames(candidates: readonly string[]): string[] {
  const result = new Set<string>();
  for (const c of candidates) {
    const slash = c.lastIndexOf('/');
    result.add(slash === -1 ? c : c.substring(slash + 1));
  }
  return Array.from(result);
}
