import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";

const envPath = path.join(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const [key, ...rest] = trimmed.split("=");
    if (!process.env[key]) {
      process.env[key] = rest.join("=").trim();
    }
  }
}

const url = process.env.SUPABASE_URL?.trim();
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

if (!url || !serviceRoleKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const { default: CONTRACT_TEMPLATE_REGISTRY } = await import("../src/lib/contract-template-registry-data.json", {
  with: { type: "json" },
});

const supabase = createClient(url, serviceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

const payload = CONTRACT_TEMPLATE_REGISTRY.map((template) => ({
  template_key: template.templateKey,
  template_type: template.type,
  name: template.name,
  intended_purpose: template.intendedPurpose,
  source_name: template.sourceName,
  source_url: template.sourceUrl,
  license_status: template.licenseStatus,
  approval_status: template.approvalStatus,
  state: template.state,
  version: template.version,
  required_fields: template.requiredFields,
  optional_fields: template.optionalFields,
  variable_map: template.variableMap,
  storage_path: template.storagePath,
  notes: template.notes,
  updated_at: new Date().toISOString(),
}));

const { error } = await supabase.from("contract_templates").upsert(payload, { onConflict: "template_key" });

if (error) {
  console.error(error.message);
  process.exit(1);
}

console.log(`Synced ${payload.length} contract templates.`);
