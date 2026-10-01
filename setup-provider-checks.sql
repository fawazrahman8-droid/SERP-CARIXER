create table public.provider_checks (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references public.companies(id),
 requested_by uuid not null references auth.users(id),
 keyword_id uuid not null references public.keywords(id),
 market_id uuid not null references public.markets(id),
 slot bigint not null,
 created_at timestamptz not null default now(),
 result jsonb,
 unique(company_id,slot)
);
alter table public.provider_checks enable row level security;
revoke all on public.provider_checks from anon,authenticated;
grant select on public.provider_checks to authenticated;
grant all on public.provider_checks to service_role;
create policy provider_checks_member_read on public.provider_checks for select to authenticated using (
 exists(select 1 from public.company_members m where m.company_id=provider_checks.company_id and m.user_id=(select auth.uid()))
);