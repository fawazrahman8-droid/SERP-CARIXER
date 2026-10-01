-- Preserve provider audit records when a user deletes/replaces tracked data.
-- Run once on installations created with setup-provider-checks.sql.
begin;
alter table public.provider_checks add column subject jsonb;
update public.provider_checks p
set subject = jsonb_build_object('keyword_id',k.id,'keyword',k.keyword,
 'market_id',m.id,'market',m.name,'domain',c.domain)
from public.keywords k, public.markets m, public.companies c
where k.id=p.keyword_id and m.id=p.market_id and c.id=p.company_id
 and k.company_id=p.company_id and m.company_id=p.company_id and k.market_id=m.id;
alter table public.provider_checks alter column subject set not null;

create function public.snapshot_provider_check_subject()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
 select jsonb_build_object('keyword_id',k.id,'keyword',k.keyword,
  'market_id',m.id,'market',m.name,'domain',c.domain)
 into new.subject
 from public.keywords k
 join public.markets m on m.id=k.market_id and m.company_id=k.company_id
 join public.companies c on c.id=k.company_id
 where k.id=new.keyword_id and m.id=new.market_id and c.id=new.company_id;
 if new.subject is null then
  raise exception 'Provider keyword and market must belong to the selected company' using errcode='23514';
 end if;
 return new;
end;
$$;
revoke all on function public.snapshot_provider_check_subject() from public, anon, authenticated;
grant execute on function public.snapshot_provider_check_subject() to service_role;
create trigger provider_check_subject_before_insert
before insert on public.provider_checks
for each row execute function public.snapshot_provider_check_subject();

alter table public.provider_checks
 alter column keyword_id drop not null,
 alter column market_id drop not null,
 drop constraint provider_checks_keyword_id_fkey,
 drop constraint provider_checks_market_id_fkey;
alter table public.provider_checks
 add constraint provider_checks_keyword_id_fkey foreign key (keyword_id)
 references public.keywords(id) on delete set null,
 add constraint provider_checks_market_id_fkey foreign key (market_id)
 references public.markets(id) on delete set null;
-- Keep company_id, membership-based RLS, and client read-only privileges intact.
commit;

