import contractTemplateRegistryData from "@/lib/contract-template-registry-data.json";

export type ContractTemplateType =
  | "purchase_agreement"
  | "assignment_agreement"
  | "assignment_addendum"
  | "inspection_addendum"
  | "closing_extension_addendum"
  | "emd_receipt"
  | "buyer_assignment_fee_disclosure"
  | "title_company_submission_package";

export type ContractTemplateLicenseStatus = "public" | "restricted" | "unknown" | "attorney_required";
export type ContractTemplateApprovalStatus = "reference_only" | "attorney_review_required" | "attorney_approved";

export type ContractTemplateRecord = {
  id: string;
  templateKey: string;
  type: ContractTemplateType;
  name: string;
  intendedPurpose: string;
  sourceName: string;
  sourceUrl: string;
  licenseStatus: ContractTemplateLicenseStatus;
  approvalStatus: ContractTemplateApprovalStatus;
  requiredFields: string[];
  optionalFields: string[];
  variableMap: Record<string, string>;
  storagePath: string | null;
  version: string;
  state: string | null;
  notes: string;
  requestedUse: ContractTemplateType;
};

export const CONTRACT_TEMPLATE_REGISTRY = contractTemplateRegistryData as unknown as ContractTemplateRecord[];

export function isTemplateAllowedForGeneration(template: ContractTemplateRecord) {
  return template.approvalStatus !== "reference_only" && !!template.storagePath;
}
