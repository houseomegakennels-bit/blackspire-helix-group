import { pathToFileURL } from 'node:url';
import { auditReceiver } from './zola-receiver-maintenance.mjs';

const PROJECT = 'prj_a9x4Tuzgzq6XrvtdtYNxONwL8Fou';
const TEAM = 'team_CaRyRaulJaFnCLSfTdyRYNIW';
const MAIN = '53adf74e05c607c0d296923bae05d7ac023ecb57';
const PREVIOUS_PRODUCTION = 'dpl_2x5G4LjirPMvNcwLZ7ccyxMm7efA';
const BRANCH = 'release/zola-production-live';
const REPO = 'houseomegakennels-bit/blackspire-helix-group';
class RebuildError extends Error {}

export async function rebuildReceivers({ vercelToken, capabilityToken, githubToken, previewSha,
  fetchImpl = fetch, audit = auditReceiver, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = Date.now, emit = () => {}, creator }) {
  const deployments = [];
  const fail = (message) => { throw new RebuildError(message); };
  async function request(url, token, body) {
    const response = await fetchImpl(url, { method: body ? 'POST' : 'GET', redirect: 'error',
      signal: AbortSignal.timeout(15000), headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    if (!response.ok) fail(`HTTP ${response.status}`);
    let length = 0;
    const chunks = [];
    for await (const chunk of response.body) {
      length += chunk.byteLength;
      if (length > 1024 * 1024) fail('RESPONSE LIMIT EXCEEDED');
      chunks.push(Buffer.from(chunk));
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { fail('INVALID API RESPONSE'); }
  }
  const vercel = (path) => `https://api.vercel.com${path}${path.includes('?') ? '&' : '?'}teamId=${TEAM}`;
  async function refs() {
    for (const [ref, sha] of [[BRANCH, previewSha], ['main', MAIN]]) {
      const value = await request(`https://api.github.com/repos/${REPO}/git/ref/heads/${ref}`, githubToken);
      if (value.object?.sha !== sha || value.object?.type !== 'commit') fail('GIT REF DRIFT');
    }
    const current = await request(vercel('/v13/deployments/blackspirehelix.com'), vercelToken);
    if (current.id !== PREVIOUS_PRODUCTION || current.projectId !== PROJECT ||
        current.target !== 'production' || current.meta?.githubCommitSha !== MAIN) fail('PRODUCTION DEPLOYMENT DRIFT');
  }
  function identity(value, sha, target, expectedId, proof) {
    const sourceValid = proof
      ? proof.sourceSha === sha && /^[a-f0-9]{64}$/.test(proof.artifactSha256 ?? '') &&
        value.meta?.zolaSourceSha === sha && value.meta?.zolaArtifactSha256 === proof.artifactSha256 &&
        value.meta?.githubCommitSha === sha && value.meta?.githubCommitRef === (target === 'production' ? 'main' : BRANCH)
      : value.gitSource?.sha === sha && value.gitSource?.type === 'github' && String(value.gitSource?.repoId) === '1247069814';
    if (value.projectId !== PROJECT || !sourceValid ||
        (target === 'production' ? value.target !== 'production' : value.target != null) ||
        typeof value.id !== 'string' || !/^dpl_[A-Za-z0-9]+$/.test(value.id) ||
        (expectedId && value.id !== expectedId) || typeof value.url !== 'string' ||
        !/^[a-z0-9-]+\.vercel\.app$/.test(value.url)) fail('DEPLOYMENT IDENTITY MISMATCH');
  }
  async function probe(host) {
    const cases = [[capabilityToken, 'blackspire-command', 400], [capabilityToken, 'zola-receiver-denied-workspace', 404], ['zola-invalid-token', 'blackspire-command', 404]];
    for (const [token, workspaceId, expected] of cases) {
      const response = await fetchImpl(`https://${host}/api/internal/capabilities/seller-opportunities`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId, limit: 0 }),
      });
      const valid = response.status === expected && (response.headers.get('content-type') ?? '').includes('application/json');
      await response.body?.cancel();
      if (!valid) fail('RECEIVER AUTH PROBE FAILED');
    }
  }
  try {
    if (!vercelToken || !githubToken || !capabilityToken || !/^[a-f0-9]{40}$/.test(previewSha ?? '')) fail('CREDENTIAL OR SHA REQUIRED');
    if ((await audit({ vercelToken, capabilityToken, fetchImpl })).status !== 'READY') fail('RECEIVER CONFIG NOT READY');
    for (const target of ['preview', 'production']) {
      await refs();
      const sha = target === 'preview' ? previewSha : MAIN;
      const body = { name: 'frontend', project: PROJECT, gitSource: { type: 'github', repoId: '1247069814',
        ref: target === 'preview' ? BRANCH : 'main', sha }, ...(target === 'production' ? { target: 'production' } : {}) };
      const created = creator ? await creator({ sha, target, beforeUpload: refs, lookup: (host) => request(vercel(`/v13/deployments/${host}`), vercelToken) }) : null;
      const proof = created?.proof;
      let value = created ? created.deployment : await request(vercel('/v13/deployments?forceNew=1'), vercelToken, body);
      identity(value, sha, target, undefined, proof);
      const id = value.id;
      const summary = { id, sha, target, status: 'CREATED' };
      deployments.push(summary);
      emit({ ...summary });
      const deadline = now() + 240000;
      let ready = false;
      for (let poll = 0; poll < 80 && now() < deadline; poll++) {
        value = await request(vercel(`/v13/deployments/${id}`), vercelToken);
        identity(value, sha, target, id, proof);
        if (value.readyState === 'READY') { ready = true; break; }
        if (['ERROR', 'CANCELED', 'BLOCKED'].includes(value.readyState)) fail(`DEPLOYMENT ${value.readyState}`);
        if (!['QUEUED', 'INITIALIZING', 'BUILDING'].includes(value.readyState)) fail('UNKNOWN DEPLOYMENT STATE');
        await sleep(3000);
      }
      if (!ready) fail('DEPLOYMENT TIMEOUT');
      await probe(value.url);
      summary.status = 'RECEIVER VERIFIED';
      emit({ ...summary });
    }
    return { status: 'READY', deployments };
  } catch (error) {
    return { status: error instanceof RebuildError ? error.message : 'REQUEST FAILED', deployments,
      nextAction: 'INSPECT RECORDED DEPLOYMENTS BEFORE ANY RETRY' };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = await rebuildReceivers({ vercelToken: process.env.VERCEL_TOKEN, capabilityToken: process.env.ZOLA_CAPABILITY_TOKEN,
    githubToken: process.env.GITHUB_TOKEN, previewSha: process.env.GITHUB_SHA, emit: (value) => process.stdout.write(`${JSON.stringify(value)}\n`) });
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (report.status !== 'READY') process.exitCode = 1;
}
