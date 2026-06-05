"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Metric, Panel, StatusPill } from "@/components/buyer-shell";
import { DealEngineShell } from "@/components/deal-engine-shell";
import type { DealEngineDealDetail } from "@/lib/deal-engine-server";

function statusTone(status: string) {
  if (status === "Negotiating") return "warn";
  if (status === "Offer Ready" || status === "Under Contract") return "good";
  if (status === "Buyer Follow-Up") return "active";
  return "neutral";
}

function priorityTone(priority: string) {
  if (/high|urgent/i.test(priority)) return "warn";
  if (/complete|done/i.test(priority)) return "good";
  return "neutral";
}

export function DealEngineDealDetailView({
  dealId,
  detail,
}: {
  dealId: string;
  detail: DealEngineDealDetail;
}) {
  const router = useRouter();
  const [contractType, setContractType] = useState(
    detail.contractDraft?.contractType ?? "Assignable purchase agreement",
  );
  const [offerLow, setOfferLow] = useState(
    detail.contractDraft?.offerWindow.split(" - ")[0]?.replace(/[^0-9]/g, "") ?? "205000",
  );
  const [offerHigh, setOfferHigh] = useState(
    detail.contractDraft?.offerWindow.split(" - ")[1]?.replace(/[^0-9]/g, "") ?? "214000",
  );
  const [earnestMoney, setEarnestMoney] = useState(
    detail.contractDraft?.earnestMoney.replace(/[^0-9]/g, "") ?? "5000",
  );
  const [selectedBuyerSignalId, setSelectedBuyerSignalId] = useState(detail.buyerSignals[0]?.id ?? "");
  const [propertyNotes, setPropertyNotes] = useState(detail.packet.propertyNotes);
  const [investorSummary, setInvestorSummary] = useState(detail.packet.investorSummary);
  const [buyerEmailBlast, setBuyerEmailBlast] = useState(detail.packet.buyerEmailBlast);
  const [buyerSmsAlert, setBuyerSmsAlert] = useState(detail.packet.buyerSmsAlert);
  const [contactInstructions, setContactInstructions] = useState(detail.packet.contactInstructions);
  const [deadlineToSubmitOffer, setDeadlineToSubmitOffer] = useState(detail.packet.deadlineToSubmitOffer);
  const [comps, setComps] = useState(detail.packet.comps.join("\n"));
  const [stageStatus, setStageStatus] = useState(detail.lead.status);
  const [stageNextAction, setStageNextAction] = useState(detail.lead.nextAction);
  const [stageNote, setStageNote] = useState("");
  const [selectedInvestorEmail, setSelectedInvestorEmail] = useState(
    detail.investorResponses[0]?.investorEmail ?? "",
  );
  const [followUpStatus, setFollowUpStatus] = useState(
    detail.investorResponses[0]?.followUpStatus ?? "Response received",
  );
  const [followUpOwner, setFollowUpOwner] = useState(
    detail.investorResponses[0]?.followUpOwner ?? "Blackspire operator",
  );
  const [followUpNextStep, setFollowUpNextStep] = useState(
    detail.investorResponses[0]?.nextStep ?? "Reach out and confirm walkthrough or packet follow-up.",
  );
  const [followUpNotes, setFollowUpNotes] = useState(detail.investorResponses[0]?.notes ?? "");
  const [titleCompany, setTitleCompany] = useState(detail.coordination.titleCompany);
  const [titleOfficer, setTitleOfficer] = useState(detail.coordination.titleOfficer);
  const [walkthroughAt, setWalkthroughAt] = useState(detail.coordination.walkthroughAt);
  const [inspectionEndsOn, setInspectionEndsOn] = useState(detail.coordination.inspectionEndsOn);
  const [closingDate, setClosingDate] = useState(detail.coordination.closingDate);
  const [buyerAssignmentStatus, setBuyerAssignmentStatus] = useState(detail.coordination.buyerAssignmentStatus);
  const [earnestMoneyStatus, setEarnestMoneyStatus] = useState(detail.coordination.earnestMoneyStatus);
  const [payoutStatus, setPayoutStatus] = useState(detail.coordination.payoutStatus);
  const [contractSent, setContractSent] = useState(detail.coordination.contractSent);
  const [contractSigned, setContractSigned] = useState(detail.coordination.contractSigned);
  const [coordinationNotes, setCoordinationNotes] = useState(detail.coordination.coordinationNotes);
  const [taskId, setTaskId] = useState(detail.operatorTasks[0]?.id ?? "");
  const [taskTitle, setTaskTitle] = useState(detail.operatorTasks[0]?.title ?? "");
  const [taskOwner, setTaskOwner] = useState(detail.operatorTasks[0]?.owner ?? "Blackspire operator");
  const [taskDueDate, setTaskDueDate] = useState(detail.operatorTasks[0]?.dueDate ?? "");
  const [taskPriority, setTaskPriority] = useState(detail.operatorTasks[0]?.priority ?? "Normal");
  const [taskStatus, setTaskStatus] = useState(detail.operatorTasks[0]?.status ?? "Open");
  const [taskNotes, setTaskNotes] = useState(detail.operatorTasks[0]?.notes ?? "");
  const [status, setStatus] = useState<string | null>(null);
  const [working, setWorking] = useState<"buyer" | "contract" | "coordination" | "packet" | "response" | "stage" | "task" | null>(null);

  function syncInvestorFollowUp(email: string) {
    const investor = detail.investorResponses.find((item) => item.investorEmail === email);
    setSelectedInvestorEmail(email);
    if (!investor) return;
    setFollowUpStatus(investor.followUpStatus);
    setFollowUpOwner(investor.followUpOwner);
    setFollowUpNextStep(investor.nextStep);
    setFollowUpNotes(investor.notes);
  }

  function syncTask(selectedTaskId: string) {
    const task = detail.operatorTasks.find((item) => item.id === selectedTaskId);
    setTaskId(selectedTaskId);
    if (!task) return;
    setTaskTitle(task.title);
    setTaskOwner(task.owner);
    setTaskDueDate(task.dueDate);
    setTaskPriority(task.priority);
    setTaskStatus(task.status);
    setTaskNotes(task.notes);
  }

  async function saveContract(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setWorking("contract");
    setStatus(null);
    try {
      const response = await fetch("/api/deal-engine/save-contract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dealId,
          contractType,
          offerLow: Number(offerLow),
          offerHigh: Number(offerHigh),
          earnestMoney: Number(earnestMoney),
        }),
      });
      const payload = (await response.json()) as { error?: string; message?: string; ok?: boolean };
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? "Contract save failed.");
      setStatus(payload.message ?? "Contract posture saved.");
      router.refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Contract save failed.");
    } finally {
      setWorking(null);
    }
  }

  async function createBuyerDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setWorking("buyer");
    setStatus(null);
    try {
      const response = await fetch("/api/deal-engine/create-buyer-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dealId,
          buyerSignalId: selectedBuyerSignalId,
        }),
      });
      const payload = (await response.json()) as { error?: string; message?: string; ok?: boolean };
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? "Buyer draft failed.");
      setStatus(payload.message ?? "Buyer draft created.");
      router.refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Buyer draft failed.");
    } finally {
      setWorking(null);
    }
  }

  async function savePacket(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setWorking("packet");
    setStatus(null);
    try {
      const response = await fetch("/api/deal-engine/save-packet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dealId,
          propertyNotes,
          investorSummary,
          buyerEmailBlast,
          buyerSmsAlert,
          contactInstructions,
          deadlineToSubmitOffer,
          comps: comps.split("\n").map((item) => item.trim()).filter(Boolean),
        }),
      });
      const payload = (await response.json()) as { error?: string; message?: string; ok?: boolean };
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? "Packet save failed.");
      setStatus(payload.message ?? "Deal packet saved.");
      router.refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Packet save failed.");
    } finally {
      setWorking(null);
    }
  }

  async function saveStageUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setWorking("stage");
    setStatus(null);
    try {
      const response = await fetch("/api/deal-engine/update-stage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dealId,
          status: stageStatus,
          nextAction: stageNextAction,
          note: stageNote,
        }),
      });
      const payload = (await response.json()) as { error?: string; message?: string; ok?: boolean };
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? "Stage update failed.");
      setStatus(payload.message ?? "Deal stage updated.");
      setStageNote("");
      router.refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Stage update failed.");
    } finally {
      setWorking(null);
    }
  }

  async function saveInvestorResponse(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setWorking("response");
    setStatus(null);
    try {
      const response = await fetch("/api/deal-engine/investor-follow-up", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dealId,
          investorEmail: selectedInvestorEmail,
          followUpStatus,
          followUpOwner,
          nextStep: followUpNextStep,
          notes: followUpNotes,
        }),
      });
      const payload = (await response.json()) as { error?: string; message?: string; ok?: boolean };
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? "Investor follow-up failed.");
      setStatus(payload.message ?? "Investor follow-up saved.");
      router.refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Investor follow-up failed.");
    } finally {
      setWorking(null);
    }
  }

  async function saveTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setWorking("task");
    setStatus(null);
    try {
      const response = await fetch("/api/deal-engine/task", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dealId,
          taskId,
          title: taskTitle,
          owner: taskOwner,
          dueDate: taskDueDate,
          priority: taskPriority,
          status: taskStatus,
          notes: taskNotes,
        }),
      });
      const payload = (await response.json()) as { error?: string; message?: string; ok?: boolean; taskId?: string };
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? "Task save failed.");
      setStatus(payload.message ?? "Operator task saved.");
      setTaskId(payload.taskId ?? taskId);
      router.refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Task save failed.");
    } finally {
      setWorking(null);
    }
  }

  async function saveCoordination(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setWorking("coordination");
    setStatus(null);
    try {
      const response = await fetch("/api/deal-engine/coordination", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dealId,
          titleCompany,
          titleOfficer,
          walkthroughAt,
          inspectionEndsOn,
          closingDate,
          buyerAssignmentStatus,
          earnestMoneyStatus,
          payoutStatus,
          contractSent,
          contractSigned,
          coordinationNotes,
        }),
      });
      const payload = (await response.json()) as { error?: string; message?: string; ok?: boolean };
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? "Coordination save failed.");
      setStatus(payload.message ?? "Closing coordination saved.");
      router.refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Coordination save failed.");
    } finally {
      setWorking(null);
    }
  }

  return (
    <DealEngineShell>
      <header className="brand-panel overflow-hidden px-6 py-7">
        <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-5">
            <div>
              <p className="text-xs uppercase tracking-[0.42em] text-[var(--gold-soft)]">Deal Workstation</p>
              <h2 className="brand-display mt-3 text-4xl leading-tight text-white lg:text-5xl">
                {detail.lead.propertyAddress}
              </h2>
              <p className="mt-3 text-sm leading-7 text-[var(--copy-soft)]">
                {detail.lead.ownerName} / {detail.lead.county} County. This is the live workbench for underwriting posture, contract movement, buyer activation, and investor follow-up around deal {dealId}.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link href="/workspace/deal-engine" className="brand-button inline-flex px-5 py-4 text-sm uppercase tracking-[0.18em] transition">
                Back to command deck
              </Link>
              <Link href={`/workspace/deal-engine/${encodeURIComponent(dealId)}/packet`} className="brand-button inline-flex px-5 py-4 text-sm uppercase tracking-[0.18em] transition">
                Open packet view
              </Link>
              <a href={`/api/deal-engine/${encodeURIComponent(dealId)}/packet`} className="brand-button inline-flex px-5 py-4 text-sm uppercase tracking-[0.18em] transition">
                Download PDF packet
              </a>
              <Link href={`/deal-room/${encodeURIComponent(detail.room.slug)}`} className="brand-button inline-flex px-5 py-4 text-sm uppercase tracking-[0.18em] transition">
                Open external deal room
              </Link>
              <Link href="/seller-engine" className="brand-button inline-flex px-5 py-4 text-sm uppercase tracking-[0.18em] transition">
                Seller Engine
              </Link>
              <Link href="/workspace/buyer-engine" className="brand-button inline-flex px-5 py-4 text-sm uppercase tracking-[0.18em] transition">
                Buyer Engine
              </Link>
            </div>
          </div>

          <div className="grid gap-4 content-start">
            <div className="brand-card p-5">
              <div className="flex items-center justify-between gap-3">
                <div className="text-lg font-semibold text-white">Deal posture</div>
                <StatusPill tone={statusTone(detail.lead.status)} label={detail.lead.status.toLowerCase()} />
              </div>
              <div className="mt-4 space-y-3 text-sm text-[var(--copy-soft)]">
                <div>MAO: <span className="font-semibold text-white">{detail.lead.mao}</span></div>
                <div>Assignment target: <span className="font-semibold text-white">{detail.lead.assignmentFee}</span></div>
                <div>Exit strategy: <span className="font-semibold text-white">{detail.lead.exitStrategy}</span></div>
                <div>Next move: <span className="font-semibold text-white">{detail.lead.nextAction}</span></div>
              </div>
            </div>
          </div>
        </div>
      </header>

      <section className="grid gap-4 md:grid-cols-4">
        <Metric label="Motivation Score" value={String(detail.lead.motivationScore)} detail="Seller urgency and context from upstream intelligence" />
        <Metric label="Buyer Matches" value={String(detail.buyerSignals.length).padStart(2, "0")} detail="Relevant Buyer Engine signals for this county lane" />
        <Metric label="Open Tasks" value={String(detail.operatorTasks.length).padStart(2, "0")} detail="Internal execution items attached to this deal" />
        <Metric label="Investor Responses" value={String(detail.investorResponses.length).padStart(2, "0")} detail="Responses captured through the external deal room and ready for follow-up" />
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.08fr_0.92fr]">
        <Panel
          eyebrow="Seller Context"
          title="Acquisition brief"
          description="Everything the acquisitions side should carry from Seller Engine into the live conversation."
        >
          <div className="space-y-4">
            <div className="brand-card p-5">
              <div className="text-xs uppercase tracking-[0.24em] text-[var(--copy-muted)]">Current seller summary</div>
              <div className="mt-3 text-sm leading-7 text-[var(--copy-soft)]">
                {detail.sellerSignal?.summary ?? "Seller intelligence summary is not available yet."}
              </div>
            </div>
            <div className="brand-card p-5">
              <div className="text-xs uppercase tracking-[0.24em] text-[var(--copy-muted)]">Recommended handoff action</div>
              <div className="mt-3 text-sm leading-7 text-[var(--copy-soft)]">
                {detail.sellerSignal?.recommendedAction ?? detail.lead.nextAction}
              </div>
            </div>
          </div>
        </Panel>

        <Panel
          eyebrow="Stage Control"
          title="Move the deal through the pipeline"
          description="Update the active stage and next action so the command deck reflects what this deal needs now."
        >
          <form onSubmit={saveStageUpdate} className="grid gap-4">
            <select
              value={stageStatus}
              onChange={(event) => setStageStatus(event.target.value)}
              className="brand-input w-full px-3 py-3 text-sm outline-none"
            >
              {[
                "Needs Analysis",
                "Underwriting",
                "Negotiating",
                "Offer Ready",
                "Under Contract",
                "Contract / Packet",
                "Buyer Follow-Up",
                "Closed",
              ].map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            <textarea
              value={stageNextAction}
              onChange={(event) => setStageNextAction(event.target.value)}
              className="brand-input min-h-24 w-full px-3 py-3 text-sm outline-none"
              placeholder="Next action"
            />
            <textarea
              value={stageNote}
              onChange={(event) => setStageNote(event.target.value)}
              className="brand-input min-h-20 w-full px-3 py-3 text-sm outline-none"
              placeholder="Optional stage note"
            />
            <button type="submit" disabled={working === "stage"} className="brand-button inline-flex px-4 py-3 text-sm uppercase tracking-[0.18em] transition disabled:opacity-60">
              {working === "stage" ? "Saving stage..." : "Save pipeline stage"}
            </button>
          </form>
        </Panel>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.08fr_0.92fr]">
        <Panel
          eyebrow="Task Queue"
          title="Internal execution checklist"
          description="Keep the next internal moves attached to the deal so underwriting, acquisitions, and disposition all work from one queue."
        >
          <div className="space-y-4">
            {detail.operatorTasks.length ? (
              detail.operatorTasks.map((task) => (
                <button
                  key={task.id}
                  type="button"
                  onClick={() => syncTask(task.id)}
                  className="brand-card block w-full p-4 text-left transition hover:-translate-y-[1px] hover:border-[var(--line-strong)]"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-base font-semibold text-white">{task.title}</div>
                      <div className="mt-1 text-xs text-[var(--copy-muted)]">{task.owner} / due {task.dueDate || "TBD"}</div>
                    </div>
                    <div className="flex gap-2">
                      <StatusPill tone={priorityTone(task.priority)} label={task.priority.toLowerCase()} />
                      <StatusPill tone={statusTone(task.status)} label={task.status.toLowerCase()} />
                    </div>
                  </div>
                  <div className="mt-3 text-sm leading-6 text-[var(--copy-soft)]">{task.notes || "No task note added yet."}</div>
                </button>
              ))
            ) : (
              <div className="brand-card p-4 text-sm text-[var(--copy-soft)]">
                No internal tasks are attached to this deal yet.
              </div>
            )}
          </div>
        </Panel>

        <Panel
          eyebrow="Task Console"
          title="Create or update a deal task"
          description="Use this to assign underwriting asks, seller follow-ups, title coordination, or buyer-packet work without leaving the workstation."
        >
          <form onSubmit={saveTask} className="grid gap-4">
            <input value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} className="brand-input w-full px-3 py-3 text-sm outline-none" placeholder="Task title" />
            <div className="grid gap-3 md:grid-cols-2">
              <input value={taskOwner} onChange={(event) => setTaskOwner(event.target.value)} className="brand-input px-3 py-3 text-sm outline-none" placeholder="Task owner" />
              <input value={taskDueDate} onChange={(event) => setTaskDueDate(event.target.value)} className="brand-input px-3 py-3 text-sm outline-none" placeholder="Due date" />
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <input value={taskPriority} onChange={(event) => setTaskPriority(event.target.value)} className="brand-input px-3 py-3 text-sm outline-none" placeholder="Priority" />
              <input value={taskStatus} onChange={(event) => setTaskStatus(event.target.value)} className="brand-input px-3 py-3 text-sm outline-none" placeholder="Status" />
            </div>
            <textarea value={taskNotes} onChange={(event) => setTaskNotes(event.target.value)} className="brand-input min-h-24 w-full px-3 py-3 text-sm outline-none" placeholder="Task notes" />
            <button type="submit" disabled={!taskTitle.trim() || working === "task"} className="brand-button inline-flex px-4 py-3 text-sm uppercase tracking-[0.18em] transition disabled:opacity-60">
              {working === "task" ? "Saving task..." : "Save operator task"}
            </button>
          </form>
        </Panel>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.08fr_0.92fr]">
        <Panel
          eyebrow="Coordination"
          title="Title and close-table coordination"
          description="Run the post-contract lane here: title assignment, walkthrough timing, signatures, payout posture, and closing readiness."
        >
          <form onSubmit={saveCoordination} className="grid gap-4">
            <div className="grid gap-3 md:grid-cols-2">
              <input value={titleCompany} onChange={(event) => setTitleCompany(event.target.value)} className="brand-input px-3 py-3 text-sm outline-none" placeholder="Title company" />
              <input value={titleOfficer} onChange={(event) => setTitleOfficer(event.target.value)} className="brand-input px-3 py-3 text-sm outline-none" placeholder="Title officer / closer" />
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <input value={walkthroughAt} onChange={(event) => setWalkthroughAt(event.target.value)} className="brand-input px-3 py-3 text-sm outline-none" placeholder="Walkthrough date/time" />
              <input value={inspectionEndsOn} onChange={(event) => setInspectionEndsOn(event.target.value)} className="brand-input px-3 py-3 text-sm outline-none" placeholder="Inspection ends on" />
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <input value={closingDate} onChange={(event) => setClosingDate(event.target.value)} className="brand-input px-3 py-3 text-sm outline-none" placeholder="Closing date" />
              <input value={buyerAssignmentStatus} onChange={(event) => setBuyerAssignmentStatus(event.target.value)} className="brand-input px-3 py-3 text-sm outline-none" placeholder="Buyer assignment status" />
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <input value={earnestMoneyStatus} onChange={(event) => setEarnestMoneyStatus(event.target.value)} className="brand-input px-3 py-3 text-sm outline-none" placeholder="Earnest money status" />
              <input value={payoutStatus} onChange={(event) => setPayoutStatus(event.target.value)} className="brand-input px-3 py-3 text-sm outline-none" placeholder="Payout status" />
            </div>
            <div className="flex flex-wrap gap-6 text-sm text-[var(--copy-soft)]">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={contractSent} onChange={(event) => setContractSent(event.target.checked)} />
                <span>Contract sent</span>
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={contractSigned} onChange={(event) => setContractSigned(event.target.checked)} />
                <span>Contract signed</span>
              </label>
            </div>
            <textarea value={coordinationNotes} onChange={(event) => setCoordinationNotes(event.target.value)} className="brand-input min-h-24 w-full px-3 py-3 text-sm outline-none" placeholder="Coordination notes" />
            <button type="submit" disabled={working === "coordination"} className="brand-button inline-flex px-4 py-3 text-sm uppercase tracking-[0.18em] transition disabled:opacity-60">
              {working === "coordination" ? "Saving coordination..." : "Save closing coordination"}
            </button>
          </form>
        </Panel>

        <Panel
          eyebrow="Close Status"
          title="Current coordination posture"
          description="This is the live coordination snapshot for title, signatures, access, and payout readiness."
        >
          <div className="space-y-3 text-sm text-[var(--copy-soft)]">
            <div>Title company: <span className="font-semibold text-white">{detail.coordination.titleCompany}</span></div>
            <div>Title officer: <span className="font-semibold text-white">{detail.coordination.titleOfficer}</span></div>
            <div>Walkthrough: <span className="font-semibold text-white">{detail.coordination.walkthroughAt || "Not scheduled"}</span></div>
            <div>Inspection end: <span className="font-semibold text-white">{detail.coordination.inspectionEndsOn || "Not set"}</span></div>
            <div>Closing date: <span className="font-semibold text-white">{detail.coordination.closingDate || "Not set"}</span></div>
            <div>Assignment: <span className="font-semibold text-white">{detail.coordination.buyerAssignmentStatus}</span></div>
            <div>Earnest money: <span className="font-semibold text-white">{detail.coordination.earnestMoneyStatus}</span></div>
            <div>Payout: <span className="font-semibold text-white">{detail.coordination.payoutStatus}</span></div>
            <div className="flex gap-2 pt-2">
              <StatusPill tone={detail.coordination.contractSent ? "good" : "neutral"} label={detail.coordination.contractSent ? "contract sent" : "contract not sent"} />
              <StatusPill tone={detail.coordination.contractSigned ? "good" : "warn"} label={detail.coordination.contractSigned ? "signed" : "unsigned"} />
            </div>
          </div>
        </Panel>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.08fr_0.92fr]">
        <Panel
          eyebrow="Contract Console"
          title="Save underwriting and terms"
          description="Adjust the contract lane directly from the deal workstation and push the updated posture back into Deal Engine tables."
        >
          <form onSubmit={saveContract} className="grid gap-4">
            <input value={contractType} onChange={(event) => setContractType(event.target.value)} className="brand-input w-full px-3 py-3 text-sm outline-none" placeholder="Contract type" />
            <div className="grid gap-3 md:grid-cols-3">
              <input value={offerLow} onChange={(event) => setOfferLow(event.target.value)} className="brand-input px-3 py-3 text-sm outline-none" placeholder="Offer low" />
              <input value={offerHigh} onChange={(event) => setOfferHigh(event.target.value)} className="brand-input px-3 py-3 text-sm outline-none" placeholder="Offer high" />
              <input value={earnestMoney} onChange={(event) => setEarnestMoney(event.target.value)} className="brand-input px-3 py-3 text-sm outline-none" placeholder="Earnest money" />
            </div>
            <button type="submit" disabled={working === "contract"} className="brand-button inline-flex px-4 py-3 text-sm uppercase tracking-[0.18em] transition disabled:opacity-60">
              {working === "contract" ? "Saving..." : "Save contract posture"}
            </button>
          </form>
        </Panel>

        <Panel
          eyebrow="Investor Responses"
          title="Triage buyer interest from the external deal room"
          description="Every investor response captured from the public room can now be assigned an owner, next step, and follow-up status."
        >
          <div className="space-y-4">
            {detail.investorResponses.length ? (
              detail.investorResponses.map((response) => (
                <button
                  key={response.id}
                  type="button"
                  onClick={() => syncInvestorFollowUp(response.investorEmail)}
                  className="brand-card block w-full p-4 text-left transition hover:-translate-y-[1px] hover:border-[var(--line-strong)]"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-base font-semibold text-white">{response.investorName}</div>
                      <div className="mt-1 text-xs text-[var(--copy-muted)]">{response.investorEmail}</div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <StatusPill tone="good" label={response.interestType.toLowerCase()} />
                      <StatusPill tone="warn" label={response.followUpStatus.toLowerCase()} />
                    </div>
                  </div>
                  <div className="mt-3 text-sm leading-6 text-[var(--copy-soft)]">
                    {response.notes || "No investor note was submitted."}
                  </div>
                  <div className="mt-3 text-xs text-[var(--copy-muted)]">
                    Submitted {new Date(response.submittedAt).toLocaleString()} / owner {response.followUpOwner}
                  </div>
                  <div className="mt-2 text-sm leading-6 text-[var(--copy-soft)]">Next step: {response.nextStep}</div>
                </button>
              ))
            ) : (
              <div className="brand-card p-4 text-sm text-[var(--copy-soft)]">
                No investor responses have come in through the external deal room yet.
              </div>
            )}
          </div>
        </Panel>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.08fr_0.92fr]">
        <Panel
          eyebrow="Buyer Activation"
          title="Create and review investor drafts"
          description="Select a buyer signal from Buyer Engine, generate a disposition draft, and keep the artifact trail attached to this deal."
        >
          <form onSubmit={createBuyerDraft} className="grid gap-4">
            <select
              value={selectedBuyerSignalId}
              onChange={(event) => setSelectedBuyerSignalId(event.target.value)}
              className="brand-input w-full px-3 py-3 text-sm outline-none"
            >
              {detail.buyerSignals.map((signal) => (
                <option key={signal.id} value={signal.id}>
                  {signal.buyerName} / {signal.market} / {signal.propertyType}
                </option>
              ))}
            </select>
            <button type="submit" disabled={!selectedBuyerSignalId || working === "buyer"} className="brand-button inline-flex px-4 py-3 text-sm uppercase tracking-[0.18em] transition disabled:opacity-60">
              {working === "buyer" ? "Drafting..." : "Create buyer outreach draft"}
            </button>
          </form>

          <div className="mt-6 space-y-4">
            {detail.buyerSignals.map((signal) => (
              <div key={signal.id} className="brand-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-base font-semibold text-white">{signal.buyerName}</div>
                    <div className="mt-1 text-xs text-[var(--copy-muted)]">{signal.market} / {signal.propertyType}</div>
                  </div>
                  <div className="flex gap-2">
                    <StatusPill tone="good" label={`score ${signal.score}`} />
                    <StatusPill tone="warn" label={`${signal.purchaseCount} buys`} />
                  </div>
                </div>
                <div className="mt-3 text-sm leading-6 text-[var(--copy-soft)]">{signal.outreachAngle}</div>
              </div>
            ))}
          </div>
        </Panel>

        <Panel
          eyebrow="Follow-Up Console"
          title="Assign owner and next move"
          description="Use this form after an investor responds so the deal shifts from passive packet distribution into an active disposition workflow."
        >
          <form onSubmit={saveInvestorResponse} className="grid gap-4">
            <select
              value={selectedInvestorEmail}
              onChange={(event) => syncInvestorFollowUp(event.target.value)}
              className="brand-input w-full px-3 py-3 text-sm outline-none"
            >
              <option value="">Select investor response</option>
              {detail.investorResponses.map((response) => (
                <option key={response.id} value={response.investorEmail}>
                  {response.investorName} / {response.investorEmail}
                </option>
              ))}
            </select>
            <div className="grid gap-3 md:grid-cols-2">
              <input
                value={followUpStatus}
                onChange={(event) => setFollowUpStatus(event.target.value)}
                className="brand-input px-3 py-3 text-sm outline-none"
                placeholder="Follow-up status"
              />
              <input
                value={followUpOwner}
                onChange={(event) => setFollowUpOwner(event.target.value)}
                className="brand-input px-3 py-3 text-sm outline-none"
                placeholder="Follow-up owner"
              />
            </div>
            <textarea
              value={followUpNextStep}
              onChange={(event) => setFollowUpNextStep(event.target.value)}
              className="brand-input min-h-24 w-full px-3 py-3 text-sm outline-none"
              placeholder="Next step"
            />
            <textarea
              value={followUpNotes}
              onChange={(event) => setFollowUpNotes(event.target.value)}
              className="brand-input min-h-24 w-full px-3 py-3 text-sm outline-none"
              placeholder="Internal notes"
            />
            <button type="submit" disabled={!selectedInvestorEmail || working === "response"} className="brand-button inline-flex px-4 py-3 text-sm uppercase tracking-[0.18em] transition disabled:opacity-60">
              {working === "response" ? "Saving follow-up..." : "Save investor follow-up"}
            </button>
          </form>
        </Panel>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.08fr_0.92fr]">
        <Panel
          eyebrow="Draft Ledger"
          title="Saved outreach artifacts"
          description="These are the saved buyer drafts already tied to the same buyer-market lane as this deal."
        >
          <div className="space-y-4">
            {detail.relatedDrafts.length ? (
              detail.relatedDrafts.map((draft) => (
                <div key={draft.id} className="brand-card p-4">
                  <div className="text-base font-semibold text-white">{draft.buyerName}</div>
                  <div className="mt-1 text-xs text-[var(--copy-muted)]">{draft.subject}</div>
                  <div className="mt-1 text-xs text-[var(--copy-muted)]">{new Date(draft.createdAt).toLocaleString()}</div>
                  <div className="mt-3 text-sm leading-6 text-[var(--copy-soft)]">{draft.angle}</div>
                  <pre className="mt-3 whitespace-pre-wrap text-sm leading-6 text-[var(--copy-soft)]">{draft.body}</pre>
                </div>
              ))
            ) : (
              <div className="brand-card p-4 text-sm text-[var(--copy-soft)]">
                No saved buyer drafts are linked to this deal lane yet.
              </div>
            )}
          </div>
        </Panel>

        <Panel
          eyebrow="Activity"
          title="Live deal timeline"
          description="Every meaningful update to this deal now lands in one activity stream so the next operator can catch up fast."
        >
          <div className="space-y-4">
            {detail.activityFeed.length ? (
              detail.activityFeed.map((activity) => (
                <div key={activity.id} className="brand-card p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="text-base font-semibold text-white">{activity.title}</div>
                    <StatusPill tone={activity.tone} label={new Date(activity.timestamp).toLocaleDateString()} />
                  </div>
                  <div className="mt-2 text-sm leading-6 text-[var(--copy-soft)]">{activity.detail}</div>
                  <div className="mt-2 text-xs text-[var(--copy-muted)]">{new Date(activity.timestamp).toLocaleString()}</div>
                </div>
              ))
            ) : (
              <div className="brand-card p-4 text-sm text-[var(--copy-soft)]">
                No activity has been logged for this deal yet.
              </div>
            )}
          </div>
        </Panel>
      </div>

      <Panel
        eyebrow="Disposition Packet"
        title="Edit buyer-facing packet sections"
        description="Shape the comps, property notes, investor summary, and buyer-facing copy directly from this workstation."
      >
        <form onSubmit={savePacket} className="grid gap-6 xl:grid-cols-2">
          <div className="space-y-4">
            <textarea value={propertyNotes} onChange={(event) => setPropertyNotes(event.target.value)} className="brand-input min-h-32 w-full px-3 py-3 text-sm outline-none" placeholder="Property notes" />
            <textarea value={investorSummary} onChange={(event) => setInvestorSummary(event.target.value)} className="brand-input min-h-32 w-full px-3 py-3 text-sm outline-none" placeholder="Investor summary" />
            <textarea value={comps} onChange={(event) => setComps(event.target.value)} className="brand-input min-h-32 w-full px-3 py-3 text-sm outline-none" placeholder="One comp per line" />
          </div>
          <div className="space-y-4">
            <input value={deadlineToSubmitOffer} onChange={(event) => setDeadlineToSubmitOffer(event.target.value)} className="brand-input w-full px-3 py-3 text-sm outline-none" placeholder="Deadline to submit offer" />
            <textarea value={contactInstructions} onChange={(event) => setContactInstructions(event.target.value)} className="brand-input min-h-24 w-full px-3 py-3 text-sm outline-none" placeholder="Contact instructions" />
            <textarea value={buyerEmailBlast} onChange={(event) => setBuyerEmailBlast(event.target.value)} className="brand-input min-h-28 w-full px-3 py-3 text-sm outline-none" placeholder="Buyer email blast" />
            <textarea value={buyerSmsAlert} onChange={(event) => setBuyerSmsAlert(event.target.value)} className="brand-input min-h-24 w-full px-3 py-3 text-sm outline-none" placeholder="Buyer SMS alert" />
            <button type="submit" disabled={working === "packet"} className="brand-button inline-flex px-4 py-3 text-sm uppercase tracking-[0.18em] transition disabled:opacity-60">
              {working === "packet" ? "Saving packet..." : "Save disposition packet"}
            </button>
          </div>
        </form>
      </Panel>

      {status ? (
        <div className="rounded-[18px] border border-[var(--line)] bg-[hsl(0_0%_100%/.03)] px-4 py-3 text-sm text-[var(--copy-soft)]">
          {status}
        </div>
      ) : null}
    </DealEngineShell>
  );
}
