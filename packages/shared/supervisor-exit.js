export function childExitStatus(currentStatus, { code, signal, stopping, forwardedSignal = null }) {
  if (code !== null && code !== 0) return code;
  if (signal && (!stopping || signal !== forwardedSignal)) return 1;
  return currentStatus || 0;
}
