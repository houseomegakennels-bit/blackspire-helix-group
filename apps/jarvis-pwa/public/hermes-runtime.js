async function load() {
  const root = document.getElementById('root');
  try {
    const response = await fetch('/api/hermes/runtime', { credentials: 'include', headers: { accept: 'application/json' } });
    if (response.status === 401) { root.innerHTML = '<p class="err">Sign in required.</p>'; return; }
    if (!response.ok) { root.textContent = `Status unavailable (HTTP ${response.status}).`; return; }
    const status = await response.json();
    const escape = (value) => String(value == null ? '' : value).replace(/[<>&]/g, (character) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[character]));
    const runtime = status.runtime || {};
    const providers = (status.providers || []).map((provider) => `<tr>
      <td><code>${escape(provider.id)}</code></td><td>${escape(provider.displayName)}</td><td>${escape(provider.adapterType)}</td>
      <td>${provider.enabled ? 'enabled' : 'disabled'}</td><td>${escape(provider.authentication)}</td>
      <td>${escape(provider.health && provider.health.status)}</td><td>${escape((provider.capabilities || []).join(', '))}</td>
      <td>${provider.productionEligible ? 'yes' : 'no'}</td></tr>`).join('');
    const runs = (status.recentRuns || []).map((run) => `<tr><td>${escape(run.provider)}</td><td>${escape(run.status)}</td><td>${escape(run.outcome)}</td><td>${escape(run.workspaceId)}</td><td>${escape(run.createdAt)}</td></tr>`).join('');
    const invocations = (status.recentInvocations || []).map((invocation) => `<tr><td>${escape(invocation.provider)}</td><td>${escape(invocation.mode)}</td><td>${escape(invocation.status)}</td><td>${escape(invocation.durationMs)}ms</td><td>${invocation.usage && invocation.usage.inputTokens == null ? 'unavailable' : escape(invocation.usage && invocation.usage.inputTokens)}</td></tr>`).join('');
    const evaluations = (status.recentEvaluations || []).map((evaluation) => `<tr><td><code>${escape(evaluation.runId)}</code></td><td>${escape(evaluation.provider)}</td><td>${escape(evaluation.terminalStatus)}</td><td>${escape(evaluation.verificationStatus)}</td><td>${escape(evaluation.learningEligibility)}</td><td>${escape(evaluation.evaluatorVersion)}</td></tr>`).join('');
    root.innerHTML = `<p>Profile: <span class="pill">${escape(runtime.profile)}</span> · Real provider: <span class="pill">${runtime.realProviderEnabled ? 'enabled' : 'disabled'}</span> · Kill switch: <span class="pill">${runtime.killSwitch ? 'ACTIVE' : 'clear'}</span> · Default mode: <span class="pill">${escape(status.executionModeDefault)}</span></p>
      <h2>Providers</h2><table><thead><tr><th>ID</th><th>Name</th><th>Adapter</th><th>Enabled</th><th>Auth</th><th>Health</th><th>Capabilities</th><th>Prod-eligible</th></tr></thead><tbody>${providers}</tbody></table>
      <h2>Recent development runs</h2><table><thead><tr><th>Provider</th><th>Status</th><th>Outcome</th><th>Workspace</th><th>At</th></tr></thead><tbody>${runs || '<tr><td colspan="5" class="muted">none</td></tr>'}</tbody></table>
      <h2>Recent invocations</h2><table><thead><tr><th>Provider</th><th>Mode</th><th>Status</th><th>Duration</th><th>Input tokens</th></tr></thead><tbody>${invocations || '<tr><td colspan="5" class="muted">none</td></tr>'}</tbody></table>
      <h2>Outcome evaluations</h2><p class="muted">Immutable evidence only; evaluations do not alter routing or promote memory.</p><table><thead><tr><th>Run</th><th>Provider</th><th>Terminal</th><th>Verification</th><th>Learning status</th><th>Evaluator</th></tr></thead><tbody>${evaluations || '<tr><td colspan="6" class="muted">none</td></tr>'}</tbody></table><div id="evaluation-detail" class="muted"></div>`;
    const evaluationId = new URLSearchParams(location.search).get('evaluation');
    if (evaluationId && /^[A-Za-z0-9._:-]{1,128}$/.test(evaluationId)) {
      const detail = document.getElementById('evaluation-detail');
      const evaluationResponse = await fetch(`/api/hermes/evaluations/${encodeURIComponent(evaluationId)}`, { credentials: 'include', headers: { accept: 'application/json' } });
      if (evaluationResponse.ok) {
        const value = await evaluationResponse.json();
        detail.textContent = `Authorized evaluation: ${value.evaluation.id} · ${value.evaluation.terminalStatus} · ${value.evaluation.verificationStatus}`;
      } else detail.textContent = 'Evaluation unavailable.';
    }
  } catch {
    root.innerHTML = '<p class="err">Failed to load status.</p>';
  }
}
load();
