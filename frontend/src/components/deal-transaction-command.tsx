"use client";

import { useMemo, useState, type FormEvent } from "react";

import { WorkspaceSaveState, useWorkspaceSaveState } from "@/components/workspace-save-state";
import { Panel, StatusPill } from "@/components/buyer-shell";
import type {
  DealAssignmentFeeTrackerRecord,
  DealClosingTimelineEventRecord,
  DealContractDraftRecord,
  DealContractTemplateRecord,
  DealContractTemplateValidation,
  DealDocumentVaultRecord,
  DealEmdTrackerRecord,
  DealSignaturePacketRecord,
  DealTitleChecklistItemRecord,
  DealTransactionCenterSnapshot,
} from "@/lib/deal-engine-server";

type TabKey = "overview" | "contracts" | "emd" | "assignment" | "title" | "timeline" | "documents";

function formatCurrency(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "Not entered";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

function canPrepareForSignature(
  validation: DealContractTemplateValidation | null,
  draft: DealContractDraftRecord | null,
) {
  if (!validation || !draft) return false;
  if (!validation.purposeValid) return false;
  if (validation.template.approvalStatus === "reference_only") return false;
  if (validation.missingFields.length) return false;
  if (!draft.legalDisclaimerAcknowledged) return false;
  return true;
}

function templateWarningLines(template: DealContractTemplateRecord | null) {
  if (!template) return [];
  if (template.approvalStatus === "attorney_approved") {
    return [
      "Attorney-approved source template integrated.",
      "Confirm all deal-specific fields before signature.",
      "Operator review is still required before release.",
    ];
  }
  if (template.approvalStatus === "attorney_review_required") {
    return [
      "Attorney review required.",
      "Do not send for signature until approved.",
      "Generated documents are not legal advice.",
    ];
  }
  return [
    "Reference template only.",
    "Attorney review required.",
    "Do not send for signature until approved.",
    "Generated documents are not legal advice.",
  ];
}

export function DealTransactionCommand({
  dealId,
  initialSnapshot,
}: {
  dealId: string;
  initialSnapshot: DealTransactionCenterSnapshot | null;
}) {
  const emptySnapshot: DealTransactionCenterSnapshot = {
    contractTemplates: [],
    contracts: [],
    signaturePacket: {
      id: null,
      signatureStatus: "draft",
      sentForSignatureAt: null,
      signedBySellerAt: null,
      signedByBuyerAt: null,
      signatureProvider: "",
      signaturePacketUrl: "",
      signerEmail: "",
      signerRole: "",
      availableProviders: ["DocuSign", "PandaDoc", "Dropbox Sign"],
    },
    titleChecklist: [],
    emdTracker: {
      id: null,
      emdAmount: null,
      emdDueDate: "",
      emdHolder: "",
      emdHolderType: "title_company",
      emdStatus: "pending",
      emdPaymentMethod: "",
      emdReceiptUrl: "",
      emdNotes: "",
      alertFlags: [],
      statusTone: "neutral",
    },
    assignmentTracker: {
      id: null,
      sellerContractPrice: null,
      buyerAssignmentPrice: null,
      assignmentFee: null,
      expectedNetFee: null,
      titleCompanyFee: null,
      otherClosingCosts: null,
      payoutStatus: "projected",
      payoutDueDate: "",
      payoutReceivedAt: "",
      payoutNotes: "",
      closingWarning: null,
    },
    timeline: [],
    documents: [],
  };

  const [activeTab, setActiveTab] = useState<TabKey>("overview");
  const [snapshot, setSnapshot] = useState<DealTransactionCenterSnapshot>(initialSnapshot ?? emptySnapshot);
  const initialTemplateKey = initialSnapshot?.contractTemplates.find((template) => template.approvalStatus !== "reference_only")?.templateKey
    ?? initialSnapshot?.contractTemplates[0]?.templateKey
    ?? "";
  const [selectedTemplateKey, setSelectedTemplateKey] = useState(initialTemplateKey);
  const [contractDraft, setContractDraft] = useState<DealContractDraftRecord | null>(initialSnapshot?.contracts[0] ?? null);
  const [templateValidation, setTemplateValidation] = useState<DealContractTemplateValidation | null>(null);
  const [signaturePacket, setSignaturePacket] = useState<DealSignaturePacketRecord>(initialSnapshot?.signaturePacket ?? emptySnapshot.signaturePacket);
  const [emdTracker, setEmdTracker] = useState<DealEmdTrackerRecord>(initialSnapshot?.emdTracker ?? emptySnapshot.emdTracker);
  const [assignmentTracker, setAssignmentTracker] = useState<DealAssignmentFeeTrackerRecord>(initialSnapshot?.assignmentTracker ?? emptySnapshot.assignmentTracker);
  const [titleChecklist, setTitleChecklist] = useState<DealTitleChecklistItemRecord[]>(initialSnapshot?.titleChecklist ?? []);
  const [timeline, setTimeline] = useState<DealClosingTimelineEventRecord[]>(initialSnapshot?.timeline ?? []);
  const [documents, setDocuments] = useState<DealDocumentVaultRecord[]>(initialSnapshot?.documents ?? []);
  const [status, setStatus] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);

  const draftSave = useWorkspaceSaveState(contractDraft);
  const depositSave = useWorkspaceSaveState(emdTracker);
  const assignmentSave = useWorkspaceSaveState(assignmentTracker);
  const signatureSave = useWorkspaceSaveState(signaturePacket);
  const titleSave = useWorkspaceSaveState(Object.fromEntries(titleChecklist.map(item => [item.id, item])));
  const timelineSave = useWorkspaceSaveState(Object.fromEntries(timeline.map(item => [item.id, item])));
  const selectedTemplate = useMemo<DealContractTemplateRecord | null>(
    () => snapshot.contractTemplates.find((template) => template.templateKey === selectedTemplateKey) ?? null,
    [selectedTemplateKey, snapshot.contractTemplates],
  );

  async function validateTemplate(templateKey = selectedTemplateKey) {
    if (!templateKey) return;
    const template = snapshot.contractTemplates.find((entry) => entry.templateKey === templateKey);
    if (!template) return;
    setWorking("contract-validate");
    setStatus(null);
    try {
      const response = await fetch("/api/deal-engine/contracts/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dealId,
          templateKey,
          templateType: template.type,
          requestedUse: template.requestedUse,
          state: template.state,
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? "Template validation failed.");
      setTemplateValidation(payload.validation ?? null);
      setStatus("Template validation refreshed.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Template validation failed.");
    } finally {
      setWorking(null);
    }
  }

  async function generateContractDraft() {
    if (!selectedTemplate) return;
    if (draftSave.dirty && !window.confirm("Replace your unsaved contract edits with a newly generated draft?")) return;
    setWorking("contracts");
    setStatus(null);
    try {
      const response = await fetch("/api/deal-engine/contracts/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dealId,
          templateKey: selectedTemplate.templateKey,
          templateType: selectedTemplate.type,
          requestedUse: selectedTemplate.requestedUse,
          state: selectedTemplate.state,
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? "Contract generation failed.");
      setContractDraft(payload.draft);
      draftSave.load(payload.draft);
      setTemplateValidation(payload.validation ?? null);
      setSnapshot((current) => ({
        ...current,
        contracts: [
          payload.draft,
          ...current.contracts.filter((item) => item.id !== payload.draft.id && item.draftType !== payload.draft.draftType),
        ],
      }));
      setStatus(payload.validation?.missingFields?.length ? "Draft generated with missing-field warnings." : "Contract draft generated.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Contract generation failed.");
    } finally {
      setWorking(null);
    }
  }

  async function saveContractDraft() {
    if (!contractDraft || !selectedTemplate) return;
    const submitted = draftSave.begin();
    if (submitted === null) return;
    setWorking("contract-save");
    setStatus(null);
    try {
      const response = await fetch("/api/deal-engine/contracts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dealId,
          templateId: contractDraft.templateId,
          templateKey: snapshot.contractTemplates.find((template) => template.id === contractDraft.templateId)?.templateKey ?? selectedTemplate.templateKey,
          draftType: contractDraft.draftType,
          title: contractDraft.title,
          body: contractDraft.body,
          specialTerms: contractDraft.specialTerms,
          status: contractDraft.status,
          editablePayload: contractDraft.editablePayload,
          legalDisclaimerAcknowledged: contractDraft.legalDisclaimerAcknowledged,
          generatedPdfUrl: contractDraft.generatedPdfUrl,
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? "Contract save failed.");
      const savedDraft = { ...contractDraft, id: payload.draftId };
      setContractDraft(savedDraft);
      draftSave.succeed(JSON.stringify(savedDraft));
      setSnapshot((current) => ({
        ...current,
        contracts: [savedDraft, ...current.contracts.filter((item) => item.id !== contractDraft.id && item.id !== savedDraft.id)],
      }));
      setStatus("Contract draft saved.");
    } catch (error) {
      draftSave.fail();
      setStatus(error instanceof Error ? error.message : "Contract save failed.");
    } finally {
      setWorking(null);
    }
  }

  async function exportDraftPdf() {
    if (!contractDraft) return;
    setWorking("contract-export");
    setStatus(null);
    try {
      const response = await fetch("/api/deal-engine/contracts/export-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftId: contractDraft.id }),
      });
      if (!response.ok) {
        const body = await response.json();
        throw new Error(body.error ?? "PDF export failed.");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${contractDraft.draftType}-${dealId}.pdf`;
      anchor.click();
      URL.revokeObjectURL(url);
      setStatus("PDF exported.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "PDF export failed.");
    } finally {
      setWorking(null);
    }
  }

  async function attachDraftToVault() {
    if (!contractDraft) return;
    setWorking("contract-attach");
    setStatus(null);
    try {
      const response = await fetch("/api/deal-engine/contracts/attach-to-vault", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dealId, draftId: contractDraft.id }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? "Vault attach failed.");
      const nextDraft = {
        ...contractDraft,
        generatedPdfUrl: payload.documentUrl ?? contractDraft.generatedPdfUrl,
      };
      setContractDraft(nextDraft);
      draftSave.acknowledgeFields({ generatedPdfUrl: nextDraft.generatedPdfUrl });
      setSnapshot((current) => ({
        ...current,
        contracts: current.contracts.map((entry) => (entry.id === nextDraft.id ? nextDraft : entry)),
      }));
      await refreshDocuments();
      setStatus("Generated PDF attached to Deal Document Vault.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Vault attach failed.");
    } finally {
      setWorking(null);
    }
  }

  async function updateSignaturePacket(payload: Partial<DealSignaturePacketRecord>, prepare = false) {
    if (prepare && !contractDraft?.id) {
      setStatus("Select a saved contract draft before signature preparation.");
      return;
    }
    if (!prepare && payload.signatureStatus && !window.confirm("Have you checked the actual signature packet and confirmed this send or signature? This only records status; it does not send or sign a document.")) return;
    if (signatureSave.begin() === null) return;
    setWorking("signature");
    setStatus(null);
    try {
      const response = await fetch(
        prepare ? "/api/deal-engine/signature/prepare" : "/api/deal-engine/signature/update-status",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            dealId,
            draftId: prepare ? contractDraft?.id : undefined,
            signatureProvider: payload.signatureProvider ?? signaturePacket.signatureProvider,
            signerEmail: payload.signerEmail ?? signaturePacket.signerEmail,
            signerRole: payload.signerRole ?? signaturePacket.signerRole,
            signatureStatus: payload.signatureStatus ?? signaturePacket.signatureStatus,
            sentForSignatureAt: payload.sentForSignatureAt ?? signaturePacket.sentForSignatureAt,
            signedBySellerAt: payload.signedBySellerAt ?? signaturePacket.signedBySellerAt,
            signedByBuyerAt: payload.signedByBuyerAt ?? signaturePacket.signedByBuyerAt,
            signaturePacketUrl: payload.signaturePacketUrl ?? signaturePacket.signaturePacketUrl,
          }),
        },
      );
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error ?? "Signature update failed.");
      const next = {
        ...signaturePacket,
        ...payload,
        signaturePacketUrl: body.packetUrl ?? payload.signaturePacketUrl ?? signaturePacket.signaturePacketUrl,
      };
      if (prepare) {
        next.signatureStatus = "prepared";
        next.signatureProvider = (payload.signatureProvider ?? signaturePacket.signatureProvider).trim() || "DocuSign";
      }
      next.signerEmail = next.signerEmail.trim();
      next.signerRole = next.signerRole.trim();
      setSignaturePacket(next);
      signatureSave.succeed(JSON.stringify(next));
      setStatus(prepare ? "Signature packet prepared." : "Signature status updated.");
    } catch (error) {
      signatureSave.fail();
      setStatus(error instanceof Error ? error.message : "Signature update failed.");
    } finally {
      setWorking(null);
    }
  }

  async function saveEmdTracker() {
    const submitted = depositSave.begin();
    if (submitted === null) return;
    setWorking("emd");
    setStatus(null);
    try {
      const response = await fetch("/api/deal-engine/emd", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dealId, ...emdTracker }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? "EMD save failed.");
      setEmdTracker(payload.tracker);
      depositSave.succeed(JSON.stringify(payload.tracker));
      setStatus("Purchase deposit record updated.");
    } catch (error) {
      depositSave.fail();
      setStatus(error instanceof Error ? error.message : "EMD save failed.");
    } finally {
      setWorking(null);
    }
  }

  async function saveAssignmentTracker() {
    const submitted = assignmentSave.begin();
    if (submitted === null) return;
    setWorking("assignment");
    setStatus(null);
    try {
      const response = await fetch("/api/deal-engine/assignment-fee", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dealId,
          sellerContractPrice: assignmentTracker.sellerContractPrice,
          buyerAssignmentPrice: assignmentTracker.buyerAssignmentPrice,
          titleCompanyFee: assignmentTracker.titleCompanyFee,
          otherClosingCosts: assignmentTracker.otherClosingCosts,
          payoutStatus: assignmentTracker.payoutStatus,
          payoutDueDate: assignmentTracker.payoutDueDate,
          payoutReceivedAt: assignmentTracker.payoutReceivedAt,
          payoutNotes: assignmentTracker.payoutNotes,
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? "Assignment fee save failed.");
      setAssignmentTracker(payload.tracker);
      assignmentSave.succeed(JSON.stringify(payload.tracker));
      setStatus("Assignment tracker updated.");
    } catch (error) {
      assignmentSave.fail();
      setStatus(error instanceof Error ? error.message : "Assignment fee save failed.");
    } finally {
      setWorking(null);
    }
  }

  async function updateChecklistItem(item: DealTitleChecklistItemRecord) {
    if (titleSave.begin() === null) return;
    setWorking(`title-${item.id}`);
    setStatus(null);
    try {
      const response = await fetch("/api/deal-engine/title-checklist/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemId: item.id,
          status: item.status,
          notes: item.notes,
          dueDate: item.dueDate,
          assignedOwner: item.assignedOwner,
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? "Checklist update failed.");
      titleSave.succeedFields({ [item.id]: item });
      setStatus("Title checklist item updated.");
    } catch (error) {
      titleSave.fail();
      setStatus(error instanceof Error ? error.message : "Checklist update failed.");
    } finally {
      setWorking(null);
    }
  }

  async function updateTimelineEvent(item: DealClosingTimelineEventRecord) {
    if (timelineSave.begin() === null) return;
    setWorking(`timeline-${item.id}`);
    setStatus(null);
    try {
      const response = await fetch("/api/deal-engine/timeline/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId: item.id,
          label: item.label,
          status: item.status,
          dueDate: item.dueDate,
          completedAt: item.completedAt,
          notes: item.notes,
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? "Timeline update failed.");
      timelineSave.succeedFields({ [item.id]: item });
      setStatus("Timeline event updated.");
    } catch (error) {
      timelineSave.fail();
      setStatus(error instanceof Error ? error.message : "Timeline update failed.");
    } finally {
      setWorking(null);
    }
  }

  async function refreshDocuments(category = "") {
    const response = await fetch(`/api/deal-engine/document?dealId=${encodeURIComponent(dealId)}${category ? `&category=${encodeURIComponent(category)}` : ""}`, {
      cache: "no-store",
    });
    const payload = await response.json();
    if (response.ok && payload.ok) {
      setDocuments(payload.documents ?? []);
    }
  }

  async function uploadDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setWorking("documents");
    setStatus(null);
    try {
      const form = event.currentTarget;
      const payload = new FormData(form);
      payload.set("dealId", dealId);
      const response = await fetch("/api/deal-engine/upload-document", { method: "POST", body: payload });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error ?? "Document upload failed.");
      await refreshDocuments();
      form.reset();
      setStatus("Document uploaded.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Document upload failed.");
    } finally {
      setWorking(null);
    }
  }

  const tabs: Array<{ key: TabKey; label: string }> = [
    { key: "overview", label: "Overview" },
    { key: "contracts", label: "Contracts" },
    { key: "emd", label: "Purchase deposit" },
    { key: "assignment", label: "Assignment Fee" },
    { key: "title", label: "Title" },
    { key: "timeline", label: "Timeline" },
    { key: "documents", label: "Documents" },
  ];

  return (
    <Panel
      eyebrow="Transaction Command"
      title="Contracts and closing"
      description="Review contract drafts, track the purchase deposit, record signatures and organize closing documents for this property."
    >
      <p className="mb-4 text-sm leading-6 text-[var(--copy-soft)]">Proposed terms and saved drafts do not mean a contract is executed. Signature status is an operator record: record sent or signed only after checking the actual provider packet. Preparing a packet does not send it.</p>
      <fieldset disabled={Boolean(working)} className="min-w-0 border-0 p-0">
      <div className="mb-5 flex flex-wrap gap-2">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={`rounded-full border px-4 py-2 text-xs uppercase tracking-[0.18em] transition ${
              activeTab === tab.key
                ? "border-[var(--line-strong)] bg-[hsl(0_0%_100%/.08)] text-white"
                : "border-[var(--line)] bg-[hsl(0_0%_100%/.02)] text-[var(--copy-soft)]"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "overview" ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="brand-card p-4">
            <div className="text-[11px] uppercase tracking-[0.24em] text-[var(--copy-muted)]">Drafts saved</div>
            <div className="brand-accent-text mt-2 text-2xl font-semibold">{snapshot.contracts.length}</div>
          </div>
          <div className="brand-card p-4">
            <div className="text-[11px] uppercase tracking-[0.24em] text-[var(--copy-muted)]">Templates registered</div>
            <div className="mt-2 text-lg font-semibold text-white">{snapshot.contractTemplates.length}</div>
          </div>
          <div className="brand-card p-4">
            <div className="text-[11px] uppercase tracking-[0.24em] text-[var(--copy-muted)]">Purchase deposit status</div>
            <div className="mt-2 text-lg font-semibold text-white">{emdTracker.emdStatus}</div>
          </div>
          <div className="brand-card p-4">
            <div className="text-[11px] uppercase tracking-[0.24em] text-[var(--copy-muted)]">Expected net fee</div>
            <div className="mt-2 text-lg font-semibold text-white">{formatCurrency(assignmentTracker.expectedNetFee)}</div>
          </div>
        </div>
      ) : null}

      {activeTab === "overview" || activeTab === "contracts" ? <WorkspaceSaveState state={signatureSave} label="Signature packet" /> : null}
      {activeTab === "title" ? <WorkspaceSaveState state={titleSave} label="Title checklist" /> : null}
      {activeTab === "timeline" ? <WorkspaceSaveState state={timelineSave} label="Closing timeline" /> : null}
      {activeTab === "contracts" ? <WorkspaceSaveState state={draftSave} label="Contract draft" /> : null}
      {activeTab === "contracts" ? (
        <div className="grid gap-6 xl:grid-cols-[0.88fr_1.12fr]">
          <div className="space-y-4">
            <div className="brand-card p-4 text-sm leading-6 text-[var(--copy-soft)]">
              {templateWarningLines(selectedTemplate).map((line) => (
                <div key={line}>{line}</div>
              ))}
            </div>

            <div className="brand-card p-4">
              <div className="text-[11px] uppercase tracking-[0.24em] text-[var(--copy-muted)]">Template Library</div>
              <label className="grid gap-2 text-sm text-[var(--copy-soft)]"><span>Contract template</span><select
                value={selectedTemplateKey}
                onChange={(event) => {
                  setSelectedTemplateKey(event.target.value);
                  setTemplateValidation(null);
                }}
                className="brand-input mt-3 w-full px-3 py-3 text-sm outline-none"
              >
                {snapshot.contractTemplates.map((template) => (
                  <option key={template.templateKey} value={template.templateKey}>
                    {template.name} / {template.type}{template.state ? ` / ${template.state}` : ""}
                  </option>
                ))}
              </select></label>
              <div className="mt-3 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => void validateTemplate()}
                  disabled={!selectedTemplateKey || working === "contract-validate"}
                  className="brand-button inline-flex px-4 py-3 text-sm uppercase tracking-[0.18em] transition disabled:opacity-60"
                >
                  {working === "contract-validate" ? "Checking..." : "Validate template"}
                </button>
                <button
                  type="button"
                  onClick={() => void generateContractDraft()}
                  disabled={!selectedTemplateKey || working === "contracts"}
                  className="brand-button inline-flex px-4 py-3 text-sm uppercase tracking-[0.18em] transition disabled:opacity-60"
                >
                  {working === "contracts" ? "Generating..." : "Generate draft"}
                </button>
              </div>
            </div>

            {selectedTemplate ? (
              <div className="brand-card space-y-3 p-4 text-sm text-[var(--copy-soft)]">
                <div className="text-base font-semibold text-white">{selectedTemplate.name}</div>
                <div>{selectedTemplate.intendedPurpose}</div>
                <div>Source: <a href={selectedTemplate.sourceUrl} target="_blank" rel="noreferrer" className="text-[var(--project-accent)] underline-offset-2 hover:underline">{selectedTemplate.sourceName}</a></div>
                <div className="flex flex-wrap gap-2">
                  <StatusPill tone={selectedTemplate.licenseStatus === "public" ? "good" : "warn"} label={`license ${selectedTemplate.licenseStatus}`} />
                  <StatusPill tone={selectedTemplate.approvalStatus === "attorney_approved" ? "good" : "warn"} label={selectedTemplate.approvalStatus.replaceAll("_", " ")} />
                </div>
                <div>{selectedTemplate.notes}</div>
              </div>
            ) : null}

            {templateValidation ? (
              <div className="brand-card p-4">
                <div className="text-[11px] uppercase tracking-[0.24em] text-[var(--copy-muted)]">Required Field Checklist</div>
                <div className="mt-3 space-y-2 text-sm text-[var(--copy-soft)]">
                  {templateValidation.template.requiredFields.map((field) => {
                    const missing = templateValidation.missingFields.includes(field);
                    return (
                      <div key={field} className="flex items-center justify-between gap-3 rounded-[14px] border border-[var(--line)] px-3 py-2">
                        <span>{field.replaceAll("_", " ")}</span>
                        <StatusPill tone={missing ? "warn" : "good"} label={missing ? "missing" : "ready"} />
                      </div>
                    );
                  })}
                </div>
                {templateValidation.blockingError ? (
                  <div className="mt-4 rounded-[14px] border border-[hsl(22_100%_72%/.35)] bg-[hsl(22_100%_72%/.08)] px-3 py-3 text-sm text-[hsl(22_100%_82%)]">
                    {templateValidation.blockingError}
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="space-y-3">
              {snapshot.contracts.map((draft) => (
                <button
                  key={draft.id}
                  type="button"
                  onClick={() => { if (draftSave.dirty && !window.confirm("Discard unsaved contract edits and open this draft?")) return; setContractDraft(draft); draftSave.load(draft); }}
                  className="brand-card block w-full p-4 text-left transition hover:border-[var(--line-strong)]"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-base font-semibold text-white">{draft.title}</div>
                      <div className="mt-1 text-xs text-[var(--copy-muted)]">{draft.templateType} / {draft.status}</div>
                    </div>
                    <StatusPill tone={draft.legalDisclaimerAcknowledged ? "good" : "warn"} label={draft.legalDisclaimerAcknowledged ? "disclaimer ack" : "ack needed"} />
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            {contractDraft ? (
              <div className="brand-card p-4">
                <label className="grid gap-2 text-sm text-[var(--copy-soft)]"><span>Draft title</span><input
                  value={contractDraft.title}
                  onChange={(event) => setContractDraft({ ...contractDraft, title: event.target.value })}
                  className="brand-input w-full px-3 py-3 text-sm outline-none"
                /></label>
                <label className="grid gap-2 text-sm text-[var(--copy-soft)]"><span>Special terms</span><textarea
                  value={contractDraft.specialTerms}
                  onChange={(event) => setContractDraft({ ...contractDraft, specialTerms: event.target.value })}
                  className="brand-input mt-3 min-h-24 w-full px-3 py-3 text-sm outline-none"
                  placeholder="Special terms"
                /></label>
                <label className="grid gap-2 text-sm text-[var(--copy-soft)]"><span>Contract draft text</span><textarea
                  value={contractDraft.body}
                  onChange={(event) => setContractDraft({ ...contractDraft, body: event.target.value })}
                  className="brand-input mt-3 min-h-[360px] w-full px-3 py-3 text-sm outline-none"
                /><span className="text-xs leading-5 text-[var(--copy-muted)]">Saved draft text is not an executed agreement.</span></label>
                <label className="mt-4 flex items-start gap-3 text-sm text-[var(--copy-soft)]">
                  <input
                    type="checkbox"
                    checked={contractDraft.legalDisclaimerAcknowledged}
                    onChange={(event) => setContractDraft({ ...contractDraft, legalDisclaimerAcknowledged: event.target.checked })}
                    className="mt-1"
                  />
                  <span>I understand this is a generated reference document, not legal advice, and it must be attorney-reviewed before signature.</span>
                </label>
                <div className="mt-4 flex flex-wrap gap-3">
                  <button type="button" onClick={() => void saveContractDraft()} disabled={working === "contract-save"} className="brand-button inline-flex px-4 py-3 text-sm uppercase tracking-[0.18em] transition disabled:opacity-60">
                    {working === "contract-save" ? "Saving..." : "Save draft"}
                  </button>
                  <button type="button" onClick={() => void exportDraftPdf()} disabled={working === "contract-export"} className="brand-button inline-flex px-4 py-3 text-sm uppercase tracking-[0.18em] transition disabled:opacity-60">
                    {working === "contract-export" ? "Exporting..." : "Export PDF"}
                  </button>
                  <button type="button" onClick={() => void attachDraftToVault()} disabled={working === "contract-attach"} className="brand-button inline-flex px-4 py-3 text-sm uppercase tracking-[0.18em] transition disabled:opacity-60">
                    {working === "contract-attach" ? "Attaching..." : "Attach to vault"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void updateSignaturePacket(signaturePacket, true)}
                    disabled={!canPrepareForSignature(templateValidation, contractDraft) || working === "signature"}
                    className="brand-button inline-flex px-4 py-3 text-sm uppercase tracking-[0.18em] transition disabled:opacity-40"
                  >
                    Prepare for signature
                  </button>
                </div>
                {!canPrepareForSignature(templateValidation, contractDraft) ? (
                  <div className="mt-4 rounded-[14px] border border-[var(--line)] bg-[hsl(0_0%_100%/.03)] px-4 py-3 text-sm text-[var(--copy-soft)]">
                    Prepare for Signature stays locked until the template is not `reference_only`, all required fields are present, and the disclaimer is acknowledged.
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="brand-card p-5 text-sm text-[var(--copy-soft)]">No contract draft yet. Choose a template and review the purchase terms above to create one.</div>
            )}
          </div>
        </div>
      ) : null}

      {activeTab === "emd" ? <WorkspaceSaveState state={depositSave} label="Purchase deposit" /> : null}
      {activeTab === "assignment" ? <WorkspaceSaveState state={assignmentSave} label="Assignment fee" /> : null}
      {activeTab === "emd" ? (
        <div className="grid gap-4 xl:grid-cols-[0.82fr_1.18fr]">
          <div className="brand-card p-4">
            <div className="flex flex-wrap gap-2">
              <StatusPill tone={emdTracker.statusTone} label={emdTracker.emdStatus} />
              <StatusPill tone="neutral" label={formatCurrency(emdTracker.emdAmount)} />
            </div>
            <div className="mt-4 space-y-2 text-sm text-[var(--copy-soft)]">
              {emdTracker.alertFlags.length ? emdTracker.alertFlags.map((flag) => <div key={flag}>{flag}</div>) : <div>No current EMD alerts.</div>}
            </div>
          </div>
          <div className="brand-card p-4">
            <div className="grid gap-3 md:grid-cols-2">
              <label className="grid gap-2 text-sm text-[var(--copy-soft)]"><span>Purchase deposit (USD)</span><input type="number" inputMode="decimal" min="0" step="any" value={String(emdTracker.emdAmount ?? "")} onChange={(event) => setEmdTracker({ ...emdTracker, emdAmount: event.target.value === "" ? null : Number(event.target.value) })} className="brand-input px-3 py-3 text-sm outline-none" placeholder="EMD amount" /><span className="text-xs leading-5 text-[var(--copy-muted)]">Earnest money purchase deposit. Use 0 only if no deposit is required; confirm the agreed amount.</span></label>
              <label className="grid gap-2 text-sm text-[var(--copy-soft)]"><span>Purchase deposit due date</span><input type={!emdTracker.emdDueDate || /^\d{4}-\d{2}-\d{2}$/.test(emdTracker.emdDueDate) ? "date" : "text"} value={emdTracker.emdDueDate} onChange={(event) => setEmdTracker({ ...emdTracker, emdDueDate: event.target.value })} className="brand-input px-3 py-3 text-sm outline-none" placeholder="EMD due date" /><span className="text-xs leading-5 text-[var(--copy-muted)]">Use YYYY-MM-DD. Record the date agreed for this transaction.</span></label>
              <label className="grid gap-2 text-sm text-[var(--copy-soft)]"><span>Deposit holder</span><input value={emdTracker.emdHolder} onChange={(event) => setEmdTracker({ ...emdTracker, emdHolder: event.target.value })} className="brand-input px-3 py-3 text-sm outline-none" placeholder="EMD holder" /></label>
              <label className="grid gap-2 text-sm text-[var(--copy-soft)]"><span>Deposit holder type</span><select value={emdTracker.emdHolderType} onChange={(event) => setEmdTracker({ ...emdTracker, emdHolderType: event.target.value as DealEmdTrackerRecord["emdHolderType"] })} className="brand-input px-3 py-3 text-sm outline-none">
                <option value="title_company">Title company</option>
                <option value="attorney">Attorney</option>
                <option value="broker">Broker</option>
                <option value="other">Other</option>
              </select></label>
              <label className="grid gap-2 text-sm text-[var(--copy-soft)]"><span>Deposit status</span><select value={emdTracker.emdStatus} onChange={(event) => setEmdTracker({ ...emdTracker, emdStatus: event.target.value as DealEmdTrackerRecord["emdStatus"] })} className="brand-input px-3 py-3 text-sm outline-none">
                <option value="not_required">Not required</option>
                <option value="pending">Pending</option>
                <option value="submitted">Submitted</option>
                <option value="received">Received</option>
                <option value="overdue">Overdue</option>
                <option value="released">Released</option>
                <option value="forfeited">Forfeited</option>
              </select></label>
              <label className="grid gap-2 text-sm text-[var(--copy-soft)]"><span>Payment method</span><input value={emdTracker.emdPaymentMethod} onChange={(event) => setEmdTracker({ ...emdTracker, emdPaymentMethod: event.target.value })} className="brand-input px-3 py-3 text-sm outline-none" placeholder="Payment method" /></label>
              <label className="grid gap-2 text-sm text-[var(--copy-soft)] md:col-span-2"><span>Deposit receipt URL</span><input value={emdTracker.emdReceiptUrl} onChange={(event) => setEmdTracker({ ...emdTracker, emdReceiptUrl: event.target.value })} className="brand-input px-3 py-3 text-sm outline-none" placeholder="EMD receipt URL" /></label>
            </div>
            <label className="grid gap-2 text-sm text-[var(--copy-soft)]"><span>Deposit notes</span><textarea value={emdTracker.emdNotes} onChange={(event) => setEmdTracker({ ...emdTracker, emdNotes: event.target.value })} className="brand-input mt-3 min-h-24 w-full px-3 py-3 text-sm outline-none" placeholder="EMD notes" /></label>
            <button type="button" onClick={() => void saveEmdTracker()} disabled={working === "emd"} className="brand-button mt-3 inline-flex px-4 py-3 text-sm uppercase tracking-[0.18em] transition disabled:opacity-60">
              Save purchase deposit
            </button>
          </div>
        </div>
      ) : null}

      {activeTab === "assignment" ? (
        <div className="grid gap-4 xl:grid-cols-[0.82fr_1.18fr]">
          <div className="brand-card p-4">
            <div className="text-lg font-semibold text-white">Assignment payout estimate</div>
            <p className="mt-2 text-sm leading-6 text-[var(--copy-muted)]">Leave unknown amounts blank. Enter 0 only when confirmed. Save changed amounts to recalculate fees; negative results indicate a loss. These figures do not confirm an executed contract or received payout.</p>
            <div className="mt-3 space-y-2 text-sm text-[var(--copy-soft)]">
              <div>Saved gross assignment fee: <span className="text-white">{formatCurrency(assignmentTracker.assignmentFee)}</span></div>
              <div>Saved expected net payout: <span className="text-white">{formatCurrency(assignmentTracker.expectedNetFee)}</span></div>
              <div>Payout status: <span className="text-white">{assignmentTracker.payoutStatus}</span></div>
              {assignmentTracker.closingWarning ? <div className="text-[hsl(22_100%_72%)]">{assignmentTracker.closingWarning}</div> : null}
            </div>
          </div>
          <div className="brand-card p-4">
            <div className="grid gap-3 md:grid-cols-2">
              <label className="grid gap-2 text-sm text-[var(--copy-soft)]"><span>Seller purchase price (USD)</span><input type="number" inputMode="decimal" min="0" step="any" value={String(assignmentTracker.sellerContractPrice ?? "")} onChange={(event) => setAssignmentTracker({ ...assignmentTracker, sellerContractPrice: event.target.value === "" ? null : Number(event.target.value) })} className="brand-input px-3 py-3 text-sm outline-none" placeholder="Seller contract price" /></label>
              <label className="grid gap-2 text-sm text-[var(--copy-soft)]"><span>End buyer purchase price (USD)</span><input type="number" inputMode="decimal" min="0" step="any" value={String(assignmentTracker.buyerAssignmentPrice ?? "")} onChange={(event) => setAssignmentTracker({ ...assignmentTracker, buyerAssignmentPrice: event.target.value === "" ? null : Number(event.target.value) })} className="brand-input px-3 py-3 text-sm outline-none" placeholder="Buyer assignment price" /></label>
              <label className="grid gap-2 text-sm text-[var(--copy-soft)]"><span>Title company fee (USD)</span><input type="number" inputMode="decimal" min="0" step="any" value={String(assignmentTracker.titleCompanyFee ?? "")} onChange={(event) => setAssignmentTracker({ ...assignmentTracker, titleCompanyFee: event.target.value === "" ? null : Number(event.target.value) })} className="brand-input px-3 py-3 text-sm outline-none" placeholder="Title company fee" /></label>
              <label className="grid gap-2 text-sm text-[var(--copy-soft)]"><span>Other closing costs (USD)</span><input type="number" inputMode="decimal" min="0" step="any" value={String(assignmentTracker.otherClosingCosts ?? "")} onChange={(event) => setAssignmentTracker({ ...assignmentTracker, otherClosingCosts: event.target.value === "" ? null : Number(event.target.value) })} className="brand-input px-3 py-3 text-sm outline-none" placeholder="Other closing costs" /></label>
              <label className="grid gap-2 text-sm text-[var(--copy-soft)]"><span>Payout status</span><select value={assignmentTracker.payoutStatus} onChange={(event) => setAssignmentTracker({ ...assignmentTracker, payoutStatus: event.target.value as DealAssignmentFeeTrackerRecord["payoutStatus"] })} className="brand-input px-3 py-3 text-sm outline-none">
                <option value="projected">Projected</option>
                <option value="pending_closing">Pending closing</option>
                <option value="confirmed">Confirmed</option>
                <option value="paid">Paid</option>
                <option value="delayed">Delayed</option>
              </select></label>
              <label className="grid gap-2 text-sm text-[var(--copy-soft)]"><span>Payout due date</span><input type={!assignmentTracker.payoutDueDate || /^\d{4}-\d{2}-\d{2}$/.test(assignmentTracker.payoutDueDate) ? "date" : "text"} value={assignmentTracker.payoutDueDate} onChange={(event) => setAssignmentTracker({ ...assignmentTracker, payoutDueDate: event.target.value })} className="brand-input px-3 py-3 text-sm outline-none" placeholder="Payout due date" /><span className="text-xs leading-5 text-[var(--copy-muted)]">Use YYYY-MM-DD. Record the date agreed for this transaction.</span></label>
              <label className="grid gap-2 text-sm text-[var(--copy-soft)] md:col-span-2"><span>Payout received at</span><input value={assignmentTracker.payoutReceivedAt} onChange={(event) => setAssignmentTracker({ ...assignmentTracker, payoutReceivedAt: event.target.value })} className="brand-input px-3 py-3 text-sm outline-none" placeholder="Payout received at" /><span className="text-xs leading-5 text-[var(--copy-muted)]">Use an ISO date and time, for example 2026-10-08T15:00:00-04:00. Record actual receipt or completion.</span></label>
            </div>
            <label className="grid gap-2 text-sm text-[var(--copy-soft)]"><span>Payout notes</span><textarea value={assignmentTracker.payoutNotes} onChange={(event) => setAssignmentTracker({ ...assignmentTracker, payoutNotes: event.target.value })} className="brand-input mt-3 min-h-24 w-full px-3 py-3 text-sm outline-none" placeholder="Payout notes" /></label>
            <button type="button" onClick={() => void saveAssignmentTracker()} disabled={working === "assignment"} className="brand-button mt-3 inline-flex px-4 py-3 text-sm uppercase tracking-[0.18em] transition disabled:opacity-60">
              Save assignment tracker
            </button>
          </div>
        </div>
      ) : null}

      {activeTab === "title" ? (
        <div className="space-y-4">
          {titleChecklist.length ? titleChecklist.map((item, index) => (
            <div key={item.id} className="brand-card p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-base font-semibold text-white">{index + 1}. {item.label}</div>
                <StatusPill tone={item.status === "complete" ? "good" : item.status === "blocked" ? "warn" : "neutral"} label={item.status} />
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-3">
                <label className="grid gap-2 text-sm text-[var(--copy-soft)]"><span>Checklist status</span><select value={item.status} onChange={(event) => setTitleChecklist((current) => current.map((entry) => entry.id === item.id ? { ...entry, status: event.target.value as DealTitleChecklistItemRecord["status"] } : entry))} className="brand-input px-3 py-3 text-sm outline-none">
                  <option value="pending">Pending</option>
                  <option value="complete">Complete</option>
                  <option value="blocked">Blocked</option>
                </select></label>
                <label className="grid gap-2 text-sm text-[var(--copy-soft)]"><span>Assigned owner</span><input value={item.assignedOwner} onChange={(event) => setTitleChecklist((current) => current.map((entry) => entry.id === item.id ? { ...entry, assignedOwner: event.target.value } : entry))} className="brand-input px-3 py-3 text-sm outline-none" placeholder="Assigned owner" /></label>
                <label className="grid gap-2 text-sm text-[var(--copy-soft)]"><span>Due date</span><input type={!item.dueDate || /^\d{4}-\d{2}-\d{2}$/.test(item.dueDate) ? "date" : "text"} value={item.dueDate} onChange={(event) => setTitleChecklist((current) => current.map((entry) => entry.id === item.id ? { ...entry, dueDate: event.target.value } : entry))} className="brand-input px-3 py-3 text-sm outline-none" placeholder="Due date" /><span className="text-xs leading-5 text-[var(--copy-muted)]">Use YYYY-MM-DD. Record the date agreed for this transaction.</span></label>
              </div>
              <label className="grid gap-2 text-sm text-[var(--copy-soft)]"><span>Notes</span><textarea value={item.notes} onChange={(event) => setTitleChecklist((current) => current.map((entry) => entry.id === item.id ? { ...entry, notes: event.target.value } : entry))} className="brand-input mt-3 min-h-20 w-full px-3 py-3 text-sm outline-none" placeholder="Notes" /></label>
              <button type="button" onClick={() => void updateChecklistItem(titleChecklist.find((entry) => entry.id === item.id)!)} disabled={working === `title-${item.id}`} className="brand-button mt-3 inline-flex px-4 py-3 text-sm uppercase tracking-[0.18em] transition disabled:opacity-60">
                Save checklist item
              </button>
            </div>
          )) : <div className="brand-card p-4 text-sm text-[var(--copy-soft)]">No title checklist items available yet.</div>}
        </div>
      ) : null}

      {activeTab === "timeline" ? (
        <div className="space-y-4">
          {timeline.length ? timeline.map((event) => (
            <div key={event.id} className="brand-card p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-base font-semibold text-white">{event.label}</div>
                <StatusPill tone={event.status === "complete" ? "good" : event.status === "delayed" || event.status === "blocked" ? "warn" : "neutral"} label={event.status} />
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-3">
                <label className="grid gap-2 text-sm text-[var(--copy-soft)]"><span>Timeline status</span><select value={event.status} onChange={(e) => setTimeline((current) => current.map((entry) => entry.id === event.id ? { ...entry, status: e.target.value as DealClosingTimelineEventRecord["status"] } : entry))} className="brand-input px-3 py-3 text-sm outline-none">
                  <option value="upcoming">Upcoming</option>
                  <option value="complete">Complete</option>
                  <option value="delayed">Delayed</option>
                  <option value="blocked">Blocked</option>
                </select></label>
                <label className="grid gap-2 text-sm text-[var(--copy-soft)]"><span>Due date</span><input type={!event.dueDate || /^\d{4}-\d{2}-\d{2}$/.test(event.dueDate) ? "date" : "text"} value={event.dueDate} onChange={(e) => setTimeline((current) => current.map((entry) => entry.id === event.id ? { ...entry, dueDate: e.target.value } : entry))} className="brand-input px-3 py-3 text-sm outline-none" placeholder="Due date" /><span className="text-xs leading-5 text-[var(--copy-muted)]">Use YYYY-MM-DD. Record the date agreed for this transaction.</span></label>
                <label className="grid gap-2 text-sm text-[var(--copy-soft)]"><span>Completed at</span><input value={event.completedAt} onChange={(e) => setTimeline((current) => current.map((entry) => entry.id === event.id ? { ...entry, completedAt: e.target.value } : entry))} className="brand-input px-3 py-3 text-sm outline-none" placeholder="Completed at" /><span className="text-xs leading-5 text-[var(--copy-muted)]">Use an ISO date and time, for example 2026-10-08T15:00:00-04:00. Record actual receipt or completion.</span></label>
              </div>
              <label className="grid gap-2 text-sm text-[var(--copy-soft)]"><span>Notes</span><textarea value={event.notes} onChange={(e) => setTimeline((current) => current.map((entry) => entry.id === event.id ? { ...entry, notes: e.target.value } : entry))} className="brand-input mt-3 min-h-20 w-full px-3 py-3 text-sm outline-none" placeholder="Notes" /></label>
              <button type="button" onClick={() => void updateTimelineEvent(timeline.find((entry) => entry.id === event.id)!)} disabled={working === `timeline-${event.id}`} className="brand-button mt-3 inline-flex px-4 py-3 text-sm uppercase tracking-[0.18em] transition disabled:opacity-60">
                Save timeline event
              </button>
            </div>
          )) : <div className="brand-card p-4 text-sm text-[var(--copy-soft)]">No timeline events available yet.</div>}
        </div>
      ) : null}

      {activeTab === "documents" ? (
        <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
          <form onSubmit={uploadDocument} className="brand-card grid gap-3 p-4">
            <label className="grid gap-2 text-sm text-[var(--copy-soft)]"><span>Document category</span><select name="category" className="brand-input px-3 py-3 text-sm outline-none" defaultValue="purchase_agreement">
              <option value="purchase_agreement">Purchase agreement</option>
              <option value="assignment_agreement">Assignment agreement</option>
              <option value="addendum">Addendum</option>
              <option value="signed_contract">Signed contract</option>
              <option value="emd_receipt">EMD receipt</option>
              <option value="title_document">Title document</option>
              <option value="title_package">Title package</option>
              <option value="assignment_disclosure">Assignment disclosure</option>
              <option value="closing_statement">Closing statement</option>
              <option value="property_photo">Property photo</option>
              <option value="repair_estimate">Repair estimate</option>
              <option value="buyer_packet">Buyer packet</option>
              <option value="other">Other</option>
            </select></label>
            <label className="grid gap-2 text-sm text-[var(--copy-soft)]"><span>Uploaded by</span><input name="owner" className="brand-input px-3 py-3 text-sm outline-none" placeholder="Uploaded by" defaultValue="Blackspire operator" /></label>
            <label className="grid gap-2 text-sm text-[var(--copy-soft)]"><span>Document status</span><input name="status" className="brand-input px-3 py-3 text-sm outline-none" placeholder="Document status" defaultValue="Received" /></label>
            <label className="grid gap-2 text-sm text-[var(--copy-soft)]"><span>Source</span><input name="source" className="brand-input px-3 py-3 text-sm outline-none" placeholder="Source" defaultValue="internal" /></label>
            <label className="grid gap-2 text-sm text-[var(--copy-soft)]"><span>Notes</span><textarea name="notes" className="brand-input min-h-20 w-full px-3 py-3 text-sm outline-none" placeholder="Notes" /></label>
            <label className="grid gap-2 text-sm text-[var(--copy-soft)]"><span>Select document file</span><input type="file" name="file" className="brand-input px-3 py-3 text-sm outline-none" /></label>
            <button type="submit" disabled={working === "documents"} className="brand-button inline-flex px-4 py-3 text-sm uppercase tracking-[0.18em] transition disabled:opacity-60">
              {working === "documents" ? "Uploading..." : "Upload document"}
            </button>
          </form>
          <div className="space-y-4">
            {documents.length ? documents.map((document) => (
              <div key={document.id} className="brand-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-base font-semibold text-white">{document.fileName}</div>
                    <div className="mt-1 text-xs text-[var(--copy-muted)]">{document.category} / {document.uploadedBy}</div>
                  </div>
                  <a href={document.documentUrl} target="_blank" rel="noreferrer" className="brand-button inline-flex px-4 py-3 text-xs uppercase tracking-[0.16em] transition">
                    Preview / download
                  </a>
                </div>
                {document.notes ? <div className="mt-3 text-sm leading-6 text-[var(--copy-soft)]">{document.notes}</div> : null}
                <div className="mt-2 text-xs text-[var(--copy-muted)]">{new Date(document.uploadedAt).toLocaleString()}</div>
              </div>
            )) : <div className="brand-card p-4 text-sm text-[var(--copy-soft)]">No documents yet. Use the upload form to attach property or closing files.</div>}
          </div>
        </div>
      ) : null}

      {activeTab === "overview" ? (
        <div className="mt-5 grid gap-4 xl:grid-cols-2">
          <div className="brand-card p-4">
            <div className="text-[11px] uppercase tracking-[0.24em] text-[var(--copy-muted)]">Signature packet</div>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <label className="grid gap-2 text-sm text-[var(--copy-soft)]"><span>Signature provider</span><select value={signaturePacket.signatureProvider} onChange={(event) => setSignaturePacket({ ...signaturePacket, signatureProvider: event.target.value })} className="brand-input px-3 py-3 text-sm outline-none">
                <option value="">Select provider</option>
                {signaturePacket.availableProviders.map((provider) => <option key={provider} value={provider}>{provider}</option>)}
              </select></label>
              <label className="grid gap-2 text-sm text-[var(--copy-soft)]"><span>Signer email</span><input type="email" value={signaturePacket.signerEmail} onChange={(event) => setSignaturePacket({ ...signaturePacket, signerEmail: event.target.value })} className="brand-input px-3 py-3 text-sm outline-none" placeholder="Signer email" /></label>
              <label className="grid gap-2 text-sm text-[var(--copy-soft)]"><span>Signer role</span><input value={signaturePacket.signerRole} onChange={(event) => setSignaturePacket({ ...signaturePacket, signerRole: event.target.value })} className="brand-input px-3 py-3 text-sm outline-none" placeholder="Signer role" /></label>
              <label className="grid gap-2 text-sm text-[var(--copy-soft)]"><span>Signature packet URL</span><input value={signaturePacket.signaturePacketUrl} onChange={(event) => setSignaturePacket({ ...signaturePacket, signaturePacketUrl: event.target.value })} className="brand-input px-3 py-3 text-sm outline-none" placeholder="Signature packet URL" /><span className="text-xs leading-5 text-[var(--copy-muted)]">Link to the provider packet or supporting evidence; saving this link does not send it.</span></label>
            </div>
            <div className="mt-3 flex flex-wrap gap-3">
              <button type="button" onClick={() => void updateSignaturePacket(signaturePacket, true)} disabled={!canPrepareForSignature(templateValidation, contractDraft) || working === "signature"} className="brand-button inline-flex px-4 py-3 text-sm uppercase tracking-[0.18em] transition disabled:opacity-60">Prepare Signature Packet</button>
              <button type="button" onClick={() => void updateSignaturePacket({ signatureStatus: "sent", sentForSignatureAt: new Date().toISOString() })} disabled={working === "signature"} className="brand-button inline-flex px-4 py-3 text-sm uppercase tracking-[0.18em] transition disabled:opacity-60">Record actual send</button>
              <button type="button" onClick={() => void updateSignaturePacket({ signatureStatus: "seller_signed", signedBySellerAt: new Date().toISOString() })} disabled={working === "signature"} className="brand-button inline-flex px-4 py-3 text-sm uppercase tracking-[0.18em] transition disabled:opacity-60">Record seller signature</button>
              <button type="button" onClick={() => void updateSignaturePacket({ signatureStatus: "buyer_signed", signedByBuyerAt: new Date().toISOString() })} disabled={working === "signature"} className="brand-button inline-flex px-4 py-3 text-sm uppercase tracking-[0.18em] transition disabled:opacity-60">Record buyer signature</button>
            </div>
          </div>
          <div className="brand-card p-4">
            <div className="text-[11px] uppercase tracking-[0.24em] text-[var(--copy-muted)]">Closing checklist summary</div>
            <div className="mt-3 space-y-3 text-sm leading-6 text-[var(--copy-soft)]">
              <div>{titleChecklist.filter((item) => item.status === "complete").length} title checklist items complete.</div>
              <div>{timeline.filter((item) => item.status === "complete").length} timeline events marked complete.</div>
              <div>{documents.length} files in the transaction vault. Property uploads are listed separately in Documents; counts do not establish document completeness.</div>
              <div>{assignmentTracker.closingWarning ?? "No payout warning recorded. This does not confirm readiness to close."}</div>
            </div>
          </div>
        </div>
      ) : null}

      {status ? (
        <div role="status" aria-live="polite" className="workspace-feedback mt-5 text-sm">
          {status}
        </div>
      ) : null}
      </fieldset>
    </Panel>
  );
}
