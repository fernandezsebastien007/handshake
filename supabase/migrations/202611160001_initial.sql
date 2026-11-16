-- Apply to a Supabase project as postgres. No client can write connection state.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade default auth.uid(),
  username text not null unique check (username ~ '^[a-z0-9_]{3,24}$'),
  display_name text not null check (length(trim(display_name)) between 1 and 60),
  bio text not null default '' check (length(bio) <= 500),
  avatar_url text not null default '' check (avatar_url = '' or (avatar_url ~ '^https://' and length(avatar_url) <= 2048)),
  created_at timestamptz not null default now()
);
create table public.connections (
  id uuid primary key default gen_random_uuid(),
  user_low uuid not null references public.profiles(id) on delete cascade,
  user_high uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  check (user_low < user_high), unique (user_low, user_high)
);
create table public.handshake_invites (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz
);
create index invites_owner_time on public.handshake_invites(owner_id, created_at);
create table public.handshake_requests (
  id uuid primary key default gen_random_uuid(),
  inviter_id uuid not null references public.profiles(id) on delete cascade,
  invitee_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'expired')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  check (inviter_id <> invitee_id)
);
create unique index one_pending_pair on public.handshake_requests
  (least(inviter_id, invitee_id), greatest(inviter_id, invitee_id)) where status = 'pending';
create index requests_inviter on public.handshake_requests(inviter_id);
create index requests_invitee on public.handshake_requests(invitee_id);
create table public.connection_notes (
  owner_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  connection_id uuid not null references public.connections(id) on delete cascade,
  notes text not null default '' check (length(notes) <= 5000),
  tags text[] not null default '{}' check (cardinality(tags) <= 20 and length(array_to_string(tags, ',')) <= 500),
  primary key (owner_id, connection_id)
);
create table public.contact_methods (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  kind text not null check (kind in ('email', 'phone', 'link')),
  label text not null check (length(trim(label)) between 1 and 60),
  value text not null check (length(trim(value)) between 1 and 500),
  share_default boolean not null default false,
  check (kind <> 'link' or value ~ '^https://[^[:space:]]+$'),
  check (kind <> 'email' or value ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  check (kind <> 'phone' or value ~ '^\+?[0-9 ()-]{3,40}$')
);
create index contacts_owner on public.contact_methods(owner_id);
create table public.contact_overrides (
  contact_id uuid not null references public.contact_methods(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  allowed boolean not null,
  primary key (contact_id, recipient_id)
);
create index overrides_recipient on public.contact_overrides(recipient_id);

-- Definers only answer questions about the calling identity; fixed search paths.
create function private.connected_to(other_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.connections c where
    c.user_low = least(auth.uid(), other_id) and c.user_high = greatest(auth.uid(), other_id)
    and auth.uid() <> other_id);
$$;
create function private.member_of(connection uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.connections c where c.id = connection
    and auth.uid() in (c.user_low, c.user_high));
$$;
create function private.can_read_contact(contact uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.contact_methods m
    where m.id = contact and private.connected_to(m.owner_id)
    and coalesce((select o.allowed from public.contact_overrides o
      where o.contact_id = m.id and o.recipient_id = auth.uid()), m.share_default));
$$;

alter table public.profiles enable row level security;
alter table public.connections enable row level security;
alter table public.handshake_invites enable row level security;
alter table public.handshake_requests enable row level security;
alter table public.connection_notes enable row level security;
alter table public.contact_methods enable row level security;
alter table public.contact_overrides enable row level security;

create policy profile_read on public.profiles for select to authenticated
  using (id = auth.uid() or private.connected_to(id));
create policy profile_create on public.profiles for insert to authenticated with check (id = auth.uid());
create policy profile_edit on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy connections_read on public.connections for select to authenticated using (auth.uid() in (user_low, user_high));
create policy requests_read on public.handshake_requests for select to authenticated using (auth.uid() in (inviter_id, invitee_id));
-- Invites deliberately have no client table policies, even for their creator.
create policy notes_read on public.connection_notes for select to authenticated using (owner_id = auth.uid() and private.member_of(connection_id));
create policy notes_create on public.connection_notes for insert to authenticated with check (owner_id = auth.uid() and private.member_of(connection_id));
create policy notes_edit on public.connection_notes for update to authenticated using (owner_id = auth.uid() and private.member_of(connection_id)) with check (owner_id = auth.uid() and private.member_of(connection_id));
create policy notes_delete on public.connection_notes for delete to authenticated using (owner_id = auth.uid());
create policy contacts_read on public.contact_methods for select to authenticated using (owner_id = auth.uid() or private.can_read_contact(id));
create policy contacts_create on public.contact_methods for insert to authenticated with check (owner_id = auth.uid());
create policy contacts_edit on public.contact_methods for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy contacts_delete on public.contact_methods for delete to authenticated using (owner_id = auth.uid());
create policy overrides_read on public.contact_overrides for select to authenticated using (exists (select 1 from public.contact_methods m where m.id = contact_id and m.owner_id = auth.uid()));
create policy overrides_create on public.contact_overrides for insert to authenticated with check (private.connected_to(recipient_id) and exists (select 1 from public.contact_methods m where m.id = contact_id and m.owner_id = auth.uid()));
create policy overrides_edit on public.contact_overrides for update to authenticated using (exists (select 1 from public.contact_methods m where m.id = contact_id and m.owner_id = auth.uid())) with check (private.connected_to(recipient_id) and exists (select 1 from public.contact_methods m where m.id = contact_id and m.owner_id = auth.uid()));
create policy overrides_delete on public.contact_overrides for delete to authenticated using (exists (select 1 from public.contact_methods m where m.id = contact_id and m.owner_id = auth.uid()));

create function public.create_invite() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare raw_token text; deadline timestamptz := now() + interval '10 minutes';
begin
  if auth.uid() is null or not exists(select 1 from public.profiles where id = auth.uid()) then
    raise exception 'Complete your profile first.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 1));
  if (select count(*) from public.handshake_invites where owner_id = auth.uid() and created_at > now() - interval '1 hour') >= 20 then
    raise exception 'Please wait before creating another Handshake.';
  end if;
  update public.handshake_invites set consumed_at = now() where owner_id = auth.uid() and consumed_at is null;
  raw_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.handshake_invites(owner_id, token_hash, expires_at)
    values(auth.uid(), encode(extensions.digest(raw_token, 'sha256'), 'hex'), deadline);
  return jsonb_build_object('token', raw_token, 'expires_at', deadline);
end;
$$;

create function public.preview_invite(raw_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if auth.uid() is null or raw_token !~ '^[0-9a-f]{64}$' then raise exception 'Handshake unavailable.'; end if;
  select jsonb_build_object('username', p.username, 'display_name', p.display_name, 'expires_at', i.expires_at)
    into result from public.handshake_invites i join public.profiles p on p.id = i.owner_id
    where i.token_hash = encode(extensions.digest(raw_token, 'sha256'), 'hex')
      and i.expires_at > now() and i.consumed_at is null and i.owner_id <> auth.uid()
      and not private.connected_to(i.owner_id);
  if result is null then raise exception 'Handshake unavailable. Ask for a fresh link.'; end if;
  return result;
end;
$$;

create function public.claim_invite(raw_token text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare invitation public.handshake_invites; request_id uuid;
begin
  if auth.uid() is null or raw_token !~ '^[0-9a-f]{64}$'
    or not exists(select 1 from public.profiles where id = auth.uid()) then raise exception 'Handshake unavailable.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 1));
  select * into invitation from public.handshake_invites where token_hash = encode(extensions.digest(raw_token, 'sha256'), 'hex') for update;
  if invitation.id is null or invitation.expires_at <= now() or invitation.consumed_at is not null or invitation.owner_id = auth.uid() then
    raise exception 'Handshake unavailable. Ask for a fresh link.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(least(invitation.owner_id, auth.uid())::text || greatest(invitation.owner_id, auth.uid())::text, 2));
  if private.connected_to(invitation.owner_id) then raise exception 'You are already connected.'; end if;
  update public.handshake_requests set status = 'expired' where status = 'pending' and expires_at <= now()
    and least(inviter_id, invitee_id) = least(invitation.owner_id, auth.uid())
    and greatest(inviter_id, invitee_id) = greatest(invitation.owner_id, auth.uid());
  if exists(select 1 from public.handshake_requests where status = 'pending'
    and least(inviter_id, invitee_id) = least(invitation.owner_id, auth.uid())
    and greatest(inviter_id, invitee_id) = greatest(invitation.owner_id, auth.uid())) then
    raise exception 'A Handshake is already awaiting approval.';
  end if;
  -- Enforce claimant rate limiting as well as creator rate limiting.
  if (select count(*) from public.handshake_requests where invitee_id = auth.uid() and created_at > now() - interval '1 hour') >= 40 then
    raise exception 'Please wait before requesting another Handshake.';
  end if;
  update public.handshake_invites set consumed_at = now() where id = invitation.id;
  insert into public.handshake_requests(inviter_id, invitee_id, expires_at)
    values(invitation.owner_id, auth.uid(), invitation.expires_at) returning id into request_id;
  return request_id;
end;
$$;

create function public.respond_handshake(request_id uuid, approve boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.handshake_requests;
begin
  -- Take the pair lock before the row lock, matching claim_invite lock order.
  select * into r from public.handshake_requests where id = request_id and auth.uid() in (inviter_id, invitee_id);
  if r.id is null then raise exception 'Request unavailable.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(least(r.inviter_id, r.invitee_id)::text || greatest(r.inviter_id, r.invitee_id)::text, 2));
  select * into r from public.handshake_requests where id = request_id for update;
  if r.status <> 'pending' or r.expires_at <= now() then raise exception 'Request expired or already handled.'; end if;
  if approve and r.inviter_id <> auth.uid() then raise exception 'Only the creator can approve this request.'; end if;
  if approve then
    insert into public.connections(user_low, user_high) values(least(r.inviter_id, r.invitee_id), greatest(r.inviter_id, r.invitee_id));
  end if;
  update public.handshake_requests set status = case when approve then 'accepted' else 'declined' end where id = r.id;
end;
$$;

create function public.pending_handshakes() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'incoming', r.inviter_id = auth.uid(),
    'display_name', p.display_name, 'username', p.username, 'expires_at', r.expires_at) order by r.created_at desc), '[]'::jsonb)
  from public.handshake_requests r join public.profiles p on p.id = case when r.inviter_id = auth.uid() then r.invitee_id else r.inviter_id end
  where auth.uid() in (r.inviter_id, r.invitee_id) and r.status = 'pending' and r.expires_at > now();
$$;

create function public.remove_connection(connection_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.connections;
begin
  select * into c from public.connections where id = connection_id and auth.uid() in (user_low, user_high) for update;
  if c.id is null then raise exception 'Connection unavailable.'; end if;
  -- Overrides must not spring back into effect if the pair reconnects later.
  delete from public.contact_overrides o using public.contact_methods m where o.contact_id = m.id
    and ((m.owner_id = c.user_low and o.recipient_id = c.user_high) or (m.owner_id = c.user_high and o.recipient_id = c.user_low));
  delete from public.connections where id = c.id;
end;
$$;

-- Account deletion is intentional, authenticated, and removes dependent data via FKs.
create function public.delete_my_account() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  delete from auth.users where id = auth.uid();
end;
$$;

-- Supabase default privileges are intentionally replaced with a small allowlist.
revoke all on public.profiles, public.connections, public.handshake_invites, public.handshake_requests,
  public.connection_notes, public.contact_methods, public.contact_overrides from anon, authenticated;
grant select, insert on public.profiles to authenticated;
grant update(username, display_name, bio, avatar_url) on public.profiles to authenticated;
grant select on public.connections, public.handshake_requests to authenticated;
grant select, insert, update, delete on public.connection_notes, public.contact_methods, public.contact_overrides to authenticated;
revoke all on function public.create_invite(), public.preview_invite(text), public.claim_invite(text),
  public.respond_handshake(uuid, boolean), public.pending_handshakes(), public.remove_connection(uuid), public.delete_my_account() from public, anon, authenticated;
revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function private.connected_to(uuid), private.member_of(uuid), private.can_read_contact(uuid) to authenticated;
grant execute on function public.create_invite(), public.preview_invite(text), public.claim_invite(text),
  public.respond_handshake(uuid, boolean), public.pending_handshakes(), public.remove_connection(uuid), public.delete_my_account() to authenticated;
