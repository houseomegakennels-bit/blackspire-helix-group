"use client";

import { useState, useTransition } from "react";
import type { SocialAdminSnapshot, SocialCredentialAssistStatus } from "@/types/social-os";

function buildIntegrationDrafts(admin: SocialAdminSnapshot) {
  return Object.fromEntries(
    admin.clients.flatMap((client) =>
      client.integrations.map((integration) => [
        integration.id,
        {
          apiKey: "",
          cliCommand: "",
          webhookUrl: "",
          status: integration.credentialAssist.status,
          preferredContact: integration.credentialAssist.preferredContact,
          requestNote: integration.credentialAssist.requestNote,
          supportNote: integration.credentialAssist.supportNote,
        },
      ]),
    ),
  ) as Record<
    string,
    {
      apiKey: string;
      cliCommand: string;
      webhookUrl: string;
      status: SocialCredentialAssistStatus;
      preferredContact: string;
      requestNote: string;
      supportNote: string;
    }
  >;
}

function formatStatusLabel(value: string): string {
  return value
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

export function SocialOsAdminConsole({
  initialAdmin
}: {
  initialAdmin: SocialAdminSnapshot;
}) {
  const [admin, setAdmin] = useState(initialAdmin);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [newClient, setNewClient] = useState({
    name: "",
    slug: "",
    brandName: "",
    username: "",
    password: ""
  });
  const [passwordDrafts, setPasswordDrafts] = useState<Record<string, string>>({});
  const [loginDrafts, setLoginDrafts] = useState<Record<string, { username: string; password: string }>>({});
  const [integrationDrafts, setIntegrationDrafts] = useState(buildIntegrationDrafts(initialAdmin));

  const runAction = async (
    action: string,
    payload: Record<string, unknown>,
    busyText: string,
    successText: string
  ) => {
    setBusyLabel(busyText);
    setNotice(null);
    setError(null);
    try {
      const response = await fetch("/api/social-os/admin", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ action, payload })
      });
      const data = (await response.json()) as {
        error?: string;
        admin?: SocialAdminSnapshot;
      };
      if (!response.ok || !data.admin) {
        throw new Error(data.error ?? "Admin update failed.");
      }
      startTransition(() => {
        setAdmin(data.admin as SocialAdminSnapshot);
        setIntegrationDrafts(buildIntegrationDrafts(data.admin as SocialAdminSnapshot));
      });
      setNotice(successText);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Admin update failed.");
    } finally {
      setBusyLabel(null);
    }
  };

  const pendingRequests = admin.clients.flatMap((client) =>
    client.integrations
      .filter(
        (integration) =>
          integration.credentialAssist.status !== "none"
          && integration.credentialAssist.status !== "completed",
      )
      .map((integration) => ({
        client,
        integration,
      })),
  );

  return (
    <main className="social-os-shell">
      <div className="backdrop-grid" />
      <section className="social-os-hero panel">
        <div>
          <span className="eyebrow">BLACKSPIRE ADMIN MODE</span>
          <p className="hero-kicker">Internal workspace management</p>
          <h1>Client control center</h1>
          <p className="hero-copy">
            View client workspaces, add future clients, reset passwords, disable access, inspect
            connection health, and review failed push logs from one internal console.
          </p>
        </div>
        <div className="social-os-hero-side">
          <div className="sync-meta">
            <span>Signed in as</span>
            <strong>{admin.viewer.username}</strong>
            <span>{busyLabel || (isPending ? "Refreshing admin view..." : "Platform admin")}</span>
          </div>
          {notice ? <span className="hero-signal social-os-success-pill">{notice}</span> : null}
          {error ? <span className="hero-signal social-os-danger-pill">{error}</span> : null}
        </div>
      </section>

      <section className="social-os-grid">
        <div className="social-os-main-column">
          <article className="panel social-os-card">
            <div className="panel-heading">
              <div>
                <span>Future client scalability</span>
                <h2>Add client workspace</h2>
              </div>
            </div>
            <div className="campaign-form">
              <label className="field">
                <span>Client name</span>
                <input
                  value={newClient.name}
                  onChange={(event) => setNewClient((current) => ({ ...current, name: event.target.value }))}
                />
              </label>
              <label className="field">
                <span>Slug</span>
                <input
                  value={newClient.slug}
                  onChange={(event) => setNewClient((current) => ({ ...current, slug: event.target.value }))}
                />
              </label>
              <label className="field">
                <span>Brand name</span>
                <input
                  value={newClient.brandName}
                  onChange={(event) =>
                    setNewClient((current) => ({ ...current, brandName: event.target.value }))
                  }
                />
              </label>
              <label className="field">
                <span>Initial username</span>
                <input
                  value={newClient.username}
                  onChange={(event) =>
                    setNewClient((current) => ({ ...current, username: event.target.value }))
                  }
                />
              </label>
              <label className="field field-span-2">
                <span>Initial password</span>
                <input
                  type="password"
                  value={newClient.password}
                  onChange={(event) =>
                    setNewClient((current) => ({ ...current, password: event.target.value }))
                  }
                />
              </label>
            </div>
            <div className="social-os-editor-actions">
              <button
                className="sync-button"
                type="button"
                onClick={() =>
                  runAction("create-client", newClient, "Creating client workspace...", "Client workspace created.")
                }
              >
                Add future client
              </button>
            </div>
          </article>

          <article className="panel social-os-card">
            <div className="panel-heading">
              <div>
                <span>Client workspaces</span>
                <h2>Current clients</h2>
              </div>
            </div>
            <div className="recent-campaigns-list">
              {admin.clients.map((client) => (
                <div key={client.id} className="campaign-group-card">
                  <strong>{client.name}</strong>
                  <div className="recent-campaign-meta">
                    <span>{client.slug}</span>
                    <span>{client.disabledAt ? "Access disabled" : "Access active"}</span>
                  </div>
                  <p>{client.brandName}</p>
                  <div className="social-os-inline-meta">
                    <span>{client.integrations.filter((item) => item.connectionStatus === "connected").length} healthy integrations</span>
                    <span>{client.pendingCredentialRequests} credential requests</span>
                    <span>{client.failedPushes.length} failed push logs</span>
                  </div>
                  <div className="social-os-editor-actions">
                    <a className="ghost-button" href={`/social-os/client/${client.slug}`}>
                      View workspace
                    </a>
                    <button
                      className="ghost-button"
                      type="button"
                      onClick={() =>
                        runAction(
                          "set-client-access",
                          { clientId: client.id, disabled: !client.disabledAt },
                          client.disabledAt ? "Re-enabling access..." : "Disabling access...",
                          client.disabledAt ? "Client access restored." : "Client access disabled."
                        )
                      }
                    >
                      {client.disabledAt ? "Enable client" : "Disable client"}
                    </button>
                  </div>
                  {!client.users.length ? (
                    <div className="campaign-form">
                      <label className="field">
                        <span>Create first login</span>
                        <input
                          value={loginDrafts[client.id]?.username ?? ""}
                          onChange={(event) =>
                            setLoginDrafts((current) => ({
                              ...current,
                              [client.id]: {
                                username: event.target.value,
                                password: current[client.id]?.password ?? ""
                              }
                            }))
                          }
                          placeholder="workspace username"
                        />
                      </label>
                      <label className="field">
                        <span>Initial password</span>
                        <input
                          type="password"
                          value={loginDrafts[client.id]?.password ?? ""}
                          onChange={(event) =>
                            setLoginDrafts((current) => ({
                              ...current,
                              [client.id]: {
                                username: current[client.id]?.username ?? "",
                                password: event.target.value
                              }
                            }))
                          }
                          placeholder="At least 8 characters"
                        />
                      </label>
                      <div className="social-os-editor-actions">
                        <button
                          className="sync-button"
                          type="button"
                          onClick={() =>
                            runAction(
                              "create-client-login",
                              {
                                clientId: client.id,
                                username: loginDrafts[client.id]?.username ?? "",
                                password: loginDrafts[client.id]?.password ?? ""
                              },
                              "Creating client login...",
                              `Login created for ${client.name}.`
                            )
                          }
                        >
                          Create client login
                        </button>
                      </div>
                    </div>
                  ) : null}
                  <div className="social-os-admin-subgrid">
                    {client.users.map((user) => (
                      <div key={user.id} className="asset-card">
                        <strong>{user.username}</strong>
                        <span>{user.role}</span>
                        <p>Last login: {user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : "Never"}</p>
                        <input
                          className="vault-search"
                          type="password"
                          value={passwordDrafts[user.id] ?? ""}
                          onChange={(event) =>
                            setPasswordDrafts((current) => ({
                              ...current,
                              [user.id]: event.target.value
                            }))
                          }
                          placeholder="New password"
                        />
                        <button
                          className="ghost-button"
                          type="button"
                          onClick={() =>
                            runAction(
                              "reset-password",
                              {
                                userId: user.id,
                                newPassword: passwordDrafts[user.id] ?? ""
                              },
                              "Resetting password...",
                              `Password reset for ${user.username}.`
                            )
                          }
                        >
                          Reset password
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="social-os-admin-subgrid">
                    {client.integrations.map((integration) => (
                      <div key={integration.id} className="asset-card">
                        <strong>{integration.platformLabel}</strong>
                        <span>{formatStatusLabel(integration.connectionStatus)}</span>
                        <p>
                          Assist status: {formatStatusLabel(integration.credentialAssist.status)}
                          {integration.credentialAssist.requestedAt
                            ? ` · ${new Date(integration.credentialAssist.requestedAt).toLocaleString()}`
                            : ""}
                        </p>
                        <p>
                          Preferred contact: {integration.credentialAssist.preferredContact || "Not provided"}
                        </p>
                        <p>{integration.credentialAssist.requestNote || "No client request note yet."}</p>
                        <p>Saved API key: {integration.maskedApiKey ?? "Not saved"}</p>
                        <p>Saved CLI command: {integration.maskedCliCommand ?? "Not saved"}</p>
                        <p>Saved webhook: {integration.maskedWebhookUrl ?? "Not saved"}</p>
                        <input
                          className="vault-search"
                          value={integrationDrafts[integration.id]?.preferredContact ?? ""}
                          onChange={(event) =>
                            setIntegrationDrafts((current) => ({
                              ...current,
                              [integration.id]: {
                                ...current[integration.id],
                                preferredContact: event.target.value,
                              },
                            }))
                          }
                          placeholder="Preferred client contact"
                        />
                        <textarea
                          className="vault-search"
                          value={integrationDrafts[integration.id]?.requestNote ?? ""}
                          onChange={(event) =>
                            setIntegrationDrafts((current) => ({
                              ...current,
                              [integration.id]: {
                                ...current[integration.id],
                                requestNote: event.target.value,
                              },
                            }))
                          }
                          placeholder="Client request note"
                        />
                        <select
                          className="vault-search"
                          value={integrationDrafts[integration.id]?.status ?? integration.credentialAssist.status}
                          onChange={(event) =>
                            setIntegrationDrafts((current) => ({
                              ...current,
                              [integration.id]: {
                                ...current[integration.id],
                                status: event.target.value as SocialCredentialAssistStatus,
                              },
                            }))
                          }
                        >
                          <option value="none">No request</option>
                          <option value="requested">Requested</option>
                          <option value="in_review">In review</option>
                          <option value="awaiting_client">Awaiting client</option>
                          <option value="completed">Completed</option>
                        </select>
                        <textarea
                          className="vault-search"
                          value={integrationDrafts[integration.id]?.supportNote ?? integration.credentialAssist.supportNote}
                          onChange={(event) =>
                            setIntegrationDrafts((current) => ({
                              ...current,
                              [integration.id]: {
                                ...current[integration.id],
                                supportNote: event.target.value,
                              },
                            }))
                          }
                          placeholder="Internal / client-facing handoff note"
                        />
                        <input
                          className="vault-search"
                          value={integrationDrafts[integration.id]?.apiKey ?? ""}
                          onChange={(event) =>
                            setIntegrationDrafts((current) => ({
                              ...current,
                              [integration.id]: {
                                ...current[integration.id],
                                apiKey: event.target.value,
                              },
                            }))
                          }
                          placeholder="New API key or token"
                        />
                        <input
                          className="vault-search"
                          value={integrationDrafts[integration.id]?.cliCommand ?? ""}
                          onChange={(event) =>
                            setIntegrationDrafts((current) => ({
                              ...current,
                              [integration.id]: {
                                ...current[integration.id],
                                cliCommand: event.target.value,
                              },
                            }))
                          }
                          placeholder="Optional CLI command"
                        />
                        <input
                          className="vault-search"
                          value={integrationDrafts[integration.id]?.webhookUrl ?? ""}
                          onChange={(event) =>
                            setIntegrationDrafts((current) => ({
                              ...current,
                              [integration.id]: {
                                ...current[integration.id],
                                webhookUrl: event.target.value,
                              },
                            }))
                          }
                          placeholder="Optional webhook URL"
                        />
                        <div className="social-os-editor-actions">
                          <button
                            className="sync-button"
                            type="button"
                            onClick={() =>
                              runAction(
                                "update-integration-request",
                                {
                                  clientId: client.id,
                                  platform: integration.platform,
                                  status: integrationDrafts[integration.id]?.status ?? integration.credentialAssist.status,
                                  preferredContact:
                                    integrationDrafts[integration.id]?.preferredContact
                                    ?? integration.credentialAssist.preferredContact,
                                  requestNote:
                                    integrationDrafts[integration.id]?.requestNote
                                    ?? integration.credentialAssist.requestNote,
                                  supportNote: integrationDrafts[integration.id]?.supportNote ?? integration.credentialAssist.supportNote,
                                },
                                "Updating request status...",
                                `${integration.platformLabel} request updated.`,
                              )
                            }
                          >
                            Update request
                          </button>
                          <button
                            className="ghost-button"
                            type="button"
                            onClick={() =>
                              runAction(
                                "save-client-integration",
                                {
                                  clientId: client.id,
                                  platform: integration.platform,
                                  apiKey: integrationDrafts[integration.id]?.apiKey ?? "",
                                  cliCommand: integrationDrafts[integration.id]?.cliCommand ?? "",
                                  webhookUrl: integrationDrafts[integration.id]?.webhookUrl ?? "",
                                },
                                "Saving managed credentials...",
                                `${integration.platformLabel} credentials stored.`,
                              )
                            }
                          >
                            Save credentials
                          </button>
                          <button
                            className="ghost-button"
                            type="button"
                            onClick={() =>
                              runAction(
                                "test-client-integration",
                                {
                                  clientId: client.id,
                                  platform: integration.platform,
                                },
                                "Testing managed connection...",
                                `${integration.platformLabel} connection tested.`,
                              )
                            }
                          >
                            Test
                          </button>
                          <button
                            className="ghost-button"
                            type="button"
                            onClick={() =>
                              runAction(
                                "remove-client-integration",
                                {
                                  clientId: client.id,
                                  platform: integration.platform,
                                },
                                "Removing managed credentials...",
                                `${integration.platformLabel} credentials removed.`,
                              )
                            }
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </article>
        </div>

        <div className="social-os-side-column">
          <article className="panel social-os-card">
            <div className="panel-heading">
              <div>
                <span>Credential intake</span>
                <h2>Blackspire-managed requests</h2>
              </div>
            </div>
            {pendingRequests.length ? (
              <div className="recent-campaigns-list">
                {pendingRequests.map(({ client, integration }) => (
                  <div key={`${client.id}-${integration.id}`} className="campaign-group-card">
                    <strong>{client.name}</strong>
                    <span>{integration.platformLabel}</span>
                    <p>Status: {formatStatusLabel(integration.credentialAssist.status)}</p>
                    <p>{integration.credentialAssist.requestNote || "No request note provided."}</p>
                    <p>Preferred contact: {integration.credentialAssist.preferredContact || "Not provided"}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="empty-state">
                No active admin-assisted credential requests right now.
              </p>
            )}
          </article>

          <article className="panel social-os-card">
            <div className="panel-heading">
              <div>
                <span>Failed push logs</span>
                <h2>Cross-client watchlist</h2>
              </div>
            </div>
            {admin.clients.some((client) => client.failedPushes.length) ? (
              <div className="recent-campaigns-list">
                {admin.clients.flatMap((client) =>
                  client.failedPushes.map((failure) => (
                    <div key={`${client.id}-${failure.campaignName}-${failure.platformLabel}`} className="campaign-group-card">
                      <strong>{client.name}</strong>
                      <span>{failure.platformLabel}</span>
                      <p>{failure.campaignName}</p>
                      <p>{failure.errorMessage}</p>
                    </div>
                  ))
                )}
              </div>
            ) : (
              <p className="empty-state">
                No failed pushes across client workspaces right now.
              </p>
            )}
          </article>

          <article className="panel social-os-card">
            <div className="panel-heading">
              <div>
                <span>Audit</span>
                <h2>Recent admin-visible logs</h2>
              </div>
            </div>
            <div className="timeline-list">
              {admin.auditLogs.slice(0, 16).map((log) => (
                <div key={log.id} className="timeline-card">
                  <span className="timeline-dot" />
                  <div className="timeline-copy">
                    <div className="timeline-header">
                      <strong>{log.message}</strong>
                      <span>{new Date(log.createdAt).toLocaleString()}</span>
                    </div>
                    <p>
                      {log.eventType} · {log.entityType} · {log.actorUsername ?? "system"}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </article>
        </div>
      </section>
    </main>
  );
}
