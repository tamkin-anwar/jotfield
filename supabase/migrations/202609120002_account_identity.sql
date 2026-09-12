create or replace function public.handle_new_account()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  workspace_id uuid;
  account_name text;
begin
  account_name := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
    nullif(split_part(new.email, '@', 1), ''),
    'Jotfield member'
  );

  insert into public.profiles (id, display_name)
  values (new.id, left(account_name, 80));

  insert into public.workspaces (name, created_by)
  values ('Personal', new.id)
  returning id into workspace_id;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (workspace_id, new.id, 'owner');

  return new;
end;
$$;

create trigger create_jotfield_account
after insert on auth.users
for each row execute function public.handle_new_account();

revoke execute on function public.handle_new_account() from public, anon, authenticated;
