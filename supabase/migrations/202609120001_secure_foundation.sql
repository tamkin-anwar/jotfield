create extension if not exists pgcrypto;

create type public.workspace_role as enum ('owner', 'editor', 'commenter', 'viewer');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  created_by uuid not null references auth.users(id) on delete cascade,
  key_version integer not null default 1 check (key_version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.workspace_role not null,
  joined_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table public.devices (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  public_key text not null,
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.workspace_keys (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id uuid not null references public.devices(id) on delete cascade,
  key_version integer not null check (key_version > 0),
  wrapped_key text not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, device_id, key_version)
);

create table public.notes (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  author_id uuid references auth.users(id) on delete set null,
  ciphertext text not null,
  nonce text not null,
  key_version integer not null check (key_version > 0),
  content_version bigint not null default 1 check (content_version > 0),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.sync_operations (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  note_id uuid references public.notes(id) on delete cascade,
  operation_kind text not null check (char_length(operation_kind) between 1 and 60),
  encrypted_payload text not null,
  client_created_at timestamptz not null,
  server_created_at timestamptz not null default now()
);

create index notes_workspace_updated_idx on public.notes (workspace_id, updated_at desc);
create index sync_operations_workspace_created_idx on public.sync_operations (workspace_id, server_created_at);
create index workspace_members_user_idx on public.workspace_members (user_id, workspace_id);

create or replace function public.is_workspace_member(target_workspace uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = target_workspace and user_id = auth.uid()
  );
$$;

create or replace function public.can_edit_workspace(target_workspace uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = target_workspace
      and user_id = auth.uid()
      and role in ('owner', 'editor')
  );
$$;

create or replace function public.is_workspace_owner(target_workspace uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = target_workspace
      and user_id = auth.uid()
      and role = 'owner'
  );
$$;

create or replace function public.create_workspace(workspace_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_workspace_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if char_length(trim(workspace_name)) not between 1 and 80 then
    raise exception 'Workspace name must contain 1 to 80 characters';
  end if;

  insert into public.workspaces (name, created_by)
  values (trim(workspace_name), auth.uid())
  returning id into new_workspace_id;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (new_workspace_id, auth.uid(), 'owner');

  return new_workspace_id;
end;
$$;

alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.devices enable row level security;
alter table public.workspace_keys enable row level security;
alter table public.notes enable row level security;
alter table public.sync_operations enable row level security;

create policy "profiles are visible to their owner" on public.profiles
for select using (id = auth.uid());
create policy "profiles are editable by their owner" on public.profiles
for all using (id = auth.uid()) with check (id = auth.uid());

create policy "members can view workspaces" on public.workspaces
for select using (public.is_workspace_member(id));
create policy "users can create workspaces" on public.workspaces
for insert with check (created_by = auth.uid());
create policy "owners can update workspaces" on public.workspaces
for update using (public.is_workspace_owner(id));

create policy "members can view membership" on public.workspace_members
for select using (public.is_workspace_member(workspace_id));
create policy "owners can manage membership" on public.workspace_members
for all using (public.is_workspace_owner(workspace_id))
with check (public.is_workspace_owner(workspace_id));

create policy "users manage their devices" on public.devices
for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "users read their wrapped keys" on public.workspace_keys
for select using (user_id = auth.uid() and public.is_workspace_member(workspace_id));
create policy "editors create wrapped keys" on public.workspace_keys
for insert with check (public.can_edit_workspace(workspace_id));
create policy "owners remove wrapped keys" on public.workspace_keys
for delete using (public.is_workspace_owner(workspace_id));

create policy "members read encrypted notes" on public.notes
for select using (public.is_workspace_member(workspace_id));
create policy "editors create encrypted notes" on public.notes
for insert with check (author_id = auth.uid() and public.can_edit_workspace(workspace_id));
create policy "editors update encrypted notes" on public.notes
for update using (public.can_edit_workspace(workspace_id))
with check (public.can_edit_workspace(workspace_id));
create policy "editors delete encrypted notes" on public.notes
for delete using (public.can_edit_workspace(workspace_id));

create policy "members read encrypted operations" on public.sync_operations
for select using (public.is_workspace_member(workspace_id));
create policy "editors append encrypted operations" on public.sync_operations
for insert with check (actor_id = auth.uid() and public.can_edit_workspace(workspace_id));

revoke all on all tables in schema public from anon;
grant select, insert, update, delete on public.profiles, public.workspaces, public.workspace_members,
  public.devices, public.workspace_keys, public.notes, public.sync_operations to authenticated;
revoke execute on function public.is_workspace_member(uuid) from public, anon;
revoke execute on function public.can_edit_workspace(uuid) from public, anon;
revoke execute on function public.is_workspace_owner(uuid) from public, anon;
revoke execute on function public.create_workspace(text) from public, anon;
grant execute on function public.is_workspace_member(uuid) to authenticated;
grant execute on function public.can_edit_workspace(uuid) to authenticated;
grant execute on function public.is_workspace_owner(uuid) to authenticated;
grant execute on function public.create_workspace(text) to authenticated;
