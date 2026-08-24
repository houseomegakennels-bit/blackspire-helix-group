export function installedUnitMetadataSafe(stat) {
  return Boolean(stat)
    && stat.isFile()
    && !stat.isSymbolicLink()
    && stat.uid === 0
    && (stat.mode & 0o022) === 0;
}
