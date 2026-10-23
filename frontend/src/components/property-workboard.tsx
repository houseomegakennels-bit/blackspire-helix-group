"use client";

import Link from "next/link";
import { useId, useMemo, useState } from "react";
import { filterWorkboardProperties, type PropertyWorkboard as Workboard } from "@/lib/property-workboard-model";
import { readableNextStep } from "@/lib/property-client-guidance";

export function PropertyWorkboard({ board }: { board: Workboard }) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [stage, setStage] = useState("");
  const [county, setCounty] = useState("");
  const [queueFilter, setQueueFilter] = useState("actionable");
  const [owner, setOwner] = useState("");
  const [shown, setShown] = useState(24);
  const [tasksShown, setTasksShown] = useState(12);
  const properties = useMemo(() => filterWorkboardProperties(board.properties, { query, stage, county }), [board.properties, query, stage, county]);
  const propertyIds = useMemo(() => new Set(properties.map(property => property.id)), [properties]);
  const items = board.items.filter(item => propertyIds.has(item.dealId) && (!owner || item.owner === owner)
    && (queueFilter === "all" || queueFilter === "actionable" && (item.urgency === "overdue" || item.urgency === "today" || item.blocker || item.urgency === "unscheduled")
      || queueFilter === "waiting" && item.blocker || queueFilter === item.urgency));
  const stages = [...new Set(board.properties.map(property => property.status))].sort();
  const counties = [...new Set(board.properties.map(property => property.county))].sort();
  const owners = [...new Set(board.items.map(item => item.owner))].sort();
  const fieldClass = "min-h-11 w-full min-w-0 rounded-xl border border-[var(--line)] bg-transparent px-3 py-3 text-base";
  if (!board.available) return <section aria-labelledby={`${id}-today`} className="brand-card p-5"><h2 id={`${id}-today`} className="text-2xl font-semibold">Today</h2><p role="status" className="mt-3 leading-7">{board.reason}</p></section>;
  return <section className="space-y-6" aria-labelledby={`${id}-today`}>
    <div className="brand-card p-5 sm:p-6">
      <h2 id={`${id}-today`} className="text-2xl font-semibold">Today</h2>
      <p className="mt-2 text-sm leading-6 text-[var(--copy-soft)]">Prioritized across all {board.properties.length} authorized properties. Dates and owners come from saved tasks, title, closing and payment trackers; missing dates remain unscheduled. Today: {board.today}, Eastern time.</p>
      <form className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3" onSubmit={event => event.preventDefault()} aria-label="Search and filter all properties">
        <label className="grid min-w-0 gap-2 text-sm" htmlFor={`${id}-search`}>Search properties<input id={`${id}-search`} type="search" className={fieldClass} value={query} onChange={event => { setQuery(event.target.value); setShown(24); setTasksShown(12); }} placeholder="Address, property ID, seller or county" /></label>
        <label className="grid min-w-0 gap-2 text-sm" htmlFor={`${id}-stage`}>Stage<select id={`${id}-stage`} className={fieldClass} value={stage} onChange={event => { setStage(event.target.value); setShown(24); }}><option value="">All stages</option>{stages.map(value => <option key={value}>{value}</option>)}</select></label>
        <label className="grid min-w-0 gap-2 text-sm" htmlFor={`${id}-county`}>County<select id={`${id}-county`} className={fieldClass} value={county} onChange={event => { setCounty(event.target.value); setShown(24); }}><option value="">All counties</option>{counties.map(value => <option key={value}>{value}</option>)}</select></label>
        <label className="grid min-w-0 gap-2 text-sm" htmlFor={`${id}-queue`}>Task view<select id={`${id}-queue`} className={fieldClass} value={queueFilter} onChange={event => { setQueueFilter(event.target.value); setTasksShown(12); }}><option value="actionable">Today, overdue and needs attention</option><option value="all">All open tasks</option><option value="overdue">Overdue</option><option value="today">Due today</option><option value="upcoming">Upcoming</option><option value="waiting">Waiting or blocked</option><option value="unscheduled">No verified due date</option></select></label>
        <label className="grid min-w-0 gap-2 text-sm" htmlFor={`${id}-owner`}>Task owner<select id={`${id}-owner`} className={fieldClass} value={owner} onChange={event => { setOwner(event.target.value); setTasksShown(12); }}><option value="">All owners</option>{owners.map(value => <option key={value}>{value}</option>)}</select></label>
        <button type="button" className="brand-button min-h-11 self-end px-4 py-3 text-sm" onClick={() => { setQuery(""); setStage(""); setCounty(""); setQueueFilter("actionable"); setOwner(""); setShown(24); setTasksShown(12); }}>Clear filters</button>
      </form>
      <p className="mt-4 text-sm" role="status" aria-live="polite">{items.length} open tasks match this view · {properties.length} properties match your search.</p>
      <ul className="mt-4 grid list-none gap-3 p-0 lg:grid-cols-2">
        {items.slice(0, tasksShown).map(item => <li key={item.id} className="rounded-xl border border-[var(--line)] p-4">
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm font-semibold"><span>{item.urgency === "overdue" ? "Overdue" : item.urgency === "today" ? "Due today" : item.urgency === "upcoming" ? "Upcoming" : "Unscheduled"}</span><span>{item.status}</span></div>
          <h3 className="mt-2 break-words text-lg font-semibold">{readableNextStep(item.title)}</h3><p className="mt-1 break-words text-sm leading-6">{item.address} · {item.dealId}</p>
          <p className="mt-2 text-sm leading-6">Owner: {item.owner}<br />Due: {item.dateIssue ? "Saved date is invalid — review it" : item.dueAt ? <time dateTime={item.dueAt}>{item.dueAt.replace("T", " ")}</time> : "No date recorded"}<br />Source: {item.source}</p>
          {item.blocker ? <p className="mt-2 break-words text-sm leading-6"><strong>Blocker: </strong>{item.blocker}</p> : null}
          <Link href={item.href} className="brand-button mt-3 inline-flex min-h-11 items-center px-4 py-3 text-sm" aria-label={`Review ${item.title} for ${item.address}`}>Open task in property</Link>
        </li>)}
      </ul>
      {!items.length ? <p className="mt-4 text-sm leading-6">No open tasks match these filters. Choose All open tasks to include future work.</p> : null}
      {items.length > tasksShown ? <button type="button" className="brand-button mt-4 min-h-11 px-4 py-3 text-sm" onClick={() => setTasksShown(value => value + 24)}>Show more tasks ({items.length - tasksShown} remaining)</button> : null}
    </div>
    <div id="workboard-properties" className="brand-card p-5 sm:p-6">
      <h2 className="text-2xl font-semibold">Find a property</h2><p className="mt-2 text-sm leading-6">Search above covers every authorized property, including completed records.</p>
      <ul className="mt-4 grid list-none gap-3 p-0 lg:grid-cols-2">{properties.slice(0, shown).map(property => <li key={property.id} className="min-w-0 rounded-xl border border-[var(--line)] p-4"><h3 className="break-words text-lg font-semibold">{property.address}</h3><p className="mt-1 break-words text-sm leading-6">{property.id} · {property.status}<br />{property.ownerName} · {property.county} County</p><Link href={`/workspace/deal-engine/${encodeURIComponent(property.id)}`} className="brand-button mt-3 inline-flex min-h-11 items-center px-4 py-3 text-sm" aria-label={`Open ${property.address}`}>Open property</Link></li>)}</ul>
      {!properties.length ? <p className="mt-4 text-sm leading-6">No properties match these filters.</p> : null}
      {properties.length > shown ? <button type="button" className="brand-button mt-4 min-h-11 px-4 py-3 text-sm" onClick={() => setShown(value => value + 24)}>Show more properties ({properties.length - shown} remaining)</button> : null}
    </div>
  </section>;
}
