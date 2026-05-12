-- Minallo RLS Hardening Pass
-- Run this script in the Supabase SQL Editor.
--
-- Purpose:
-- - Lock down the remaining social/chat/subscription tables.
-- - Require room membership for chat-adjacent writes.
-- - Keep subscription writes backend/service-role only.
--
-- Follow-up migration:
-- Several tables still store room_id as text while room_members.room_id is uuid.
-- This script keeps the existing room_id::text bridge. Normalize room_id to uuid
-- everywhere before public launch if chat rooms are core to the product.

begin;

-- ---------------------------------------------------------------------------
-- custom_rooms
-- Creators can manage their rooms. Authenticated users can read public rooms,
-- rooms they created, and rooms where they are members.
--
-- Note: this intentionally does not make all private invite-code rooms readable.
-- The current frontend invite flow may need a backend/RPC join-by-code endpoint
-- if private rooms should be joinable without exposing private room rows.
-- ---------------------------------------------------------------------------

alter table public.custom_rooms enable row level security;

drop policy if exists "Users can read rooms they created" on public.custom_rooms;
drop policy if exists "Users can read visible rooms" on public.custom_rooms;
drop policy if exists "Users can insert their own rooms" on public.custom_rooms;
drop policy if exists "Users can update rooms they created" on public.custom_rooms;
drop policy if exists "Users can delete rooms they created" on public.custom_rooms;

create policy "Users can read visible rooms"
on public.custom_rooms
for select
to authenticated
using (
  created_by = auth.uid()
  or visibility = 'public'
  or exists (
    select 1
    from public.room_members rm
    where rm.room_id = custom_rooms.id
      and rm.user_id = auth.uid()
  )
);

create policy "Users can insert their own rooms"
on public.custom_rooms
for insert
to authenticated
with check (created_by = auth.uid());

create policy "Users can update rooms they created"
on public.custom_rooms
for update
to authenticated
using (created_by = auth.uid())
with check (created_by = auth.uid());

create policy "Users can delete rooms they created"
on public.custom_rooms
for delete
to authenticated
using (created_by = auth.uid());

-- ---------------------------------------------------------------------------
-- blocked_users
-- Users can manage only rows where they are the blocker.
-- ---------------------------------------------------------------------------

alter table public.blocked_users enable row level security;

drop policy if exists "Users can read their own blocked users" on public.blocked_users;
drop policy if exists "Users can block users themselves" on public.blocked_users;
drop policy if exists "Users can unblock users themselves" on public.blocked_users;

create policy "Users can read their own blocked users"
on public.blocked_users
for select
to authenticated
using (blocker_id = auth.uid());

create policy "Users can block users themselves"
on public.blocked_users
for insert
to authenticated
with check (
  blocker_id = auth.uid()
  and blocked_id <> auth.uid()
);

create policy "Users can unblock users themselves"
on public.blocked_users
for delete
to authenticated
using (blocker_id = auth.uid());

-- ---------------------------------------------------------------------------
-- friendships
-- Users can read/delete friendships where they are either side.
-- Users can create outbound requests as themselves.
-- Only the recipient can update a request, which prevents requester self-accept.
-- ---------------------------------------------------------------------------

alter table public.friendships enable row level security;

drop policy if exists "Users can read their friendships" on public.friendships;
drop policy if exists "Users can create friendship requests" on public.friendships;
drop policy if exists "Users can update received friendships" on public.friendships;
drop policy if exists "Users can update their friendships" on public.friendships;
drop policy if exists "Users can delete their friendships" on public.friendships;

create policy "Users can read their friendships"
on public.friendships
for select
to authenticated
using (
  user_id = auth.uid()
  or friend_id = auth.uid()
);

create policy "Users can create friendship requests"
on public.friendships
for insert
to authenticated
with check (
  user_id = auth.uid()
  and friend_id <> auth.uid()
);

create policy "Users can update received friendships"
on public.friendships
for update
to authenticated
using (friend_id = auth.uid())
with check (friend_id = auth.uid());

create policy "Users can delete their friendships"
on public.friendships
for delete
to authenticated
using (
  user_id = auth.uid()
  or friend_id = auth.uid()
);

-- ---------------------------------------------------------------------------
-- messages
-- Room members can read/send messages. Users can update/delete their own
-- messages, but updates must keep the message in a room they still belong to.
-- ---------------------------------------------------------------------------

alter table public.messages enable row level security;

drop policy if exists "Room members can read messages" on public.messages;
drop policy if exists "Room members can send messages" on public.messages;
drop policy if exists "Users can update their own messages" on public.messages;
drop policy if exists "Users can delete their own messages" on public.messages;

create policy "Room members can read messages"
on public.messages
for select
to authenticated
using (
  exists (
    select 1
    from public.room_members rm
    where rm.room_id::text = messages.room_id
      and rm.user_id = auth.uid()
  )
);

create policy "Room members can send messages"
on public.messages
for insert
to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.room_members rm
    where rm.room_id::text = messages.room_id
      and rm.user_id = auth.uid()
  )
);

create policy "Users can update their own messages"
on public.messages
for update
to authenticated
using (user_id = auth.uid())
with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.room_members rm
    where rm.room_id::text = messages.room_id
      and rm.user_id = auth.uid()
  )
);

create policy "Users can delete their own messages"
on public.messages
for delete
to authenticated
using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- chat_messages
-- Same access boundary as messages.
-- ---------------------------------------------------------------------------

alter table public.chat_messages enable row level security;

drop policy if exists "Room members can read chat messages" on public.chat_messages;
drop policy if exists "Room members can send chat messages" on public.chat_messages;
drop policy if exists "Users can delete their own chat messages" on public.chat_messages;

create policy "Room members can read chat messages"
on public.chat_messages
for select
to authenticated
using (
  exists (
    select 1
    from public.room_members rm
    where rm.room_id::text = chat_messages.room_id
      and rm.user_id = auth.uid()
  )
);

create policy "Room members can send chat messages"
on public.chat_messages
for insert
to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.room_members rm
    where rm.room_id::text = chat_messages.room_id
      and rm.user_id = auth.uid()
  )
);

create policy "Users can delete their own chat messages"
on public.chat_messages
for delete
to authenticated
using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- message_reactions
-- Members can read reactions on messages in their rooms.
-- Users can only create/delete their own reaction rows, and inserts must target
-- a message in a room they belong to.
-- ---------------------------------------------------------------------------

alter table public.message_reactions enable row level security;

drop policy if exists "Room members can read message reactions" on public.message_reactions;
drop policy if exists "Users can create their own reactions" on public.message_reactions;
drop policy if exists "Users can delete their own reactions" on public.message_reactions;

create policy "Room members can read message reactions"
on public.message_reactions
for select
to authenticated
using (
  exists (
    select 1
    from public.messages m
    join public.room_members rm
      on rm.room_id::text = m.room_id
    where m.id = message_reactions.message_id
      and rm.user_id = auth.uid()
  )
);

create policy "Users can create their own reactions"
on public.message_reactions
for insert
to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.messages m
    join public.room_members rm
      on rm.room_id::text = m.room_id
    where m.id = message_reactions.message_id
      and rm.user_id = auth.uid()
  )
);

create policy "Users can delete their own reactions"
on public.message_reactions
for delete
to authenticated
using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- pinned_messages
-- Room members can read pins. Room members can pin messages only in rooms they
-- belong to, and the pinned message must belong to the same room.
-- ---------------------------------------------------------------------------

alter table public.pinned_messages enable row level security;

drop policy if exists "Room members can read pinned messages" on public.pinned_messages;
drop policy if exists "Room members can pin messages" on public.pinned_messages;
drop policy if exists "Users can unpin messages they pinned" on public.pinned_messages;

create policy "Room members can read pinned messages"
on public.pinned_messages
for select
to authenticated
using (
  exists (
    select 1
    from public.room_members rm
    where rm.room_id::text = pinned_messages.room_id
      and rm.user_id = auth.uid()
  )
);

create policy "Room members can pin messages"
on public.pinned_messages
for insert
to authenticated
with check (
  pinned_by = auth.uid()
  and exists (
    select 1
    from public.room_members rm
    where rm.room_id::text = pinned_messages.room_id
      and rm.user_id = auth.uid()
  )
  and exists (
    select 1
    from public.messages m
    where m.id = pinned_messages.message_id
      and m.room_id = pinned_messages.room_id
  )
);

create policy "Users can unpin messages they pinned"
on public.pinned_messages
for delete
to authenticated
using (pinned_by = auth.uid());

-- ---------------------------------------------------------------------------
-- room_nicknames
-- Nicknames are visible only inside rooms the user belongs to.
-- Users can manage only their own nickname, and only for rooms they belong to.
-- ---------------------------------------------------------------------------

alter table public.room_nicknames enable row level security;

drop policy if exists "Users can read nicknames in their rooms" on public.room_nicknames;
drop policy if exists "Users can set their own nickname" on public.room_nicknames;
drop policy if exists "Users can update their own nickname" on public.room_nicknames;
drop policy if exists "Users can delete their own nickname" on public.room_nicknames;

create policy "Users can read nicknames in their rooms"
on public.room_nicknames
for select
to authenticated
using (
  exists (
    select 1
    from public.room_members rm
    where rm.room_id::text = room_nicknames.room_id
      and rm.user_id = auth.uid()
  )
);

create policy "Users can set their own nickname"
on public.room_nicknames
for insert
to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.room_members rm
    where rm.room_id::text = room_nicknames.room_id
      and rm.user_id = auth.uid()
  )
);

create policy "Users can update their own nickname"
on public.room_nicknames
for update
to authenticated
using (user_id = auth.uid())
with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.room_members rm
    where rm.room_id::text = room_nicknames.room_id
      and rm.user_id = auth.uid()
  )
);

create policy "Users can delete their own nickname"
on public.room_nicknames
for delete
to authenticated
using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- typing_indicators
-- Typing rows are visible only inside rooms the user belongs to.
-- Users can manage only their own typing row, and only for rooms they belong to.
-- ---------------------------------------------------------------------------

alter table public.typing_indicators enable row level security;

drop policy if exists "Room members can read typing indicators" on public.typing_indicators;
drop policy if exists "Users can create their own typing indicator" on public.typing_indicators;
drop policy if exists "Users can update their own typing indicator" on public.typing_indicators;
drop policy if exists "Users can delete their own typing indicator" on public.typing_indicators;

create policy "Room members can read typing indicators"
on public.typing_indicators
for select
to authenticated
using (
  exists (
    select 1
    from public.room_members rm
    where rm.room_id::text = typing_indicators.room_id
      and rm.user_id = auth.uid()
  )
);

create policy "Users can create their own typing indicator"
on public.typing_indicators
for insert
to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.room_members rm
    where rm.room_id::text = typing_indicators.room_id
      and rm.user_id = auth.uid()
  )
);

create policy "Users can update their own typing indicator"
on public.typing_indicators
for update
to authenticated
using (user_id = auth.uid())
with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.room_members rm
    where rm.room_id::text = typing_indicators.room_id
      and rm.user_id = auth.uid()
  )
);

create policy "Users can delete their own typing indicator"
on public.typing_indicators
for delete
to authenticated
using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- subscriptions
-- Users can read their own subscription. Writes should only happen through
-- trusted backend functions/webhooks using the service role key.
-- ---------------------------------------------------------------------------

alter table public.subscriptions enable row level security;

drop policy if exists "Users can read their own subscription" on public.subscriptions;
drop policy if exists "Users can insert their own subscription" on public.subscriptions;
drop policy if exists "Users can update their own subscription" on public.subscriptions;
drop policy if exists "Users can delete their own subscription" on public.subscriptions;

create policy "Users can read their own subscription"
on public.subscriptions
for select
to authenticated
using (user_id = auth.uid());

commit;

-- ---------------------------------------------------------------------------
-- Manual verification queries
-- Run after the transaction. These queries list enabled RLS state and current
-- policies so you can confirm the script applied cleanly.
-- ---------------------------------------------------------------------------

select
  schemaname,
  tablename,
  rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in (
    'custom_rooms',
    'blocked_users',
    'friendships',
    'messages',
    'chat_messages',
    'message_reactions',
    'pinned_messages',
    'room_nicknames',
    'typing_indicators',
    'subscriptions'
  )
order by tablename;

select
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename in (
    'custom_rooms',
    'blocked_users',
    'friendships',
    'messages',
    'chat_messages',
    'message_reactions',
    'pinned_messages',
    'room_nicknames',
    'typing_indicators',
    'subscriptions'
  )
order by tablename, policyname;
