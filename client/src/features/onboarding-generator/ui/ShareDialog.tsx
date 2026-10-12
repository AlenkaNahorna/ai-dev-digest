"use client";
import React from "react";
import type { ShareCreated } from "@devdigest/shared/contracts/onboarding-generator";
import { Badge, Button, Modal } from "@devdigest/ui";
import { useCreateShare, useRevokeShare, useTourShares } from "../api/hooks";
import { shortSha } from "../model/view";
import { CopyButton } from "./TourSections";

/**
 * Explicit, two-step publish: the owner first confirms exactly WHAT becomes public
 * (this version, this commit), then the link is shown ONCE. Listings later show
 * opaque metadata only — the raw link cannot be recovered after this dialog closes.
 */
export function ShareDialog({
  repoId,
  tourId,
  sourceSha,
  publicOriginConfigured,
  onClose,
}: {
  repoId: string;
  tourId: string;
  sourceSha: string;
  publicOriginConfigured: boolean;
  onClose: () => void;
}) {
  const create = useCreateShare(repoId);
  const revoke = useRevokeShare(repoId);
  const shares = useTourShares(repoId, true);
  const [created, setCreated] = React.useState<ShareCreated | null>(null);
  const [confirmRevoke, setConfirmRevoke] = React.useState<string | null>(null);

  const publish = () => create.mutate(tourId, { onSuccess: (r) => setCreated(r) });
  const active = (shares.data?.shares ?? []).filter((s) => s.revoked_at === null);

  return (
    <Modal
      width={560}
      title="Share onboarding tour"
      subtitle={`Snapshot of the version generated from commit ${shortSha(sourceSha)}`}
      onClose={onClose}
      footer={
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <Button kind="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      }
    >
      <div style={{ padding: 22, display: "flex", flexDirection: "column", gap: 16 }}>
        {created ? (
          <div role="status" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontWeight: 600 }}>Link created</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 6 }}>
              <code className="mono" style={{ flex: 1, fontSize: 12.5, overflowX: "auto", whiteSpace: "nowrap" }} data-testid="share-url">
                {created.url}
              </code>
              <CopyButton text={created.url} label="Copy link" />
            </div>
            <div style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>
              Copy it now — for security this link is shown only once and cannot be retrieved later. You can revoke it below at any time.
            </div>
            {created.local_only && (
              <div role="alert" style={{ fontSize: 12.5, color: "var(--warn)" }}>
                This link only works on this machine: no public web address is configured on the server (PUBLIC_WEB_ORIGIN).
              </div>
            )}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontSize: 13.5 }}>
              This publishes a <strong>read-only public snapshot</strong> of this tour. Anyone who has the link can read it — no sign-in — until you revoke it. It contains the tour text, file paths and commit information shown on this page; it does not expose your repository or API.
            </div>
            {!publicOriginConfigured && (
              <div role="note" style={{ fontSize: 12.5, color: "var(--warn)" }}>
                No public web address is configured, so the link will only work on this machine.
              </div>
            )}
            {create.isError && (
              <div role="alert" style={{ fontSize: 13, color: "var(--danger)" }}>
                {create.error instanceof Error ? create.error.message : "Could not create the link."}
              </div>
            )}
            <div>
              <Button kind="primary" icon="Link" onClick={publish} loading={create.isPending}>
                Create public link
              </Button>
            </div>
          </div>
        )}

        <div>
          <div style={{ fontSize: 11, letterSpacing: 0.6, color: "var(--text-muted)", marginBottom: 6 }}>ACTIVE LINKS</div>
          {shares.isLoading ? (
            <div style={{ fontSize: 13, color: "var(--text-muted)" }}>Loading…</div>
          ) : active.length === 0 ? (
            <div style={{ fontSize: 13, color: "var(--text-muted)" }}>No active links.</div>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
              {active.map((s) => (
                <li key={s.share_id} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}>
                  <Badge mono>{shortSha(s.source_sha)}</Badge>
                  <span style={{ flex: 1, color: "var(--text-secondary)" }}>Created {new Date(s.created_at).toLocaleString()}</span>
                  {s.created_by_me ? (
                    confirmRevoke === s.share_id ? (
                      <>
                        <Button
                          kind="danger"
                          size="sm"
                          loading={revoke.isPending}
                          onClick={() => revoke.mutate(s.share_id, { onSuccess: () => setConfirmRevoke(null) })}
                        >
                          Confirm revoke
                        </Button>
                        <Button kind="ghost" size="sm" onClick={() => setConfirmRevoke(null)}>
                          Keep
                        </Button>
                      </>
                    ) : (
                      <Button kind="secondary" size="sm" icon="Trash" onClick={() => setConfirmRevoke(s.share_id)}>
                        Revoke
                      </Button>
                    )
                  ) : (
                    <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Created by another user</span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {revoke.isError && (
            <div role="alert" style={{ fontSize: 13, color: "var(--danger)", marginTop: 6 }}>
              {revoke.error instanceof Error ? revoke.error.message : "Could not revoke the link."}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
