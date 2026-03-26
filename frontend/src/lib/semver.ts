/**
 * Parse a semver string (with optional "v" prefix) into [major, minor, patch].
 * Returns [0, 0, 0] for unparseable strings.
 */
export function parseSemver(version: string): [number, number, number] {
  const cleaned = version.replace(/^v/, "");
  const parts = cleaned.split(".");
  if (parts.length < 3) return [0, 0, 0];

  const major = parseInt(parts[0], 10);
  const minor = parseInt(parts[1], 10);
  const patch = parseInt(parts[2], 10);

  if (isNaN(major) || isNaN(minor) || isNaN(patch)) return [0, 0, 0];
  return [major, minor, patch];
}

/**
 * Returns true if `remote` is a newer version than `current`.
 * Both can have an optional "v" prefix.
 */
export function isNewerVersion(current: string, remote: string): boolean {
  const [cMajor, cMinor, cPatch] = parseSemver(current);
  const [rMajor, rMinor, rPatch] = parseSemver(remote);

  if (rMajor !== cMajor) return rMajor > cMajor;
  if (rMinor !== cMinor) return rMinor > cMinor;
  return rPatch > cPatch;
}
