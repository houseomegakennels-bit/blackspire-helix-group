-- Disposable canonical-shaped fixture. No production rows or credentials.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as
$$select nullif(current_setting('fixture.user_id',true),'')::uuid$$;
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;
create table public."SearchJob" (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id),
 state text not null,county text not null,property_type text not null,
 date_range_start date,date_range_end date,min_purchases integer default 1,
 cash_buyers_only boolean default false,llc_buyers_only boolean default false,
 status text default 'pending',total_sales_analyzed integer,total_buyers_found integer,error_message text,
 created_at timestamptz default now(),updated_at timestamptz default now()
);
create table public."RawSale" (
 id uuid primary key default gen_random_uuid(),search_job_id uuid references public."SearchJob"(id),
 buyer_name text,seller_name text,property_address text,mailing_address text,county text,state text,
 sale_price numeric,sale_date date,property_type text,parcel_id text,deed_type text,lender_name text,
 created_at timestamptz default now()
);
create table public."CleanSale" (like public."RawSale" including all);
alter table public."CleanSale" add foreign key(search_job_id) references public."SearchJob"(id);
create table public."BuyerProfile" (
 id uuid primary key default gen_random_uuid(),buyer_name text not null,mailing_address text,county text,state text,
 is_llc boolean default false,is_cash_buyer boolean default false,purchase_count integer default 0,total_spend numeric default 0,
 first_purchase_date date,last_purchase_date date,property_types text[],score integer default 0,score_breakdown jsonb,
 parcel_ids text[],updated_at timestamptz default now(),created_at timestamptz default now(),unique(buyer_name,mailing_address)
);
create table public."BuyerReport" (
 id uuid primary key default gen_random_uuid(),search_job_id uuid references public."SearchJob"(id),
 buyer_profile_id uuid references public."BuyerProfile"(id),buyer_name_snapshot text,mailing_address_snapshot text,
 score integer,purchase_count integer,total_spend numeric,is_llc boolean,is_cash_buyer boolean,created_at timestamptz default now()
);
alter table public."SearchJob" enable row level security;
alter table public."RawSale" enable row level security;
alter table public."CleanSale" enable row level security;
alter table public."BuyerProfile" enable row level security;
alter table public."BuyerReport" enable row level security;
grant select,insert,update on public."SearchJob" to authenticated;
create policy user_read_own_search_jobs on public."SearchJob" for select to authenticated using(user_id=auth.uid());
-- Real fixture starts with unsafe browser grants, then applies the exact reviewed migration.
grant all on public."SearchJob",public."RawSale",public."CleanSale",public."BuyerProfile",public."BuyerReport" to anon,service_role;
grant all on public."RawSale",public."CleanSale",public."BuyerProfile",public."BuyerReport" to authenticated;
insert into auth.users values ('00000000-0000-4000-8000-000000000001'),('00000000-0000-4000-8000-000000000002');
