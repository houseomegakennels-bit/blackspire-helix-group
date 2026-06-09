import { NextRequest, NextResponse } from "next/server";

import { listContractTemplates } from "@/lib/deal-engine-server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function getSupabaseAdmin() {
  if (!process.env.SUPABASE_URL?.trim() || !process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) return null;
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function GET(request: NextRequest) {
  try {
    const type = request.nextUrl.searchParams.get("type")?.trim() || undefined;
    const state = request.nextUrl.searchParams.get("state")?.trim() || undefined;
    const approvalStatus = request.nextUrl.searchParams.get("approvalStatus")?.trim() || undefined;
    const templates = await listContractTemplates({ type, state, approvalStatus });
    return NextResponse.json({ ok: true, templates });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unable to list contract templates." },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return NextResponse.json({ ok: false, error: "Supabase service credentials are missing." }, { status: 500 });
    }

    const body = (await request.json()) as {
      templateKey?: string;
      templateType?: string;
      name?: string;
      intendedPurpose?: string;
      sourceName?: string;
      sourceUrl?: string;
      licenseStatus?: string;
      approvalStatus?: string;
      state?: string | null;
      version?: string;
      requiredFields?: string[];
      optionalFields?: string[];
      variableMap?: Record<string, string>;
      storagePath?: string | null;
      notes?: string;
    };

    if (!body.templateKey?.trim() || !body.templateType?.trim() || !body.name?.trim()) {
      return NextResponse.json({ ok: false, error: "templateKey, templateType, and name are required." }, { status: 400 });
    }

    const { error } = await supabase.from("contract_templates").upsert({
      template_key: body.templateKey.trim(),
      template_type: body.templateType.trim(),
      name: body.name.trim(),
      intended_purpose: body.intendedPurpose?.trim() || "",
      source_name: body.sourceName?.trim() || "",
      source_url: body.sourceUrl?.trim() || "",
      license_status: body.licenseStatus?.trim() || "unknown",
      approval_status: body.approvalStatus?.trim() || "reference_only",
      state: body.state?.trim() || null,
      version: body.version?.trim() || "reference",
      required_fields: body.requiredFields ?? [],
      optional_fields: body.optionalFields ?? [],
      variable_map: body.variableMap ?? {},
      storage_path: body.storagePath?.trim() || null,
      notes: body.notes?.trim() || "",
      updated_at: new Date().toISOString(),
    }, { onConflict: "template_key" });

    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, message: "Template metadata registered." });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unable to register contract template." },
      { status: 500 },
    );
  }
}
