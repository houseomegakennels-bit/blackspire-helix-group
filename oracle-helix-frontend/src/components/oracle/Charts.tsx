import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, LineChart,
  PolarAngleAxis, PolarGrid, Radar, RadarChart, ResponsiveContainer, Tooltip, XAxis, YAxis, ReferenceLine, LabelList,
} from "recharts";

const axis = { stroke: "oklch(0.5 0.03 265)", fontSize: 10, fontFamily: "JetBrains Mono" };
const grid = { stroke: "oklch(0.3 0.03 265 / 0.4)", strokeDasharray: "3 4" };
const tooltipStyle = {
  background: "oklch(0.13 0.02 265 / 0.95)", border: "1px solid oklch(0.35 0.04 265 / 0.6)",
  borderRadius: 10, fontSize: 12, color: "oklch(0.96 0.005 250)", backdropFilter: "blur(12px)", padding: "8px 10px",
};

export function HelixAreaChart({ data, keys = ["home", "away"], height = 200 }: { data: Record<string, unknown>[]; keys?: string[]; height?: number }) {
  const colors = ["oklch(0.72 0.19 240)", "oklch(0.66 0.25 295)"];
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
        <defs>
          {keys.map((k, i) => (
            <linearGradient key={k} id={`g-${k}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={colors[i]} stopOpacity={0.5} />
              <stop offset="100%" stopColor={colors[i]} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid {...grid} /><XAxis dataKey="t" {...axis} /><YAxis {...axis} />
        <Tooltip contentStyle={tooltipStyle} />
        {keys.map((k, i) => <Area key={k} type="monotone" dataKey={k} stroke={colors[i]} strokeWidth={2} fill={`url(#g-${k})`} />)}
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function HelixBarChart({ data, dataKey, height = 180, refLine }: { data: Record<string, unknown>[]; dataKey: string; height?: number; refLine?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 10, left: -20, bottom: 0 }}>
        <CartesianGrid {...grid} />
        <XAxis dataKey={Object.keys(data[0] || { x: "" })[0]} {...axis} />
        <YAxis {...axis} />
        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "oklch(0.72 0.19 240 / 0.1)" }} />
        <Bar dataKey={dataKey} radius={[4, 4, 0, 0]}>
          {data.map((d, i) => <Cell key={i} fill={refLine !== undefined && (d[dataKey] as number) >= refLine ? "oklch(0.74 0.18 155)" : "oklch(0.62 0.24 22)"} />)}
        </Bar>
        {refLine !== undefined && <ReferenceLine y={refLine} stroke="oklch(0.72 0.19 240)" strokeDasharray="4 4" />}
      </BarChart>
    </ResponsiveContainer>
  );
}

export function HelixLineChart({ data, keys, height = 200 }: { data: Record<string, unknown>[]; keys: string[]; height?: number }) {
  const colors = ["oklch(0.72 0.19 240)", "oklch(0.66 0.25 295)", "oklch(0.74 0.18 155)", "oklch(0.82 0.17 80)"];
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 10, left: -20, bottom: 0 }}>
        <CartesianGrid {...grid} />
        <XAxis dataKey={Object.keys(data[0] || { d: "" })[0]} {...axis} />
        <YAxis {...axis} />
        <Tooltip contentStyle={tooltipStyle} />
        {keys.map((k, i) => <Line key={k} type="monotone" dataKey={k} stroke={colors[i % colors.length]} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />)}
      </LineChart>
    </ResponsiveContainer>
  );
}

export function HelixRadarChart({ data, height = 240 }: { data: Record<string, unknown>[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <RadarChart data={data}>
        <PolarGrid stroke="oklch(0.3 0.03 265 / 0.5)" />
        <PolarAngleAxis dataKey="metric" tick={{ fill: "oklch(0.7 0.02 260)", fontSize: 11 }} />
        <Tooltip contentStyle={tooltipStyle} />
        <Radar name="Home" dataKey="home" stroke="oklch(0.72 0.19 240)" fill="oklch(0.72 0.19 240)" fillOpacity={0.35} />
        <Radar name="Away" dataKey="away" stroke="oklch(0.66 0.25 295)" fill="oklch(0.66 0.25 295)" fillOpacity={0.3} />
      </RadarChart>
    </ResponsiveContainer>
  );
}

// HitRateChart — the signature player-prop graph: a bar per recent game showing
// the player's actual stat value, colored green when it cleared the prop line
// (hit) and red when it didn't, with a dashed reference line at the prop line.
// Optionally overlays a secondary stat as a purple line on a right-hand axis,
// mirroring the Buckets-to-Bucks "secondary stat overlay" feature.
export function HitRateChart({
  data, line, overlayKey, overlayLabel, height = 240,
}: {
  data: { g: string; value: number; overlay?: number }[];
  line: number;
  overlayKey?: string;
  overlayLabel?: string;
  height?: number;
}) {
  const HIT = "oklch(0.74 0.18 155)";   // emerald
  const MISS = "oklch(0.62 0.24 22)";   // crimson
  const OVERLAY = "oklch(0.66 0.25 295)"; // helix purple
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 16, right: overlayKey ? 4 : 10, left: -18, bottom: 0 }}>
        <CartesianGrid {...grid} />
        <XAxis dataKey="g" {...axis} />
        <YAxis yAxisId="left" {...axis} />
        {overlayKey && <YAxis yAxisId="right" orientation="right" {...axis} />}
        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "oklch(0.72 0.19 240 / 0.08)" }} />
        <Bar yAxisId="left" dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={34}>
          {data.map((d, i) => <Cell key={i} fill={d.value >= line ? HIT : MISS} />)}
          <LabelList dataKey="value" position="top" style={{ fill: "oklch(0.7 0.02 260)", fontSize: 9, fontFamily: "JetBrains Mono" }} />
        </Bar>
        {overlayKey && (
          <Line yAxisId="right" type="monotone" dataKey="overlay" name={overlayLabel ?? overlayKey}
            stroke={OVERLAY} strokeWidth={2} dot={{ r: 2.5, fill: OVERLAY }} activeDot={{ r: 4 }} />
        )}
        <ReferenceLine yAxisId="left" y={line} stroke="oklch(0.72 0.19 240)" strokeDasharray="5 4"
          label={{ value: `Line ${line}`, position: "insideTopRight", fill: "oklch(0.72 0.19 240)", fontSize: 10 }} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

// EVBars — horizontal ranked bars for +EV / edge percentages.
export function EVBars({ data, height = 260 }: { data: { name: string; ev: number }[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart layout="vertical" data={data} margin={{ top: 4, right: 24, left: 8, bottom: 0 }}>
        <CartesianGrid {...grid} horizontal={false} />
        <XAxis type="number" {...axis} unit="%" />
        <YAxis type="category" dataKey="name" {...axis} width={120} />
        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "oklch(0.74 0.18 155 / 0.08)" }} formatter={(v: number) => [`${v}%`, "EV"]} />
        <Bar dataKey="ev" radius={[0, 4, 4, 0]} maxBarSize={18}>
          {data.map((d, i) => <Cell key={i} fill={d.ev >= 0 ? "oklch(0.74 0.18 155)" : "oklch(0.62 0.24 22)"} />)}
          <LabelList dataKey="ev" position="right" formatter={(v: number) => `${v > 0 ? "+" : ""}${v}%`} style={{ fill: "oklch(0.7 0.02 260)", fontSize: 10, fontFamily: "JetBrains Mono" }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function ConfidenceMeter({ value, label }: { value: number; label?: string }) {
  return (
    <div className="space-y-1.5">
      {label && <div className="flex justify-between text-[10px] uppercase tracking-wider text-muted-foreground"><span>{label}</span><span className="font-mono-display text-foreground">{value}%</span></div>}
      <div className="h-1.5 rounded-full bg-muted/40 overflow-hidden">
        <div className="h-full bg-gradient-helix rounded-full transition-all" style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}
