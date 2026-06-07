import { NextRequest, NextResponse } from "next/server";

import { saveOperatorTask } from "@/lib/deal-engine-server";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      dealId?: string;
      taskId?: string;
      title?: string;
      owner?: string;
      dueDate?: string;
      priority?: string;
      status?: string;
      notes?: string;
    };

    if (!body.dealId?.trim() || !body.title?.trim()) {
      return NextResponse.json(
        { ok: false, error: "dealId and title are required." },
        { status: 400 },
      );
    }

    const result = await saveOperatorTask({
      dealId: body.dealId.trim(),
      taskId: body.taskId?.trim(),
      title: body.title.trim(),
      owner: body.owner?.trim() || "Blackspire operator",
      dueDate: body.dueDate?.trim() || "",
      priority: body.priority?.trim() || "Normal",
      status: body.status?.trim() || "Open",
      notes: body.notes?.trim() || "",
    });

    if (!result.ok) {
      return NextResponse.json(result, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      message: `Operator task saved for ${body.dealId}.`,
      taskId: result.taskId,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Task save failed." },
      { status: 500 },
    );
  }
}
