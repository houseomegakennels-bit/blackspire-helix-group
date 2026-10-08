import { guardAdminApi } from "@/lib/operator-access";
import { NextRequest, NextResponse } from "next/server";

import { parseInvestmentAmount, type InvestmentStrategy } from "@/lib/investment-analysis";

import { saveDealAnalysis } from "@/lib/deal-engine-server";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const denied = await guardAdminApi();
  if (denied) return denied;
  try {
    const body = (await request.json()) as {
      dealId?: string;
      strategy?: InvestmentStrategy;
      monthlyExpenses?: number | string | null;
      monthlyDebtService?: number | string | null;
      estimatedArv?: number | string | null;
      sellerAskingPrice?: number | string | null;
      repairEstimate?: number | string | null;
      closingCosts?: number | string | null;
      holdingCosts?: number | string | null;
      buyerProfitTarget?: number | string | null;
      assignmentFeeTarget?: number | string | null;
      rentalEstimate?: number | string | null;
      flipEstimate?: number | string | null;
    };

    if (!body.dealId?.trim()) {
      return NextResponse.json({ ok: false, error: "dealId is required." }, { status: 400 });
    }

    const result = await saveDealAnalysis({
      dealId: body.dealId.trim(),
      strategy: body.strategy,
      monthlyExpenses: body.monthlyExpenses === undefined ? undefined : parseInvestmentAmount(body.monthlyExpenses),
      monthlyDebtService: body.monthlyDebtService === undefined ? undefined : parseInvestmentAmount(body.monthlyDebtService),
      estimatedArv: parseInvestmentAmount(body.estimatedArv),
      sellerAskingPrice: parseInvestmentAmount(body.sellerAskingPrice),
      repairEstimate: parseInvestmentAmount(body.repairEstimate),
      closingCosts: parseInvestmentAmount(body.closingCosts),
      holdingCosts: parseInvestmentAmount(body.holdingCosts),
      buyerProfitTarget: parseInvestmentAmount(body.buyerProfitTarget),
      assignmentFeeTarget: parseInvestmentAmount(body.assignmentFeeTarget),
      rentalEstimate: parseInvestmentAmount(body.rentalEstimate),
      flipEstimate: parseInvestmentAmount(body.flipEstimate),
    });

    if (!result.ok) {
      return NextResponse.json(result, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      message: `Underwriting saved for ${body.dealId}.`,
      underwriting: result.underwriting,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Underwriting save failed." },
      { status: 400 },
    );
  }
}
