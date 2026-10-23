export type PropertyNextStep = {
  text: string;
  reason: string;
  section: string;
  label: string;
  dueDate: string | null;
  owner: string | null;
  urgency: "overdue" | "due_soon" | "review" | "complete";
};

type Task = { title: string; status: string; dueDate: string; owner: string; notes?: string };
type Coordination = {
  contractSent: boolean;
  contractSigned: boolean;
  inspectionEndsOn: string;
  closingDate: string;
  titleCompany: string;
  titleOfficer: string;
  buyerAssignmentStatus: string;
  closingChecklist: Task[];
  closingDocuments: Array<{ name: string; status: string }>;
};

/** Date-only legal deadlines retain their calendar date, independent of browser timezone. */
export function propertyCalendarDate(value: string | null | undefined): string | null {
  const text = value?.trim() ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(text + "T12:00:00Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === text ? text : null;
}

export function propertyToday(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (name: string) => parts.find((item) => item.type === name)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function propertyTaskFinished(status: string): boolean {
  return /^(done|complete|completed|closed|cancelled|canceled)$/i.test(status.trim());
}

/** Uses current editor values; advice never records a completed action or authorizes a commitment. */
export function propertyNextStep(input: {
  stage: string;
  nextAction: string;
  missingInputs: string[];
  coordination: Coordination;
  tasks: Task[];
  today?: string;
}): PropertyNextStep {
  const c = input.coordination;
  const today = propertyCalendarDate(input.today) ?? propertyToday();
  const result = (text: string, reason: string, section: string, label: string, extra: Partial<PropertyNextStep> = {}): PropertyNextStep => ({ text, reason, section, label, dueDate: null, owner: null, urgency: "review", ...extra });
  if (/^(closed|closed won|closed lost|completed|archived|dead|lost)(?:\b|$)/i.test(input.stage.trim())) {
    return result("Review the recorded outcome and retain the supporting files.", "This property is in a completed stage. Missing historical numbers do not reopen acquisition work.", "closing", "Review outcome", { urgency: "complete" });
  }
  const deadlines: Array<{ title: string; dueDate: string; owner: string; section: string; waiting: boolean }> = [
    ...input.tasks.filter((task) => !propertyTaskFinished(task.status)).map((task) => ({ ...task, section: "activity", waiting: /waiting|blocked|pending/i.test(task.status) })),
    ...c.closingChecklist.filter((task) => !propertyTaskFinished(task.status)).map((task) => ({ ...task, section: "closing", waiting: /waiting|blocked|pending/i.test(task.status) })),
    ...(c.contractSigned && c.inspectionEndsOn ? [{ title: "Review the inspection deadline", dueDate: c.inspectionEndsOn, owner: "", section: "closing", waiting: false }] : []),
    ...(c.closingDate ? [{ title: "Review the closing deadline", dueDate: c.closingDate, owner: c.titleOfficer, section: "closing", waiting: false }] : []),
  ].filter((task) => propertyCalendarDate(task.dueDate) !== null).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const deadline = deadlines[0];
  if (deadline) {
    const days = Math.round((Date.parse(deadline.dueDate + "T12:00:00Z") - Date.parse(today + "T12:00:00Z")) / 86400000);
    if (days <= 7) {
      const timing = days < 0 ? "overdue" : days === 0 ? "due today" : `due in ${days} day${days === 1 ? "" : "s"}`;
      return result(deadline.title, `${deadline.dueDate} is ${timing}.${deadline.waiting ? " This task is waiting or blocked; review the dependency before proceeding." : " Confirm completion evidence or resolve the open item."}`, deadline.section, deadline.section === "activity" ? "Review task" : "Review deadline", { dueDate: deadline.dueDate, owner: deadline.owner.trim() || null, urgency: days < 0 ? "overdue" : "due_soon" });
    }
  }
  if (input.missingInputs.length) return result(`Complete these numbers: ${input.missingInputs.join(", ")}.`, "The current figures are incomplete. An estimate or blank value does not establish a safe purchase ceiling.", "numbers", "Review missing numbers");
  if (!c.contractSigned) return c.contractSent
    ? result("Review signature status and executed-contract evidence.", "The contract is marked sent, but execution has not been confirmed. Review delivery and required parties before advancing.", "offer", "Review contract evidence")
    : result("Review the proposed offer and required documents.", "The figures alone do not confirm seller authority, title or agreed terms. Review those before sharing an offer.", "offer", "Review offer");
  if (!c.titleCompany.trim() || /^(unassigned|not assigned|not entered|not set|unknown|tbd|pending)$/i.test(c.titleCompany.trim())) return result("Assign title coordination and review outstanding title evidence.", "A signed contract does not establish clear title. No title company or closing attorney is recorded.", "closing", "Review title coordination");
  const unreviewed = c.closingDocuments.filter((document) => !/^(reviewed|final)$/i.test(document.status.trim()));
  if (!c.closingDocuments.length || unreviewed.length) return result("Review closing documents and their evidence status.", "An upload or received file is not a title clearance. Confirm review and unresolved loan, lien and ownership questions separately.", "documents", "Review documents");
  if (!/^(assigned|locked|under contract)$/i.test(c.buyerAssignmentStatus.trim())) return result("Review buyer commitment and funding evidence.", "Buyer candidates do not establish an assignment, proof of funds or an accepted commitment.", "buyers", "Review buyers");
  return result("Review remaining closing tasks and responsibilities.", "Confirm dates, owners and completion evidence before recording an outcome.", "closing", "Review closing tasks");
}
