"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Metric, Panel, StatusPill } from "@/components/buyer-shell";
import { DealCommanderPanel } from "@/components/deal-commander-panel";
import { DealTransactionCommand } from "@/components/deal-transaction-command";
import { DealEngineShell } from "@/components/deal-engine-shell";
import type { DealCommanderInsight, DealEngineDealDetail, DealTransactionCenterSnapshot } from "@/lib/deal-engine-server";

type ChecklistItem = DealEngineDealDetail["coordination"]["closingChecklist"][number];
type ClosingDocument = DealEngineDealDetail["coordination"]["closingDocuments"][number];

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

function executionTone(status: string) {
  if (/answered|replied|interested|sent|delivered|scheduled|signed|won/i.test(status)) return "good";
  if (/follow|open|pending|left voicemail|no answer/i.test(status)) return "active";
  if (/failed|opt-out|dead|lost|blocked|dnc/i.test(status)) return "warn";
  return "neutral";
}

export function DealEngineDealDetailView({
  dealId,
  detail,
  commanderInsight,
  transactionCenter,
}: {
  dealId: string;
  detail: DealEngineDealDetail;
  commanderInsight: DealCommanderInsight | null;
  transactionCenter: DealTransactionCenterSnapshot | null;
}) {
  const router = useRouter();
  const [contractType, setContractType] = useState(
    detail.contractDraft?.contractType ?? "Assignable purchase agreement",
  );
  const [estimatedArv, setEstimatedArv] = useState(String(detail.underwriting.estimatedArv || ""));
  const [sellerAskingPrice, setSellerAskingPrice] = useState(String(detail.underwriting.sellerAskingPrice || ""));
  const [repairEstimate, setRepairEstimate] = useState(String(detail.underwriting.repairEstimate || ""));
  const [closingCosts, setClosingCosts] = useState(String(detail.underwriting.closingCosts || ""));
  const [holdingCosts, setHoldingCosts] = useState(String(detail.underwriting.holdingCosts || ""));
  const [buyerProfitTarget, setBuyerProfitTarget] = useState(String(detail.underwriting.buyerProfitTarget || ""));
  const [assignmentFeeTarget, setAssignmentFeeTarget] = useState(String(detail.underwriting.assignmentFeeTarget || ""));
  const [rentalEstimate, setRentalEstimate] = useState(String(detail.underwriting.rentalEstimate || ""));
  const [flipEstimate, setFlipEstimate] = useState(String(detail.underwriting.flipEstimate || ""));
  const [offerLow, setOfferLow] = useState(
    detail.contractDraft?.offerWindow.split(" - ")[0]?.replace(/[^0-9]/g, "") ?? "186000",
  );
  const [offerHigh, setOfferHigh] = useState(
    detail.contractDraft?.offerWindow.split(" - ")[1]?.replace(/[^0-9]/g, "") ?? "195000",
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
  const [closingChecklist, setClosingChecklist] = useState(detail.coordination.closingChecklist);
  const [closingDocuments, setClosingDocuments] = useState(detail.coordination.closingDocuments);
  const [taskId, setTaskId] = useState(detail.operatorTasks[0]?.id ?? "");
  const [taskTitle, setTaskTitle] = useState(detail.operatorTasks[0]?.title ?? "");
  const [taskOwner, setTaskOwner] = useState(detail.operatorTasks[0]?.owner ?? "Blackspire operator");
  const [taskDueDate, setTaskDueDate] = useState(detail.operatorTasks[0]?.dueDate ?? "");
  const [taskPriority, setTaskPriority] = useState(detail.operatorTasks[0]?.priority ?? "Normal");
  const [taskStatus, setTaskStatus] = useState(detail.operatorTasks[0]?.status ?? "Open");
  const [taskNotes, setTaskNotes] = useState(detail.operatorTasks[0]?.notes ?? "");
  const [sellerFirstTouchSms, setSellerFirstTouchSms] = useState(detail.sellerOutreach.firstTouchSms);
  const [sellerFollowUpSms, setSellerFollowUpSms] = useState(detail.sellerOutreach.followUpSms);
  const [sellerEmailSubject, setSellerEmailSubject] = useState(detail.sellerOutreach.emailSubject);
  const [sellerEmailBody, setSellerEmailBody] = useState(detail.sellerOutreach.emailBody);
  const [sellerObjectionReply, setSellerObjectionReply] = useState(detail.sellerOutreach.objectionReply);
  const [sellerVoicemailScript, setSellerVoicemailScript] = useState(detail.sellerOutreach.voicemailScript);
  const [sellerCallOpener, setSellerCallOpener] = useState(detail.sellerOutreach.callOpener);
  const [outreachAudience, setOutreachAudience] = useState<"seller" | "buyer">("seller");
  const [outreachChannel, setOutreachChannel] = useState("SMS");
  const [outreachRecipient, setOutreachRecipient] = useState(detail.sellerContact.ownerName);
  const [outreachStatus, setOutreachStatus] = useState("Sent");
  const [outreachOutcome, setOutreachOutcome] = useState("");
  const [outreachNextStep, setOutreachNextStep] = useState("Await response and schedule the next follow-up if needed.");
  const [outreachNotes, setOutreachNotes] = useState("");
  const [closeoutOutcome, setCloseoutOutcome] = useState(detail.closeout?.outcome ?? "Closed Won");
  const [closeoutDate, setCloseoutDate] = useState(detail.closeout?.closedAt ?? "");
  const [closeoutFee, setCloseoutFee] = useState(String(detail.closeout?.assignmentFeeCollected ?? ""));
  const [closeoutBuyerName, setCloseoutBuyerName] = useState(detail.closeout?.buyerName ?? "");
  const [closeoutNotes, setCloseoutNotes] = useState(detail.closeout?.notes ?? "");
  const [documentCategory, setDocumentCategory] = useState("Signed Contract");
  const [documentStatus, setDocumentStatus] = useState("Received");
  const [documentOwner, setDocumentOwner] = useState("Blackspire operator");
  const [documentNotes, setDocumentNotes] = useState("");
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [emailAudience, setEmailAudience] = useState("seller");
  const [emailTo, setEmailTo] = useState("");
  const [emailSubject, setEmailSubject] = useState(detail.sellerOutreach.emailSubject);
  const [emailBody, setEmailBody] = useState(detail.sellerOutreach.emailBody);
  const [arvEstimateHint, setArvEstimateHint] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [working, setWorking] = useState<"analysis" | "buyer" | "contract" | "coordination" | "execute" | "packet" | "response" | "search" | "seller-draft" | "stage" | "task" | "outreach" | "closeout" | "document" | "email" | "arv" | null>(null);

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

  function updateChecklistItem(id: string, field: keyof ChecklistItem, value: string) {
    setClosingChecklist((items) =>
      items.map((item) => (item.id === id ? { ...item, [field]: value } : item)),
    );
  }

  function updateClosingDocument(id: string, field: keyof ClosingDocument, value: string) {
    setClosingDocuments((items) =>
      items.map((item) => (item.id === id ? { ...item, [field]: value } : item)),
    );
  }

  function addChecklistItem() {
    setClosingChecklist((items) => [
      ...items,
      {
        id: `checklist-${Date.now()}`,
        title: "",
        status: "Open",
        owner: "Unassigned",
        dueDate: "",
      },
    ]);
  }

  function addClosingDocument() {
    setClosingDocuments((items) => [
      ...items,
      {
        id: `document-${Date.now()}`,
        name: "",
        status: "Requested",
        owner: "Unassigned",
        notes: "",
      },
    ]);
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

  async function saveAnalysis(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setWorking("analysis");
    setStatus(null);
    try {
      const response = await fetch("/api/deal-engine/save-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dealId,
          estimatedArv: Number(estimatedArv),
          sellerAskingPrice: Number(sellerAskingPrice),
          repairEstimate: Number(repairEstimate),
          closingCosts: Number(closingCosts),
          holdingCosts: Number(holdingCosts),
          buyerProfitTarget: Number(buyerProfitTarget),
          assignmentFeeTarget: Number(assignmentFeeTarget),
          rentalEstimate: Number(rentalEstimate),
          flipEstimate: Number(flipEstimate),
        }),
      });
      const payload = (await response.json()) as { error?: string; message?: string; ok?: boolean; underwriting?: { maximumAllowableOffer?: number; assignmentFeeTarget?: number } };
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? "Underwriting save failed.");
      if (payload.underwriting?.maximumAllowableOffer != null) {
        setOfferHigh(String(payload.underwriting.maximumAllowableOffer));
        setOfferLow(String(Math.max(payload.underwriting.maximumAllowableOffer - Math.max((payload.underwriting.assignmentFeeTarget ?? 0) / 2, 5000), 0)));
      }
      setStatus(payload.message ?? "Underwriting saved.");
      router.refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Underwriting save failed.");
    } finally {
      setWorking(null);
    }
  }

  async function estimateArv() {
    setWorking("arv");
    setStatus(null);
    setArvEstimateHint(null);
    try {
      const response = await fetch("/api/deal-engine/estimate-arv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dealId }),
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
        message?: string;
        estimatedArv?: number;
        arvRange?: string;
        confidence?: string;
        basis?: string;
        underwriting?: { maximumAllowableOffer?: number; assignmentFeeTarget?: number };
      };
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? "ARV estimate failed.");
      if (payload.estimatedArv != null) {
        setEstimatedArv(String(payload.estimatedArv));
      }
      if (payload.underwriting?.maximumAllowableOffer != null) {
        setOfferHigh(String(payload.underwriting.maximumAllowableOffer));
        setOfferLow(String(Math.max(payload.underwriting.maximumAllowableOffer - Math.max((payload.underwriting.assignmentFeeTarget ?? 0) / 2, 5000), 0)));
      }
      setArvEstimateHint(
        [payload.arvRange ? `Range ${payload.arvRange}` : "", payload.confidence ? `confidence ${payload.confidence}` : "", payload.basis ?? ""]
          .filter(Boolean)
          .join(" / "),
      );
      setStatus(payload.message ?? "ARV estimated.");
      router.refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "ARV estimate failed.");
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

  async function launchBuyerSearch() {
    setWorking("search");
    setStatus(null);
    try {
      const response = await fetch("/api/deal-engine/launch-buyer-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dealId }),
      });
      const payload = (await response.json()) as { error?: string; message?: string; ok?: boolean; job?: { id?: string } };
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? "Buyer search launch failed.");
      setStatus(payload.message ?? `Buyer search ${payload.job?.id ?? ""} launched.`.trim());
      router.refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Buyer search launch failed.");
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
          closingChecklist,
          closingDocuments,
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

  async function saveSellerDraft(kind: string, title: string, body: string) {
    setWorking("seller-draft");
    setStatus(null);
    try {
      const response = await fetch("/api/deal-engine/save-seller-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dealId, kind, title, body }),
      });
      const payload = (await response.json()) as { error?: string; message?: string; ok?: boolean };
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? "Seller draft save failed.");
      setStatus(payload.message ?? "Seller draft saved.");
      router.refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Seller draft save failed.");
    } finally {
      setWorking(null);
    }
  }

  async function logOutreachExecution(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setWorking("outreach");
    setStatus(null);
    try {
      const response = await fetch("/api/deal-engine/log-outreach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dealId,
          audience: outreachAudience,
          channel: outreachChannel,
          recipient: outreachRecipient,
          status: outreachStatus,
          outcome: outreachOutcome,
          nextStep: outreachNextStep,
          notes: outreachNotes,
        }),
      });
      const payload = (await response.json()) as { error?: string; message?: string; ok?: boolean };
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? "Outreach execution log failed.");
      setStatus(payload.message ?? "Outreach execution logged.");
      setOutreachOutcome("");
      setOutreachNotes("");
      router.refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Outreach execution log failed.");
    } finally {
      setWorking(null);
    }
  }

  async function saveCloseout(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setWorking("closeout");
    setStatus(null);
    try {
      const response = await fetch("/api/deal-engine/closeout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dealId,
          outcome: closeoutOutcome,
          closedAt: closeoutDate,
          assignmentFeeCollected: Number(closeoutFee),
          buyerName: closeoutBuyerName,
          notes: closeoutNotes,
        }),
      });
      const payload = (await response.json()) as { error?: string; message?: string; ok?: boolean };
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? "Deal closeout failed.");
      setStageStatus("Closed");
      setStatus(payload.message ?? "Deal closeout recorded.");
      router.refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Deal closeout failed.");
    } finally {
      setWorking(null);
    }
  }

  async function uploadDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!documentFile) {
      setStatus("Choose a file before uploading.");
      return;
    }

    setWorking("document");
    setStatus(null);
    try {
      const payload = new FormData();
      payload.set("dealId", dealId);
      payload.set("category", documentCategory);
      payload.set("status", documentStatus);
      payload.set("owner", documentOwner);
      payload.set("notes", documentNotes);
      payload.set("source", "internal");
      payload.set("file", documentFile);
      const response = await fetch("/api/deal-engine/upload-document", { method: "POST", body: payload });
      const body = (await response.json()) as { ok?: boolean; error?: string; message?: string };
      if (!response.ok || !body.ok) throw new Error(body.error ?? "Document upload failed.");
      setStatus(body.message ?? "Document uploaded.");
      setDocumentNotes("");
      setDocumentFile(null);
      router.refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Document upload failed.");
    } finally {
      setWorking(null);
    }
  }

  async function sendEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setWorking("email");
    setStatus(null);
    try {
      const response = await fetch("/api/deal-engine/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dealId,
          to: emailTo,
          subject: emailSubject,
          body: emailBody,
          audience: emailAudience,
        }),
      });
      const body = (await response.json()) as { ok?: boolean; error?: string; message?: string };
      if (!response.ok || !body.ok) throw new Error(body.error ?? "Email send failed.");
      setStatus(body.message ?? "Email sent.");
      router.refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Email send failed.");
    } finally {
      setWorking(null);
    }
  }

  function packetPayload() {
    return {
      dealId,
      propertyNotes,
      investorSummary,
      buyerEmailBlast,
      buyerSmsAlert,
      contactInstructions,
      deadlineToSubmitOffer,
      comps: comps.split("\n").map((item) => item.trim()).filter(Boolean),
    };
  }

  function coordinationPayload(overrides: Partial<DealEngineDealDetail["coordination"]> = {}) {
    return {
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
      closingChecklist,
      closingDocuments,
      ...overrides,
    };
  }

  async function postJson(url: string, body: Record<string, unknown>, fallbackMessage: string) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = (await response.json()) as { error?: string; message?: string; ok?: boolean };
    if (!response.ok || !payload.ok) throw new Error(payload.error ?? fallbackMessage);
    return payload.message ?? fallbackMessage;
  }

  async function executeDealCommand(command: "send-contract" | "mark-signed" | "save-packet" | "buyer-draft" | "move-closing") {
    setWorking("execute");
    setStatus(null);
    try {
      if (command === "send-contract") {
        await postJson(
          "/api/deal-engine/coordination",
          coordinationPayload({ contractSent: true }),
          "Contract marked as sent.",
        );
        setContractSent(true);
        setStatus("Contract marked as sent. Next: collect seller signature and confirm title cadence.");
      }

      if (command === "mark-signed") {
        await postJson(
          "/api/deal-engine/coordination",
          coordinationPayload({ contractSent: true, contractSigned: true }),
          "Contract marked as signed.",
        );
        await postJson(
          "/api/deal-engine/update-stage",
          {
            dealId,
            status: "Under Contract",
            nextAction: "Build buyer packet, launch buyer outreach, and coordinate walkthrough access.",
            note: "Operator marked contract signed from the execution command band.",
          },
          "Deal moved under contract.",
        );
        setContractSent(true);
        setContractSigned(true);
        setStageStatus("Under Contract");
        setStageNextAction("Build buyer packet, launch buyer outreach, and coordinate walkthrough access.");
        setStatus("Deal is now marked under contract. Next: save packet and activate buyer outreach.");
      }

      if (command === "save-packet") {
        await postJson("/api/deal-engine/save-packet", packetPayload(), "Deal packet saved.");
        setStatus("Disposition packet saved. Next: open the investor room or download the PDF packet.");
      }

      if (command === "buyer-draft") {
        await postJson(
          "/api/deal-engine/create-buyer-draft",
          { dealId, buyerSignalId: selectedBuyerSignalId },
          "Buyer outreach draft created.",
        );
        setStatus("Buyer outreach draft created. Next: review the draft ledger and send through your approved outreach lane.");
      }

      if (command === "move-closing") {
        await postJson(
          "/api/deal-engine/update-stage",
          {
            dealId,
            status: "Closing",
            nextAction: "Complete title, EMD, assignment, final docs, and payout coordination.",
            note: "Operator moved the deal into closing from the execution command band.",
          },
          "Deal moved into closing.",
        );
        setStageStatus("Closing");
        setStageNextAction("Complete title, EMD, assignment, final docs, and payout coordination.");
        setStatus("Deal moved into closing. Next: finish checklist, documents, EMD, assignment, and payout posture.");
      }

      router.refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Deal execution action failed.");
    } finally {
      setWorking(null);
    }
  }

  const contactReady = detail.sellerContact.ownerPhone !== "Not captured" || detail.sellerContact.phoneStatus !== "Skip Trace Needed";
  const contractReady = contractSent && contractSigned;
  const packetReady = Boolean(investorSummary.trim() && buyerEmailBlast.trim() && comps.trim());
  const buyerReady = detail.buyerSignals.length > 0;
  const coordinationReady =
    closingChecklist.length > 0 &&
    closingChecklist.every((item) => item.status === "Done") &&
    closingDocuments.length > 0 &&
    closingDocuments.every((item) => item.status === "Final" || item.status === "Reviewed");
  const executionSteps = [
    { label: "Contact", ready: contactReady, detail: contactReady ? "seller lane ready" : "run Nexus / verify phone" },
    { label: "Contract", ready: contractReady, detail: contractReady ? "signed posture saved" : contractSent ? "sent, awaiting signature" : "send contract" },
    { label: "Packet", ready: packetReady, detail: packetReady ? "buyer packet ready" : "complete buyer-facing copy" },
    { label: "Buyer", ready: buyerReady, detail: buyerReady ? `${detail.buyerSignals.length} buyer signal(s)` : "run Buyer Engine" },
    { label: "Close", ready: coordinationReady, detail: coordinationReady ? "closing board complete" : "finish title/docs/checklist" },
  ];

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
              <a href={`/api/deal-engine/${encodeURIComponent(dealId)}/contract`} className="brand-button inline-flex px-5 py-4 text-sm uppercase tracking-[0.18em] transition">
                Open contract draft
              </a>
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

      <DealCommanderPanel dealId={dealId} initialInsight={commanderInsight} />
      <DealTransactionCommand dealId={dealId} initialSnapshot={transactionCenter} />

      <div className="grid gap-6 xl:grid-cols-[1.08fr_0.92fr]">
        <Panel
          eyebrow="Automation Workflow"
          title="Future-deal automation path"
          description="This board shows the exact sequence we want every deal to follow so future automation can move records forward without guesswork."
        >
          <div className="space-y-3">
            {detail.automationWorkflow.map((step) => (
              <div key={step.id} className="brand-card p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="text-base font-semibold text-white">{step.title}</div>
                  <StatusPill tone={step.status === "blocked" ? "warn" : step.status === "active" ? "active" : "good"} label={step.status} />
                </div>
                <div className="mt-3 text-sm leading-6 text-[var(--copy-soft)]">{step.detail}</div>
              </div>
            ))}
          </div>
        </Panel>

        <Panel
          eyebrow="Underwriting Status"
          title="Current underwriting posture"
          description="This is the live financial snapshot behind the contract lane. When key inputs are missing, the workflow should stop here instead of guessing."
        >
          <div className="space-y-3 text-sm text-[var(--copy-soft)]">
            <div>ARV: <span className="font-semibold text-white">{detail.underwriting.estimatedArv ? `$${detail.underwriting.estimatedArv.toLocaleString()}` : "Not set"}</span></div>
            <div>Seller ask: <span className="font-semibold text-white">{detail.underwriting.sellerAskingPrice ? `$${detail.underwriting.sellerAskingPrice.toLocaleString()}` : "Not set"}</span></div>
            <div>Repairs: <span className="font-semibold text-white">{detail.underwriting.repairEstimate ? `$${detail.underwriting.repairEstimate.toLocaleString()}` : "Not set"}</span></div>
            <div>MAO: <span className="font-semibold text-white">{detail.underwriting.maximumAllowableOffer ? `$${detail.underwriting.maximumAllowableOffer.toLocaleString()}` : "Not ready"}</span></div>
            <div>Spread: <span className="font-semibold text-white">{detail.underwriting.wholesaleSpread ? `$${detail.underwriting.wholesaleSpread.toLocaleString()}` : "Not ready"}</span></div>
            <div className="flex gap-2 pt-2">
              <StatusPill tone={detail.underwriting.readyForContract ? "good" : "warn"} label={detail.underwriting.dealRating.toLowerCase()} />
              <StatusPill tone={detail.underwriting.readyForContract ? "good" : "active"} label={detail.underwriting.readyForContract ? "contract-ready" : "needs-inputs"} />
            </div>
            {detail.underwriting.missingInputs.length ? (
              <div className="pt-3">
                <div className="text-xs uppercase tracking-[0.24em] text-[var(--copy-muted)]">Missing inputs</div>
                <div className="mt-2 space-y-2">
                  {detail.underwriting.missingInputs.map((item) => (
                    <div key={item} className="rounded-[14px] border border-[var(--line)] px-3 py-3 text-sm text-[var(--copy-soft)]">
                      {item}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </Panel>

        <Panel
          eyebrow="Compliance Lane"
          title="Wholesale guardrails attached to underwriting"
          description="These rules now travel with the deal so underwriting and contract drafting stay inside the wholesale structure instead of drifting into risky language."
        >
          <div className="space-y-3 text-sm text-[var(--copy-soft)]">
            <div>Strategy: <span className="font-semibold text-white">{detail.underwriting.compliance.strategy}</span></div>
            <div>Disclosure: <span className="font-semibold text-white">{detail.underwriting.compliance.disclosureHeadline}</span></div>
            <div>Marketing rule: <span className="font-semibold text-white">{detail.underwriting.compliance.marketingRule}</span></div>
            <div>Earnest money: <span className="font-semibold text-white">{detail.underwriting.compliance.earnestMoneyRule}</span></div>
            <div>Cancellation review: <span className="font-semibold text-white">{detail.underwriting.compliance.cancellationRule}</span></div>
            <div>Licensing review: <span className="font-semibold text-white">{detail.underwriting.compliance.licenseNote}</span></div>
            <div className="pt-3">
              <div className="text-xs uppercase tracking-[0.24em] text-[var(--copy-muted)]">Contract warnings</div>
              <div className="mt-2 space-y-2">
                {detail.underwriting.compliance.contractWarnings.map((item) => (
                  <div key={item} className="rounded-[14px] border border-[var(--line)] px-3 py-3 text-sm text-[var(--copy-soft)]">
                    {item}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Panel>
      </div>

      <Panel
        eyebrow="Execute Deal"
        title="One command band for the next deal move"
        description="Use these controls to move the deal forward from inside the workstation. Detailed editing panels stay below when the operator needs to fine-tune the packet, contract, coordination, or buyer follow-up."
      >
        <div className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
          <div className="brand-card p-5">
            <div className="text-sm font-semibold text-white">Readiness path</div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {executionSteps.map((step) => (
                <div key={step.label} className="rounded-[14px] border border-[var(--line)] px-3 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-semibold text-white">{step.label}</div>
                    <StatusPill tone={step.ready ? "good" : "warn"} label={step.ready ? "ready" : "needs work"} />
                  </div>
                  <div className="mt-2 text-xs leading-5 text-[var(--copy-soft)]">{step.detail}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="brand-card p-5">
            <div className="text-sm font-semibold text-white">Fast actions</div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <button type="button" onClick={() => void executeDealCommand("send-contract")} disabled={working === "execute"} className="brand-button justify-center px-4 py-3 text-sm uppercase tracking-[0.16em] transition disabled:opacity-60">
                Mark contract sent
              </button>
              <button type="button" onClick={() => void executeDealCommand("mark-signed")} disabled={working === "execute"} className="brand-button justify-center px-4 py-3 text-sm uppercase tracking-[0.16em] transition disabled:opacity-60">
                Mark signed / under contract
              </button>
              <button type="button" onClick={() => void executeDealCommand("save-packet")} disabled={working === "execute"} className="brand-button justify-center px-4 py-3 text-sm uppercase tracking-[0.16em] transition disabled:opacity-60">
                Save buyer packet
              </button>
              <button type="button" onClick={() => void launchBuyerSearch()} disabled={working === "search"} className="brand-button justify-center px-4 py-3 text-sm uppercase tracking-[0.16em] transition disabled:opacity-60">
                {working === "search" ? "Launching buyer search..." : "Launch buyer search"}
              </button>
              <button type="button" onClick={() => void executeDealCommand("buyer-draft")} disabled={working === "execute" || !selectedBuyerSignalId} className="brand-button justify-center px-4 py-3 text-sm uppercase tracking-[0.16em] transition disabled:opacity-60">
                Generate buyer draft
              </button>
              <button type="button" onClick={() => void executeDealCommand("move-closing")} disabled={working === "execute"} className="brand-button justify-center px-4 py-3 text-sm uppercase tracking-[0.16em] transition disabled:opacity-60">
                Move into closing
              </button>
              <Link href={`/deal-room/${encodeURIComponent(detail.room.slug)}`} className="brand-button justify-center px-4 py-3 text-sm uppercase tracking-[0.16em] transition">
                Open investor room
              </Link>
            </div>
            <div className="mt-4 text-xs leading-5 text-[var(--copy-muted)]">
              {working === "execute" ? "Executing deal action..." : "Fast actions write to the same APIs as the full forms below."}
            </div>
          </div>
        </div>
      </Panel>

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
            <div className="brand-card p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-xs uppercase tracking-[0.24em] text-[var(--copy-muted)]">Seller contact posture</div>
                <StatusPill
                  tone={detail.sellerContact.ownerPhone === "Not captured" ? "warn" : "good"}
                  label={detail.sellerContact.phoneStatus.toLowerCase()}
                />
              </div>
              <div className="mt-4 space-y-2 text-sm text-[var(--copy-soft)]">
                <div>Seller: <span className="font-semibold text-white">{detail.sellerContact.ownerName}</span></div>
                <div>Phone: <span className="font-semibold text-white">{detail.sellerContact.ownerPhone}</span></div>
                <div>Skip trace: <span className="font-semibold text-white">{detail.sellerContact.skipTraceStatus}</span></div>
                <div>Source: <span className="font-semibold text-white">{detail.sellerContact.phoneSource}</span></div>
              </div>
              <div className="mt-4 text-sm leading-7 text-[var(--copy-soft)]">
                {detail.sellerContact.contactEnrichmentNotes}
              </div>
            </div>
            <div className="brand-card p-5">
              <div className="text-xs uppercase tracking-[0.24em] text-[var(--copy-muted)]">Skip trace workflow</div>
              <div className="mt-4 space-y-3">
                {detail.sellerContactWorkflow.map((step) => (
                  <div key={step.id} className="rounded-[14px] border border-[var(--line)] px-3 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-sm font-semibold text-white">{step.title}</div>
                      <StatusPill tone={step.status === "blocked" ? "warn" : step.status === "active" ? "active" : "good"} label={step.status} />
                    </div>
                    <div className="mt-2 text-sm leading-6 text-[var(--copy-soft)]">{step.detail}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Panel>

        <Panel
          eyebrow="Seller Outreach"
          title="Draft seller-side messages"
          description="These scripts are shaped from the live seller summary, contact posture, and negotiation lane for this exact deal."
        >
          <div className="space-y-4">
            <div className="brand-card p-5">
              <div className="text-xs uppercase tracking-[0.24em] text-[var(--copy-muted)]">First-touch SMS</div>
              <textarea value={sellerFirstTouchSms} onChange={(event) => setSellerFirstTouchSms(event.target.value)} className="brand-input mt-3 min-h-28 w-full px-3 py-3 text-sm outline-none" />
              <button type="button" onClick={() => void saveSellerDraft("First-touch SMS", `${detail.sellerContact.ownerName} first-touch SMS`, sellerFirstTouchSms)} disabled={working === "seller-draft"} className="brand-button mt-3 inline-flex px-4 py-3 text-sm uppercase tracking-[0.18em] transition disabled:opacity-60">
                Save seller draft
              </button>
            </div>
            <div className="brand-card p-5">
              <div className="text-xs uppercase tracking-[0.24em] text-[var(--copy-muted)]">Follow-up SMS</div>
              <textarea value={sellerFollowUpSms} onChange={(event) => setSellerFollowUpSms(event.target.value)} className="brand-input mt-3 min-h-28 w-full px-3 py-3 text-sm outline-none" />
              <button type="button" onClick={() => void saveSellerDraft("Follow-up SMS", `${detail.sellerContact.ownerName} follow-up SMS`, sellerFollowUpSms)} disabled={working === "seller-draft"} className="brand-button mt-3 inline-flex px-4 py-3 text-sm uppercase tracking-[0.18em] transition disabled:opacity-60">
                Save seller draft
              </button>
            </div>
            <div className="brand-card p-5">
              <div className="text-xs uppercase tracking-[0.24em] text-[var(--copy-muted)]">Email draft</div>
              <input value={sellerEmailSubject} onChange={(event) => setSellerEmailSubject(event.target.value)} className="brand-input mt-3 w-full px-3 py-3 text-sm outline-none" />
              <textarea value={sellerEmailBody} onChange={(event) => setSellerEmailBody(event.target.value)} className="brand-input mt-3 min-h-32 w-full px-3 py-3 text-sm outline-none" />
              <button type="button" onClick={() => void saveSellerDraft("Seller Email", sellerEmailSubject, sellerEmailBody)} disabled={working === "seller-draft"} className="brand-button mt-3 inline-flex px-4 py-3 text-sm uppercase tracking-[0.18em] transition disabled:opacity-60">
                Save seller draft
              </button>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="brand-card p-5">
                <div className="text-xs uppercase tracking-[0.24em] text-[var(--copy-muted)]">Call opener</div>
                <textarea value={sellerCallOpener} onChange={(event) => setSellerCallOpener(event.target.value)} className="brand-input mt-3 min-h-24 w-full px-3 py-3 text-sm outline-none" />
                <button type="button" onClick={() => void saveSellerDraft("Call Opener", `${detail.sellerContact.ownerName} call opener`, sellerCallOpener)} disabled={working === "seller-draft"} className="brand-button mt-3 inline-flex px-4 py-3 text-sm uppercase tracking-[0.18em] transition disabled:opacity-60">
                  Save seller draft
                </button>
              </div>
              <div className="brand-card p-5">
                <div className="text-xs uppercase tracking-[0.24em] text-[var(--copy-muted)]">Voicemail script</div>
                <textarea value={sellerVoicemailScript} onChange={(event) => setSellerVoicemailScript(event.target.value)} className="brand-input mt-3 min-h-24 w-full px-3 py-3 text-sm outline-none" />
                <button type="button" onClick={() => void saveSellerDraft("Voicemail Script", `${detail.sellerContact.ownerName} voicemail`, sellerVoicemailScript)} disabled={working === "seller-draft"} className="brand-button mt-3 inline-flex px-4 py-3 text-sm uppercase tracking-[0.18em] transition disabled:opacity-60">
                  Save seller draft
                </button>
              </div>
            </div>
            <div className="brand-card p-5">
              <div className="text-xs uppercase tracking-[0.24em] text-[var(--copy-muted)]">Objection-handling reply</div>
              <textarea value={sellerObjectionReply} onChange={(event) => setSellerObjectionReply(event.target.value)} className="brand-input mt-3 min-h-28 w-full px-3 py-3 text-sm outline-none" />
              <button type="button" onClick={() => void saveSellerDraft("Objection Reply", `${detail.sellerContact.ownerName} objection reply`, sellerObjectionReply)} disabled={working === "seller-draft"} className="brand-button mt-3 inline-flex px-4 py-3 text-sm uppercase tracking-[0.18em] transition disabled:opacity-60">
                Save seller draft
              </button>
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
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs uppercase tracking-[0.24em] text-[var(--copy-muted)]">Close checklist</div>
                <button type="button" onClick={addChecklistItem} className="brand-button inline-flex px-3 py-2 text-xs uppercase tracking-[0.18em] transition">
                  Add item
                </button>
              </div>
              <div className="space-y-3">
                {closingChecklist.map((item) => (
                  <div key={item.id} className="brand-card p-4">
                    <div className="grid gap-3 md:grid-cols-[1.3fr_0.7fr]">
                      <input
                        value={item.title}
                        onChange={(event) => updateChecklistItem(item.id, "title", event.target.value)}
                        className="brand-input px-3 py-3 text-sm outline-none"
                        placeholder="Checklist item"
                      />
                      <select
                        value={item.status}
                        onChange={(event) => updateChecklistItem(item.id, "status", event.target.value)}
                        className="brand-input px-3 py-3 text-sm outline-none"
                      >
                        <option>Open</option>
                        <option>In Progress</option>
                        <option>Done</option>
                        <option>Blocked</option>
                      </select>
                    </div>
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <input
                        value={item.owner}
                        onChange={(event) => updateChecklistItem(item.id, "owner", event.target.value)}
                        className="brand-input px-3 py-3 text-sm outline-none"
                        placeholder="Owner"
                      />
                      <input
                        value={item.dueDate}
                        onChange={(event) => updateChecklistItem(item.id, "dueDate", event.target.value)}
                        className="brand-input px-3 py-3 text-sm outline-none"
                        placeholder="Due date"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs uppercase tracking-[0.24em] text-[var(--copy-muted)]">Closing documents</div>
                <button type="button" onClick={addClosingDocument} className="brand-button inline-flex px-3 py-2 text-xs uppercase tracking-[0.18em] transition">
                  Add document
                </button>
              </div>
              <div className="space-y-3">
                {closingDocuments.map((item) => (
                  <div key={item.id} className="brand-card p-4">
                    <div className="grid gap-3 md:grid-cols-[1.2fr_0.8fr]">
                      <input
                        value={item.name}
                        onChange={(event) => updateClosingDocument(item.id, "name", event.target.value)}
                        className="brand-input px-3 py-3 text-sm outline-none"
                        placeholder="Document name"
                      />
                      <select
                        value={item.status}
                        onChange={(event) => updateClosingDocument(item.id, "status", event.target.value)}
                        className="brand-input px-3 py-3 text-sm outline-none"
                      >
                        <option>Requested</option>
                        <option>Received</option>
                        <option>Reviewed</option>
                        <option>Final</option>
                        <option>Missing</option>
                      </select>
                    </div>
                    <div className="mt-3 grid gap-3 md:grid-cols-[0.7fr_1.3fr]">
                      <input
                        value={item.owner}
                        onChange={(event) => updateClosingDocument(item.id, "owner", event.target.value)}
                        className="brand-input px-3 py-3 text-sm outline-none"
                        placeholder="Owner"
                      />
                      <input
                        value={item.notes}
                        onChange={(event) => updateClosingDocument(item.id, "notes", event.target.value)}
                        className="brand-input px-3 py-3 text-sm outline-none"
                        placeholder="Notes"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
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
            <div>Title company: <span className="font-semibold text-white">{titleCompany || "Not set"}</span></div>
            <div>Title officer: <span className="font-semibold text-white">{titleOfficer || "Not set"}</span></div>
            <div>Walkthrough: <span className="font-semibold text-white">{walkthroughAt || "Not scheduled"}</span></div>
            <div>Inspection end: <span className="font-semibold text-white">{inspectionEndsOn || "Not set"}</span></div>
            <div>Closing date: <span className="font-semibold text-white">{closingDate || "Not set"}</span></div>
            <div>Assignment: <span className="font-semibold text-white">{buyerAssignmentStatus || "Not set"}</span></div>
            <div>Earnest money: <span className="font-semibold text-white">{earnestMoneyStatus || "Not set"}</span></div>
            <div>Payout: <span className="font-semibold text-white">{payoutStatus || "Not set"}</span></div>
            <div className="flex gap-2 pt-2">
              <StatusPill tone={contractSent ? "good" : "neutral"} label={contractSent ? "contract sent" : "contract not sent"} />
              <StatusPill tone={contractSigned ? "good" : "warn"} label={contractSigned ? "signed" : "unsigned"} />
            </div>
            <div className="pt-3">
              <div className="text-xs uppercase tracking-[0.24em] text-[var(--copy-muted)]">Checklist progress</div>
              <div className="mt-2 space-y-2">
                {closingChecklist.map((item) => (
                  <div key={item.id} className="rounded-[14px] border border-[var(--line)] px-3 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="font-semibold text-white">{item.title || "Untitled item"}</div>
                      <StatusPill tone={item.status === "Done" ? "good" : item.status === "Blocked" ? "warn" : "neutral"} label={item.status.toLowerCase()} />
                    </div>
                    <div className="mt-1 text-xs text-[var(--copy-muted)]">
                      {item.owner || "Unassigned"}{item.dueDate ? ` / due ${item.dueDate}` : ""}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="pt-3">
              <div className="text-xs uppercase tracking-[0.24em] text-[var(--copy-muted)]">Document posture</div>
              <div className="mt-2 space-y-2">
                {closingDocuments.map((item) => (
                  <div key={item.id} className="rounded-[14px] border border-[var(--line)] px-3 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="font-semibold text-white">{item.name || "Untitled document"}</div>
                      <StatusPill tone={item.status === "Final" ? "good" : item.status === "Missing" ? "warn" : "neutral"} label={item.status.toLowerCase()} />
                    </div>
                    <div className="mt-1 text-xs text-[var(--copy-muted)]">{item.owner || "Unassigned"}</div>
                    {item.notes ? <div className="mt-2 text-sm text-[var(--copy-soft)]">{item.notes}</div> : null}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Panel>

        <Panel
          eyebrow="Documents"
          title="Upload signed and closing files"
          description="Store signed contracts, proof of funds, title documents, settlement statements, and other close-table files directly on the deal."
        >
          <form onSubmit={uploadDocument} className="grid gap-4">
            <div className="grid gap-3 md:grid-cols-2">
              <select value={documentCategory} onChange={(event) => setDocumentCategory(event.target.value)} className="brand-input px-3 py-3 text-sm outline-none">
                <option>Signed Contract</option>
                <option>Assignment Agreement</option>
                <option>Proof Of Funds</option>
                <option>Title Commitment</option>
                <option>Settlement Statement</option>
                <option>Closing Disclosure</option>
                <option>Walkthrough Photos</option>
                <option>Other</option>
              </select>
              <select value={documentStatus} onChange={(event) => setDocumentStatus(event.target.value)} className="brand-input px-3 py-3 text-sm outline-none">
                <option>Received</option>
                <option>Reviewed</option>
                <option>Final</option>
                <option>Missing</option>
              </select>
            </div>
            <input value={documentOwner} onChange={(event) => setDocumentOwner(event.target.value)} className="brand-input px-3 py-3 text-sm outline-none" placeholder="Document owner" />
            <input type="file" onChange={(event) => setDocumentFile(event.target.files?.[0] ?? null)} className="brand-input px-3 py-3 text-sm outline-none" />
            <textarea value={documentNotes} onChange={(event) => setDocumentNotes(event.target.value)} className="brand-input min-h-24 w-full px-3 py-3 text-sm outline-none" placeholder="Notes about the file, signature status, or missing items" />
            <button type="submit" disabled={!documentFile || working === "document"} className="brand-button inline-flex px-4 py-3 text-sm uppercase tracking-[0.18em] transition disabled:opacity-60">
              {working === "document" ? "Uploading..." : "Upload deal document"}
            </button>
          </form>
        </Panel>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.08fr_0.92fr]">
        <Panel
          eyebrow="Document Ledger"
          title="Saved deal files"
          description="This is the live file trail for the deal, including public proof-of-funds uploads and internal signed documents."
        >
          <div className="space-y-4">
            {detail.uploadedDocuments.length ? (
              detail.uploadedDocuments.map((item) => (
                <div key={item.id} className="brand-card p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-base font-semibold text-white">{item.category}</div>
                      <div className="mt-1 text-xs text-[var(--copy-muted)]">{item.fileName}</div>
                    </div>
                    <div className="flex gap-2">
                      <StatusPill tone="good" label={item.status.toLowerCase()} />
                      <StatusPill tone="active" label={item.source.toLowerCase()} />
                    </div>
                  </div>
                  <div className="mt-3 text-sm leading-6 text-[var(--copy-soft)]">
                    Owner: {item.owner} {item.sizeBytes ? ` / ${(item.sizeBytes / 1024).toFixed(1)} KB` : ""}
                  </div>
                  {item.notes ? <div className="mt-2 text-sm leading-6 text-[var(--copy-soft)]">{item.notes}</div> : null}
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <a href={`/api/deal-engine/document?dealId=${encodeURIComponent(dealId)}&documentId=${encodeURIComponent(item.id)}`} className="brand-button inline-flex px-4 py-3 text-sm uppercase tracking-[0.18em] transition">
                      Open file
                    </a>
                    <div className="text-xs text-[var(--copy-muted)]">{new Date(item.uploadedAt).toLocaleString()}</div>
                  </div>
                </div>
              ))
            ) : (
              <div className="brand-card p-4 text-sm text-[var(--copy-soft)]">
                No uploaded deal files are attached yet.
              </div>
            )}
          </div>
        </Panel>

        <Panel
          eyebrow="Email Console"
          title="Send deal emails from inside the workflow"
          description="Use this for seller or buyer email sends when Resend is configured. This does not use Twilio."
        >
          <div className="brand-card mb-4 p-4 text-sm leading-6 text-[var(--copy-soft)]">
            If sending returns a provider error, the workflow surface is ready but the live email credential still needs to be configured in the environment.
          </div>
          <form onSubmit={sendEmail} className="grid gap-4">
            <select
              value={emailAudience}
              onChange={(event) => {
                const nextAudience = event.target.value;
                setEmailAudience(nextAudience);
                if (nextAudience === "seller") {
                  setEmailSubject(detail.sellerOutreach.emailSubject);
                  setEmailBody(detail.sellerOutreach.emailBody);
                } else {
                  setEmailSubject(detail.buyerSignals[0]?.outreachSubject ?? `Deal opportunity from ${detail.lead.county} County`);
                  setEmailBody(detail.packet.buyerEmailBlast);
                }
              }}
              className="brand-input px-3 py-3 text-sm outline-none"
            >
              <option value="seller">Seller email</option>
              <option value="buyer">Buyer email</option>
            </select>
            <input value={emailTo} onChange={(event) => setEmailTo(event.target.value)} className="brand-input px-3 py-3 text-sm outline-none" placeholder="Recipient email" />
            <input value={emailSubject} onChange={(event) => setEmailSubject(event.target.value)} className="brand-input px-3 py-3 text-sm outline-none" placeholder="Subject" />
            <textarea value={emailBody} onChange={(event) => setEmailBody(event.target.value)} className="brand-input min-h-32 w-full px-3 py-3 text-sm outline-none" placeholder="Email body" />
            <button type="submit" disabled={!emailTo.trim() || !emailSubject.trim() || !emailBody.trim() || working === "email"} className="brand-button inline-flex px-4 py-3 text-sm uppercase tracking-[0.18em] transition disabled:opacity-60">
              {working === "email" ? "Sending email..." : "Send email"}
            </button>
          </form>
        </Panel>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.08fr_0.92fr]">
        <Panel
          eyebrow="Underwriting Console"
          title="Capture the real analysis inputs"
          description="Enter live numbers here first. The contract lane should inherit from real underwriting instead of placeholder assumptions, and the wholesale compliance lane should be reviewed before paper goes out."
        >
          <div className="brand-card mb-4 p-4 text-sm leading-6 text-[var(--copy-soft)]">
            Need help with ARV? Use the live estimate action to calculate it from the deal county, property type, assessed value, and Seller Engine distress signals. If the exact assessed value is missing, Deal Engine will fall back to a same-market property baseline and label the confidence for you before saving it into underwriting.
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button type="button" onClick={() => void estimateArv()} disabled={working === "arv"} className="brand-button inline-flex px-4 py-3 text-sm uppercase tracking-[0.18em] transition disabled:opacity-60">
                {working === "arv" ? "Estimating ARV..." : "Estimate and save ARV"}
              </button>
              {arvEstimateHint ? <div className="text-xs text-[var(--copy-muted)]">{arvEstimateHint}</div> : null}
            </div>
          </div>
          <form onSubmit={saveAnalysis} className="grid gap-4">
            <div className="grid gap-3 md:grid-cols-2">
              <input value={estimatedArv} onChange={(event) => setEstimatedArv(event.target.value)} className="brand-input px-3 py-3 text-sm outline-none" placeholder="Estimated ARV" />
              <input value={sellerAskingPrice} onChange={(event) => setSellerAskingPrice(event.target.value)} className="brand-input px-3 py-3 text-sm outline-none" placeholder="Seller asking price" />
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <input value={repairEstimate} onChange={(event) => setRepairEstimate(event.target.value)} className="brand-input px-3 py-3 text-sm outline-none" placeholder="Repair estimate" />
              <input value={assignmentFeeTarget} onChange={(event) => setAssignmentFeeTarget(event.target.value)} className="brand-input px-3 py-3 text-sm outline-none" placeholder="Assignment fee target" />
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <input value={closingCosts} onChange={(event) => setClosingCosts(event.target.value)} className="brand-input px-3 py-3 text-sm outline-none" placeholder="Closing costs" />
              <input value={holdingCosts} onChange={(event) => setHoldingCosts(event.target.value)} className="brand-input px-3 py-3 text-sm outline-none" placeholder="Holding costs" />
              <input value={buyerProfitTarget} onChange={(event) => setBuyerProfitTarget(event.target.value)} className="brand-input px-3 py-3 text-sm outline-none" placeholder="Buyer profit target" />
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <input value={rentalEstimate} onChange={(event) => setRentalEstimate(event.target.value)} className="brand-input px-3 py-3 text-sm outline-none" placeholder="Rental estimate (optional)" />
              <input value={flipEstimate} onChange={(event) => setFlipEstimate(event.target.value)} className="brand-input px-3 py-3 text-sm outline-none" placeholder="Flip estimate (optional)" />
            </div>
            <button type="submit" disabled={working === "analysis"} className="brand-button inline-flex px-4 py-3 text-sm uppercase tracking-[0.18em] transition disabled:opacity-60">
              {working === "analysis" ? "Saving underwriting..." : "Save underwriting"}
            </button>
          </form>
        </Panel>

        <Panel
          eyebrow="Contract Console"
          title="Save underwriting and terms"
          description="After underwriting is complete, adjust the contract lane here and push the updated posture back into Deal Engine tables with the wholesale disclosure guardrails intact."
        >
          <div className="brand-card mb-4 p-4 text-sm leading-6 text-[var(--copy-soft)]">
            Build the live contract draft from this deal record after you save the latest terms.
            <div className="mt-3">
              <a href={`/api/deal-engine/${encodeURIComponent(dealId)}/contract`} className="brand-button inline-flex px-4 py-3 text-sm uppercase tracking-[0.18em] transition">
                Open contract PDF
              </a>
            </div>
          </div>
          <div className="brand-card mb-4 p-4 text-sm leading-6 text-[var(--copy-soft)]">
            Before sending:
            <div className="mt-3 space-y-2">
              {detail.underwriting.compliance.checklist.map((item) => (
                <div key={item} className="rounded-[14px] border border-[var(--line)] px-3 py-3">
                  {item}
                </div>
              ))}
            </div>
          </div>
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
          description="Launch a county-specific Buyer Engine search from this deal, then select a buyer signal and generate a disposition draft without leaving Deal Engine."
        >
          <div className="brand-card mb-4 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-base font-semibold text-white">Dedicated buyer-search action</div>
                <div className="mt-2 text-sm leading-6 text-[var(--copy-soft)]">
                  Launch a fresh Buyer Engine search for {detail.lead.county} County directly from this deal when the shortlist needs to be rebuilt around the current lane.
                </div>
              </div>
              <button type="button" onClick={() => void launchBuyerSearch()} disabled={working === "search"} className="brand-button inline-flex px-4 py-3 text-sm uppercase tracking-[0.18em] transition disabled:opacity-60">
                {working === "search" ? "Launching..." : "Launch search"}
              </button>
            </div>
          </div>
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
          eyebrow="Seller Draft Ledger"
          title="Saved seller outreach artifacts"
          description="These are the seller-facing scripts that have been saved back into the deal record for reuse and reference."
        >
          <div className="space-y-4">
            {detail.sellerDrafts.length ? (
              detail.sellerDrafts.map((draft) => (
                <div key={draft.id} className="brand-card p-4">
                  <div className="text-base font-semibold text-white">{draft.title}</div>
                  <div className="mt-1 text-xs text-[var(--copy-muted)]">{draft.kind}</div>
                  <div className="mt-1 text-xs text-[var(--copy-muted)]">{new Date(draft.createdAt).toLocaleString()}</div>
                  <pre className="mt-3 whitespace-pre-wrap text-sm leading-6 text-[var(--copy-soft)]">{draft.body}</pre>
                </div>
              ))
            ) : (
              <div className="brand-card p-4 text-sm text-[var(--copy-soft)]">
                No saved seller drafts are attached to this deal yet.
              </div>
            )}
          </div>
        </Panel>

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

      <div className="grid gap-6 xl:grid-cols-[1.08fr_0.92fr]">
        <Panel
          eyebrow="Execution Log"
          title="Record real outreach from inside the deal"
          description="Use this after a call, text, email, voicemail, or buyer touch so the wholesale workflow does not stop at drafts."
        >
          <form onSubmit={logOutreachExecution} className="grid gap-4">
            <div className="grid gap-3 md:grid-cols-2">
              <select
                value={outreachAudience}
                onChange={(event) => {
                  const audience = event.target.value as "seller" | "buyer";
                  setOutreachAudience(audience);
                  setOutreachRecipient(
                    audience === "seller"
                      ? detail.sellerContact.ownerName
                      : detail.buyerSignals[0]?.buyerName ?? detail.relatedDrafts[0]?.buyerName ?? "",
                  );
                }}
                className="brand-input px-3 py-3 text-sm outline-none"
              >
                <option value="seller">Seller outreach</option>
                <option value="buyer">Buyer outreach</option>
              </select>
              <input value={outreachChannel} onChange={(event) => setOutreachChannel(event.target.value)} className="brand-input px-3 py-3 text-sm outline-none" placeholder="Channel" />
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <input value={outreachRecipient} onChange={(event) => setOutreachRecipient(event.target.value)} className="brand-input px-3 py-3 text-sm outline-none" placeholder="Recipient" />
              <input value={outreachStatus} onChange={(event) => setOutreachStatus(event.target.value)} className="brand-input px-3 py-3 text-sm outline-none" placeholder="Status" />
            </div>
            <input value={outreachOutcome} onChange={(event) => setOutreachOutcome(event.target.value)} className="brand-input px-3 py-3 text-sm outline-none" placeholder="Outcome" />
            <textarea value={outreachNextStep} onChange={(event) => setOutreachNextStep(event.target.value)} className="brand-input min-h-20 w-full px-3 py-3 text-sm outline-none" placeholder="Next step" />
            <textarea value={outreachNotes} onChange={(event) => setOutreachNotes(event.target.value)} className="brand-input min-h-24 w-full px-3 py-3 text-sm outline-none" placeholder="Internal notes" />
            <button type="submit" disabled={!outreachRecipient.trim() || working === "outreach"} className="brand-button inline-flex px-4 py-3 text-sm uppercase tracking-[0.18em] transition disabled:opacity-60">
              {working === "outreach" ? "Logging outreach..." : "Log outreach execution"}
            </button>
          </form>
        </Panel>

        <Panel
          eyebrow="Execution Ledger"
          title="Saved outreach attempts"
          description="A live record of what has actually been sent or attempted for this deal, across both seller and buyer lanes."
        >
          <div className="space-y-4">
            {detail.outreachExecutions.length ? (
              detail.outreachExecutions.map((entry) => (
                <div key={entry.id} className="brand-card p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-base font-semibold text-white">{entry.recipient}</div>
                      <div className="mt-1 text-xs text-[var(--copy-muted)]">{entry.audience} / {entry.channel}</div>
                    </div>
                    <div className="flex gap-2">
                      <StatusPill tone={executionTone(entry.status)} label={entry.status.toLowerCase()} />
                      <StatusPill tone={executionTone(entry.outcome)} label={(entry.outcome || "logged").toLowerCase()} />
                    </div>
                  </div>
                  {entry.nextStep ? <div className="mt-3 text-sm leading-6 text-[var(--copy-soft)]">Next: {entry.nextStep}</div> : null}
                  {entry.notes ? <div className="mt-2 text-sm leading-6 text-[var(--copy-soft)]">{entry.notes}</div> : null}
                  <div className="mt-2 text-xs text-[var(--copy-muted)]">{new Date(entry.loggedAt).toLocaleString()}</div>
                </div>
              ))
            ) : (
              <div className="brand-card p-4 text-sm text-[var(--copy-soft)]">
                No outreach attempts have been logged yet.
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

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.08fr_0.92fr]">
        <Panel
          eyebrow="Closeout"
          title="Record the final deal outcome"
          description="Use this to finish the wholesale loop inside the site once the assignment, disposition, or fallout result is known."
        >
          <form onSubmit={saveCloseout} className="grid gap-4">
            <div className="grid gap-3 md:grid-cols-2">
              <select value={closeoutOutcome} onChange={(event) => setCloseoutOutcome(event.target.value)} className="brand-input px-3 py-3 text-sm outline-none">
                <option>Closed Won</option>
                <option>Closed Lost</option>
                <option>Cancelled</option>
              </select>
              <input value={closeoutDate} onChange={(event) => setCloseoutDate(event.target.value)} className="brand-input px-3 py-3 text-sm outline-none" placeholder="Close date" />
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <input value={closeoutBuyerName} onChange={(event) => setCloseoutBuyerName(event.target.value)} className="brand-input px-3 py-3 text-sm outline-none" placeholder="End buyer / assignee" />
              <input value={closeoutFee} onChange={(event) => setCloseoutFee(event.target.value)} className="brand-input px-3 py-3 text-sm outline-none" placeholder="Assignment fee collected" />
            </div>
            <textarea value={closeoutNotes} onChange={(event) => setCloseoutNotes(event.target.value)} className="brand-input min-h-24 w-full px-3 py-3 text-sm outline-none" placeholder="Closeout notes" />
            <button type="submit" disabled={!closeoutOutcome.trim() || working === "closeout"} className="brand-button inline-flex px-4 py-3 text-sm uppercase tracking-[0.18em] transition disabled:opacity-60">
              {working === "closeout" ? "Recording closeout..." : "Record deal closeout"}
            </button>
          </form>
        </Panel>

        <Panel
          eyebrow="Closeout Ledger"
          title="Latest recorded outcome"
          description="This keeps the final wholesale disposition visible to the next operator without needing to inspect raw logs."
        >
          {detail.closeout ? (
            <div className="brand-card p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-lg font-semibold text-white">{detail.closeout.outcome}</div>
                  <div className="mt-1 text-xs text-[var(--copy-muted)]">Recorded {new Date(detail.closeout.recordedAt).toLocaleString()}</div>
                </div>
                <StatusPill tone={executionTone(detail.closeout.outcome)} label={detail.closeout.outcome.toLowerCase()} />
              </div>
              <div className="mt-4 space-y-2 text-sm leading-6 text-[var(--copy-soft)]">
                <div>Closed at: {detail.closeout.closedAt || "Not entered"}</div>
                <div>End buyer: {detail.closeout.buyerName || "Not entered"}</div>
                <div>Assignment fee: {detail.closeout.assignmentFeeCollected ? `$${detail.closeout.assignmentFeeCollected.toLocaleString()}` : "Not entered"}</div>
                <div>{detail.closeout.notes || "No closeout note entered."}</div>
              </div>
            </div>
          ) : (
            <div className="brand-card p-4 text-sm text-[var(--copy-soft)]">
              No closeout outcome has been recorded for this deal yet.
            </div>
          )}
        </Panel>
      </div>

      {status ? (
        <div className="rounded-[18px] border border-[var(--line)] bg-[hsl(0_0%_100%/.03)] px-4 py-3 text-sm text-[var(--copy-soft)]">
          {status}
        </div>
      ) : null}
    </DealEngineShell>
  );
}
