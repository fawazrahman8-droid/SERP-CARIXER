-- Applied to the live database; one-time company expansion.
alter table public.companies drop constraint companies_slug_check;
alter table public.companies add constraint companies_slug_check check(slug in ('carwash','ecowide','carixer','deliboo'));
do $$
declare owner_id uuid; owner_count integer;
begin
 select count(*), (array_agg(u.id))[1] into owner_count,owner_id
 from auth.users u where u.email_confirmed_at is not null
 and exists(select 1 from public.company_members m join public.companies c on c.id=m.company_id where m.user_id=u.id and m.role='owner' and c.slug='carwash')
 and exists(select 1 from public.company_members m join public.companies c on c.id=m.company_id where m.user_id=u.id and m.role='owner' and c.slug='ecowide');
 if owner_count<>1 then raise exception 'Expected one verified shared administrator'; end if;
 update public.companies set domain='ecowideme.com' where slug='ecowide' and domain='ecowide.com';
 insert into public.companies(slug,name,domain) values ('carixer','CARIXER','carixer.com'),('deliboo','DELIBOO','deliboo.com');
 insert into public.company_members(company_id,user_id,role)
 select id,owner_id,'owner' from public.companies where slug in ('carixer','deliboo');
end;
$$;