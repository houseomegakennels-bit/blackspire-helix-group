import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const MAX_IMAGE_COUNT = 4;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const SUPPORTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

type LawnVisionAnalysis = {
  photoAnalysis: string;
  yardSize?: "small" | "medium" | "large" | "acreage";
  grassHeight?: "short" | "standard" | "tall";
  overgrowth?: "light" | "moderate" | "heavy";
  cleanup?: "none" | "light" | "heavy";
  acreage?: string;
  slope?: string;
  access?: string;
  notes?: string;
  confidence?: string;
};

function isUploadedFile(value: FormDataEntryValue): value is File {
  return (
    typeof value === "object" &&
    value !== null &&
    "arrayBuffer" in value &&
    "type" in value &&
    "size" in value
  );
}

function getOutputText(response: Record<string, unknown>) {
  if (typeof response.output_text === "string") return response.output_text;

  const output = Array.isArray(response.output) ? response.output : [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const content = Array.isArray((item as { content?: unknown }).content)
      ? (item as { content: unknown[] }).content
      : [];
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      const text = (part as { text?: unknown }).text;
      if (typeof text === "string") return text;
    }
  }

  return "";
}

function parseAnalysis(text: string): LawnVisionAnalysis {
  const trimmed = text.trim();
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  const parsed = JSON.parse(jsonMatch?.[0] ?? trimmed) as LawnVisionAnalysis;

  return {
    photoAnalysis: parsed.photoAnalysis || "AI vision reviewed the uploaded yard image.",
    yardSize: parsed.yardSize,
    grassHeight: parsed.grassHeight,
    overgrowth: parsed.overgrowth,
    cleanup: parsed.cleanup,
    acreage: parsed.acreage || "",
    slope: parsed.slope || "",
    access: parsed.access || "",
    notes: parsed.notes || "",
    confidence: parsed.confidence || "vision-assisted estimate",
  };
}

export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      return NextResponse.json(
        { ok: false, error: "Missing OPENAI_API_KEY for Helix Lawn Command vision analysis." },
        { status: 500 },
      );
    }

    const formData = await request.formData();
    const files = formData
      .getAll("images")
      .filter(isUploadedFile)
      .slice(0, MAX_IMAGE_COUNT);

    if (!files.length) {
      return NextResponse.json(
        { ok: false, error: "Upload at least one yard image for analysis." },
        { status: 400 },
      );
    }

    const imageInputs = [];
    for (const file of files) {
      if (!SUPPORTED_TYPES.has(file.type)) {
        return NextResponse.json(
          { ok: false, error: "Supported image types are JPG, PNG, WEBP, and non-animated GIF." },
          { status: 400 },
        );
      }
      if (file.size > MAX_IMAGE_BYTES) {
        return NextResponse.json(
          { ok: false, error: "Each image must be 8MB or smaller." },
          { status: 400 },
        );
      }

      const bytes = Buffer.from(await file.arrayBuffer());
      imageInputs.push({
        type: "input_image",
        image_url: `data:${file.type};base64,${bytes.toString("base64")}`,
        detail: "high",
      });
    }

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENAI_VISION_MODEL || "gpt-4.1-mini",
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text:
                  "You are a lawn-care estimating assistant. Analyze the uploaded yard/property images for service estimating. Return ONLY valid JSON with these keys: photoAnalysis, yardSize, grassHeight, overgrowth, cleanup, acreage, slope, access, notes, confidence. Allowed yardSize values: small, medium, large, acreage. Allowed grassHeight values: short, standard, tall. Allowed overgrowth values: light, moderate, heavy. Allowed cleanup values: none, light, heavy. Be conservative when uncertain. Mention visible clues such as grass height, debris, slope, fences, gates, access, acreage cues, bushes, leaves, and manual-review risks.",
              },
              ...imageInputs,
            ],
          },
        ],
      }),
    });

    const payload = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      const error = JSON.stringify(payload);
      return NextResponse.json(
        { ok: false, error: `OpenAI vision analysis failed: ${error}` },
        { status: response.status },
      );
    }

    const analysis = parseAnalysis(getOutputText(payload));

    return NextResponse.json({
      ok: true,
      analysis,
      imageCount: files.length,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unable to analyze lawn images.",
      },
      { status: 500 },
    );
  }
}
