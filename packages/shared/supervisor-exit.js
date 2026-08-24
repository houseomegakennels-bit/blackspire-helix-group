export function childExitStatus(currentStatus, { code, signal, stopping }) {
  if (code !== null && code !== 0) return code;
  if (!stopping && signal) return 1;
  return currentStatus || 0;
}
