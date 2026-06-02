import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Panel, PanelHeader, Pill, SectionTitle } from "@/components/oracle/Primitives";
import { API_BASE } from "@/lib/api";
import { Sparkles, Send, ChevronDown, Brain, Activity, BarChart2, Shield, FlaskConical, TrendingUp, Zap, Target, Clock } from "lucide-react";

export const Route = createFileRoute("/_app/ai")({ component: AiPage });

const AGENTS = [
  { id: "market_analyst", label: "Market Analyst", icon: BarChart2, color: "text-neon", description: "Line movement, sharp action, +EV spots" },
  { id: "injury_scout", label: "Injury Scout", icon: Shield, color: "text-crimson", description: "Impact analysis, lineup risk assessment" },
  { id: "prop_hunter", label: "Prop Hunter", icon: Target, color: "text-emerald", description: "Player props with hit-rate context" },
  { id: "matchup_analyst", label: "Matchup Analyst", icon: Activity, color: "text-helix", description: "Head-to-head edges, situational trends" },
  { id: "simulation_engine", label: "Simulation Engine", icon: FlaskConical, color: "text-neon", description: "Monte Carlo probability modeling" },
  { id: "sharp_tracker", label: "Sharp Tracker", icon: TrendingUp, color: "text-amber-400", description: "Steam moves, reverse line movement" },
  { id: "weather_analyst", label: "Weather Analyst", icon: Zap, color: "text-sky-400", description: "Outdoor game impact analysis" },
  { id: "historical_analyst", label: "Historical Analyst", icon: Clock, color: "text-helix", description: "Trends, ATS records, situational data" },
];

const QUICK_PROMPTS = [
  "What are today's best +EV plays across all sports?",
  "Analyze the sharp money flow on today's MLB games.",
  "Which players have the best prop value tonight?",
  "Give me a Monte Carlo win probability for ATL vs CIN.",
  "What injury news should I factor into tonight's slate?",
  "Identify any reverse line movement opportunities today.",
];

type Message = { role: "user" | "assistant"; content: string; agent?: string; ts: number };

function MarkdownLine({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);
  return (
    <>
      {parts.map((p, i) => {
        if (p.startsWith("**") && p.endsWith("**")) return <strong key={i} className="text-foreground font-semibold">{p.slice(2,-2)}</strong>;
        if (p.startsWith("*") && p.endsWith("*")) return <em key={i}>{p.slice(1,-1)}</em>;
        return p;
      })}
    </>
  );
}

function AssistantMessage({ content }: { content: string }) {
  const lines = content.split("\n");
  const nodes: React.ReactNode[] = [];
  let listBuf: string[] = [];
  const flush = () => {
    if (listBuf.length) { nodes.push(<ul key={nodes.length} className="mt-2 space-y-1 list-disc list-inside text-sm text-muted-foreground">{listBuf.map((l,i) => <li key={i}><MarkdownLine text={l} /></li>)}</ul>); listBuf = []; }
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { flush(); continue; }
    if (line.startsWith("## ")) { flush(); nodes.push(<h3 key={nodes.length} className="mt-4 text-sm font-bold text-foreground border-t border-border/30 pt-3">{line.slice(3)}</h3>); continue; }
    if (line.startsWith("### ")) { flush(); nodes.push(<h4 key={nodes.length} className="mt-3 text-xs font-semibold uppercase tracking-wider text-primary/80">{line.slice(4)}</h4>); continue; }
    if (line.startsWith("- ") || line.startsWith("* ")) { listBuf.push(line.slice(2)); continue; }
    flush();
    nodes.push(<p key={nodes.length} className="mt-2 text-sm text-muted-foreground leading-relaxed"><MarkdownLine text={line} /></p>);
  }
  flush();
  return <div className="mt-1">{nodes}</div>;
}

function AiPage() {
  const [selectedAgent, setSelectedAgent] = useState(AGENTS[0]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || loading) return;
    setInput("");
    const userMsg: Message = { role: "user", content: q, ts: Date.now() };
    setMessages(prev => [...prev, userMsg]);
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/ai/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q, agentType: selectedAgent.id, sport: "ALL" }),
      });
      const data = await res.json();
      const reply = data.analysis ?? data.result ?? data.message ?? JSON.stringify(data);
      setMessages(prev => [...prev, { role: "assistant", content: reply, agent: selectedAgent.label, ts: Date.now() }]);
    } catch (e) {
      setMessages(prev => [...prev, { role: "assistant", content: "Network error — could not reach the Oracle Helix AI engine. Check that the backend is online.", agent: selectedAgent.label, ts: Date.now() }]);
    } finally {
      setLoading(false);
    }
  };

  const AgentIcon = selectedAgent.icon;

  return (
    <div className="space-y-6 flex flex-col h-full">
      <SectionTitle eyebrow="AI Agent" title="Oracle Helix AI" description="10 specialized sports analysts powered by Claude Sonnet." />

      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-4 flex-1">
        {/* Agent Selector */}
        <div className="space-y-2">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground px-1 mb-3">Choose Analyst</div>
          {AGENTS.map(agent => {
            const Icon = agent.icon;
            const active = selectedAgent.id === agent.id;
            return (
              <button key={agent.id} onClick={() => setSelectedAgent(agent)}
                className={`w-full text-left flex items-start gap-3 px-3 py-2.5 rounded-xl border transition ${active ? "glass-strong border-primary/30 bg-primary/8" : "border-border/30 hover:bg-muted/20"}`}>
                <Icon className={`size-4 mt-0.5 shrink-0 ${active ? agent.color : "text-muted-foreground"}`} />
                <div className="min-w-0">
                  <div className={`text-xs font-semibold ${active ? "text-foreground" : "text-muted-foreground"}`}>{agent.label}</div>
                  <div className="text-[10px] text-muted-foreground/60 leading-tight mt-0.5">{agent.description}</div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Chat */}
        <Panel className="flex flex-col !p-0 overflow-hidden min-h-[480px]">
          {/* Header */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-border/30">
            <div className={`size-8 rounded-lg bg-primary/10 grid place-items-center ${selectedAgent.color}`}>
              <AgentIcon className="size-4" />
            </div>
            <div>
              <div className="text-sm font-semibold">{selectedAgent.label}</div>
              <div className="text-[10px] text-muted-foreground">{selectedAgent.description}</div>
            </div>
            <div className="ml-auto">
              <Pill tone="neon">Active</Pill>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-6 py-8">
                <div className="size-16 rounded-2xl bg-gradient-helix grid place-items-center">
                  <Brain className="size-8 text-background" />
                </div>
                <div className="text-center">
                  <p className="font-medium">Ask {selectedAgent.label}</p>
                  <p className="text-sm text-muted-foreground mt-1">{selectedAgent.description}</p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-xl">
                  {QUICK_PROMPTS.slice(0,4).map(p => (
                    <button key={p} onClick={() => send(p)}
                      className="text-left text-[11px] text-muted-foreground glass rounded-lg px-3 py-2 border border-border/30 hover:border-primary/30 hover:text-foreground transition line-clamp-2">
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((m, i) => (
                <div key={i} className={`flex gap-3 ${m.role === "user" ? "flex-row-reverse" : ""}`}>
                  <div className={`size-7 rounded-lg grid place-items-center shrink-0 ${m.role === "user" ? "bg-primary/20" : "bg-gradient-helix"}`}>
                    {m.role === "user" ? <span className="text-[10px] font-bold text-primary">G</span> : <Sparkles className="size-3.5 text-background" />}
                  </div>
                  <div className={`flex-1 max-w-[85%] rounded-xl px-4 py-3 text-sm ${m.role === "user" ? "glass ml-auto text-right" : "glass"}`}>
                    {m.role === "assistant" && m.agent && (
                      <div className="text-[10px] uppercase tracking-wider text-primary/70 mb-1">{m.agent}</div>
                    )}
                    {m.role === "assistant" ? <AssistantMessage content={m.content} /> : <p>{m.content}</p>}
                  </div>
                </div>
              ))
            )}
            {loading && (
              <div className="flex gap-3">
                <div className="size-7 rounded-lg grid place-items-center shrink-0 bg-gradient-helix">
                  <Sparkles className="size-3.5 text-background animate-pulse" />
                </div>
                <div className="glass rounded-xl px-4 py-3">
                  <div className="flex gap-1 items-center h-5">
                    <span className="size-1.5 rounded-full bg-primary animate-bounce [animation-delay:0ms]" />
                    <span className="size-1.5 rounded-full bg-primary animate-bounce [animation-delay:150ms]" />
                    <span className="size-1.5 rounded-full bg-primary animate-bounce [animation-delay:300ms]" />
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Quick prompts strip */}
          {messages.length > 0 && (
            <div className="px-4 pb-2 flex gap-1.5 overflow-x-auto">
              {QUICK_PROMPTS.slice(0,3).map(p => (
                <button key={p} onClick={() => send(p)} disabled={loading}
                  className="shrink-0 text-[10px] text-muted-foreground border border-border/30 rounded-lg px-2.5 py-1 hover:border-primary/30 hover:text-foreground transition whitespace-nowrap disabled:opacity-40">
                  {p.length > 40 ? p.slice(0,40) + "…" : p}
                </button>
              ))}
            </div>
          )}

          {/* Input */}
          <div className="px-4 py-3 border-t border-border/30">
            <div className="flex gap-2">
              <input
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && !e.shiftKey && send(input)}
                placeholder={`Ask ${selectedAgent.label}…`}
                disabled={loading}
                className="flex-1 bg-muted/20 border border-border/40 rounded-xl px-4 py-2.5 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/40 focus:bg-muted/30 transition disabled:opacity-50"
              />
              <button onClick={() => send(input)} disabled={!input.trim() || loading}
                className="size-10 rounded-xl bg-gradient-helix grid place-items-center hover:opacity-90 transition disabled:opacity-30 disabled:cursor-not-allowed shrink-0">
                <Send className="size-4 text-background" />
              </button>
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}