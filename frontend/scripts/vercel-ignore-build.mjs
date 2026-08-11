import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const COMMIT_SHA = /^[0-9a-f]{40}$/;

function git(args, cwd) {
  return spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'ignore', 'ignore'],
  }).status;
}

export function shouldIgnoreFrontendBuild({
  cwd = process.cwd(),
  previousSha = process.env.VERCEL_GIT_PREVIOUS_SHA,
} = {}) {
  if (!COMMIT_SHA.test(previousSha ?? '')) {
    return false;
  }

  if (git(['cat-file', '-e', `${previousSha}^{commit}`], cwd) !== 0) {
    return false;
  }

  if (git(['merge-base', '--is-ancestor', previousSha, 'HEAD'], cwd) !== 0) {
    return false;
  }

  const diffStatus = git(['diff', '--quiet', previousSha, 'HEAD', '--', '.'], cwd);
  if (diffStatus === 0) {
    return true;
  }

  return false;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = shouldIgnoreFrontendBuild() ? 0 : 1;
}
