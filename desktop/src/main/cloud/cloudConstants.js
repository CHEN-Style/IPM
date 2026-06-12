// Shared cloud-sync constants, factored out to avoid import cycles between
// pullWorkspace.js (which owns the pull pipeline) and syncEngine.js (the pure
// diff engine that must recognize placeholder files).

// Suffix for the JSON placeholder that stands in for an un-materialized large
// file (e.g. `大型报告.pdf.ipmcloud`).
export const PLACEHOLDER_SUFFIX = '.ipmcloud';

// Files larger than this are placeholdered on pull and fetched on demand.
export const DEFAULT_LARGE_FILE_THRESHOLD = 50 * 1024 * 1024; // 50 MB
