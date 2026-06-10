-- Make Property <-> Deal navigation direct: add a property_id FK to deal_leads
-- (deals previously linked to a property only indirectly through seller_leads).
-- Backfill from the existing seller_lead -> property linkage. Additive, no data loss.

alter table public.deal_leads
  add column if not exists property_id uuid references public.properties(id);

update public.deal_leads d
set property_id = s.property_id
from public.seller_leads s
where d.seller_lead_id = s.id
  and d.property_id is null
  and s.property_id is not null;

create index if not exists deal_leads_property_id_idx on public.deal_leads(property_id);
