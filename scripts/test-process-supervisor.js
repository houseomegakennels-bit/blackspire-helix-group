import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

function processIdentity(pid) {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const close = stat.lastIndexOf(')');
    const fields = stat.slice(close + 2).split(' ');
    return { pid, ppid: Number(fields[1]), pgrp: Number(fields[2]), start: fields[19] };
  } catch {
    return null;
  }
}

function allProcesses() {
  const result = [];
  for (const name of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(name)) continue;
    const identity = processIdentity(Number(name));
    if (identity) result.push(identity);
  }
  return result;
}

function signalProcess(pid, signal) {
  try {
    process.kill(pid, signal);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
}

function signalGroup(group, signal) {
  if (!Number.isInteger(group) || group <= 0) return false;
  return signalProcess(-group, signal);
}

function identityAlive(identity) {
  const current = processIdentity(identity.pid);
  return current !== null && current.start === identity.start;
}

function processHoldsOutput(pid, outputTargets) {
  if (outputTargets.size === 0) return false;
  let descriptors;
  try {
    descriptors = fs.readdirSync(`/proc/${pid}/fd`);
  } catch {
    return false;
  }
  for (const descriptor of descriptors) {
    try {
      if (outputTargets.has(fs.readlinkSync(`/proc/${pid}/fd/${descriptor}`))) return true;
    } catch {
      // Descriptors can close while /proc is being inspected.
    }
  }
  return false;
}

function rememberDescendants(rootPid, known, outputTargets, scanOutput = false) {
  const processes = allProcesses();
  const parents = new Set([rootPid, ...[...known.values()].filter(identityAlive).map((entry) => entry.pid)]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const entry of processes) {
      if (parents.has(entry.ppid) && !known.has(entry.pid)) {
        known.set(entry.pid, entry);
        parents.add(entry.pid);
        changed = true;
      }
    }
  }
  if (scanOutput) {
    for (const entry of processes) {
      if (entry.pid !== process.pid && processHoldsOutput(entry.pid, outputTargets)) known.set(entry.pid, entry);
    }
  }
}

async function waitUntil(check, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return true;
    await delay(10);
  }
  return check();
}

export async function runContainedProcess(command, args, {
  cwd,
  env,
  onStdout = (chunk) => process.stdout.write(chunk),
  onStderr = (chunk) => process.stderr.write(chunk),
  gracefulShutdownMs = 500,
  forceShutdownMs = 2000,
  forwardParentSignals = false,
} = {}) {
  const child = spawn(command, args, {
    cwd,
    env,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const group = child.pid;
  const known = new Map();
  let stdoutEnded = false;
  let stderrEnded = false;
  let interruptedSignal = null;
  let forced = false;
  let cleanupRequired = false;
  let spawnError = null;
  let interruptionTimer = null;

  child.stdout.on('data', onStdout);
  child.stderr.on('data', onStderr);
  child.stdout.once('end', () => { stdoutEnded = true; });
  child.stderr.once('end', () => { stderrEnded = true; });

  const outputTargets = new Set();
  for (const descriptor of ['1', '2']) {
    try {
      outputTargets.add(fs.readlinkSync(`/proc/${child.pid}/fd/${descriptor}`));
    } catch {
      // A failed exec is handled by the child error/exit result.
    }
  }

  const poll = setInterval(() => rememberDescendants(child.pid, known, outputTargets), 10);
  poll.unref();
  const signalHandlers = new Map();
  if (forwardParentSignals) {
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
      const handler = () => {
        if (interruptedSignal === null) interruptedSignal = signal;
        signalGroup(group, signal);
        for (const identity of known.values()) if (identityAlive(identity)) signalProcess(identity.pid, signal);
        if (interruptionTimer === null) {
          interruptionTimer = setTimeout(() => {
            forced = true;
            signalGroup(group, 'SIGKILL');
            for (const identity of known.values()) if (identityAlive(identity)) signalProcess(identity.pid, 'SIGKILL');
          }, gracefulShutdownMs);
          interruptionTimer.unref();
        }
      };
      signalHandlers.set(signal, handler);
      process.on(signal, handler);
    }
  }

  const exit = await new Promise((resolve) => {
    let settled = false;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    child.once('error', (error) => {
      spawnError = error;
      settle({ code: null, signal: null });
    });
    child.once('exit', (code, signal) => settle({ code, signal }));
  });
  rememberDescendants(child.pid, known, outputTargets, true);

  const liveBeforeCleanup = () => {
    const groupAlive = signalGroup(group, 0);
    const detachedAlive = [...known.values()].some(identityAlive);
    return groupAlive || detachedAlive;
  };
  if (liveBeforeCleanup()) {
    cleanupRequired = true;
    signalGroup(group, 'SIGTERM');
    for (const identity of known.values()) if (identityAlive(identity)) signalProcess(identity.pid, 'SIGTERM');
    if (!(await waitUntil(() => !liveBeforeCleanup(), gracefulShutdownMs))) {
      forced = true;
      signalGroup(group, 'SIGKILL');
      for (const identity of known.values()) if (identityAlive(identity)) signalProcess(identity.pid, 'SIGKILL');
    }
  }

  const processGroupTerminated = await waitUntil(() => !liveBeforeCleanup(), forceShutdownMs);
  const outputDrained = await waitUntil(() => stdoutEnded && stderrEnded, forceShutdownMs);
  clearInterval(poll);
  if (interruptionTimer !== null) clearTimeout(interruptionTimer);
  for (const [signal, handler] of signalHandlers) process.off(signal, handler);

  const remainingDescendants = [...known.values()].filter(identityAlive).length;
  const containmentFailure = !processGroupTerminated || remainingDescendants !== 0 || !outputDrained;
  let code = exit.code;
  if (code === 0 && (cleanupRequired || containmentFailure || interruptedSignal !== null)) code = 1;
  if (code === null && interruptedSignal !== null) {
    code = 128 + ({ SIGHUP: 1, SIGINT: 2, SIGTERM: 15 }[interruptedSignal] ?? 1);
  }
  if (code === null) {
    code = 128 + ({ SIGHUP: 1, SIGINT: 2, SIGKILL: 9, SIGTERM: 15 }[exit.signal] ?? 1);
  }

  return {
    code,
    childCode: exit.code,
    childSignal: exit.signal,
    interruptedSignal,
    processGroupTerminated,
    remainingDescendants,
    outputDrained,
    forced,
    cleanupRequired,
    spawnError,
  };
}
