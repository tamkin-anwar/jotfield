create table public.note_shares (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  ciphertext text not null check (char_length(ciphertext) between 1 and 2000000),
  nonce text not null check (char_length(nonce) between 12 and 64),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_at > created_at)
);

create index note_shares_owner_updated_idx on public.note_shares (owner_id, updated_at desc);
create index note_shares_expiry_idx on public.note_shares (expires_at) where revoked_at is null;

alter table public.note_shares enable row level security;

create policy "owners create private links" on public.note_shares
for insert to authenticated with check (
  owner_id = auth.uid()
  and expires_at > now()
  and expires_at <= now() + interval '30 days'
);
create policy "owners view private links" on public.note_shares
for select to authenticated using (owner_id = auth.uid());
create policy "owners update private links" on public.note_shares
for update to authenticated using (owner_id = auth.uid()) with check (
  owner_id = auth.uid()
  and expires_at > now()
  and expires_at <= now() + interval '30 days'
);

revoke all on public.note_shares from anon, authenticated;
grant select, insert, update on public.note_shares to authenticated;

create or replace function public.read_note_share(share_id uuid)
returns table (ciphertext text, nonce text, updated_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select share.ciphertext, share.nonce, share.updated_at
  from public.note_shares as share
  where share.id = share_id
    and share.revoked_at is null
    and share.expires_at > now()
  limit 1;
$$;

revoke execute on function public.read_note_share(uuid) from public;
grant execute on function public.read_note_share(uuid) to anon, authenticated;
