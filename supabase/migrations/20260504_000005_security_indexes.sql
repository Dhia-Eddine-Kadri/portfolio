-- Minallo RLS Performance Indexes
-- Run this in the Supabase SQL Editor after the RLS hardening scripts.
--
-- Purpose:
-- - Speed up common RLS ownership checks.
-- - Speed up room membership checks for chat-related tables.
-- - Speed up joins used by reactions, pins, and subscription lookups.

begin;

create index if not exists idx_custom_rooms_created_by
  on public.custom_rooms(created_by);

create index if not exists idx_custom_rooms_invite_code
  on public.custom_rooms(invite_code);

create index if not exists idx_blocked_users_blocker_id
  on public.blocked_users(blocker_id);

create index if not exists idx_blocked_users_blocked_id
  on public.blocked_users(blocked_id);

create index if not exists idx_friendships_user_id
  on public.friendships(user_id);

create index if not exists idx_friendships_friend_id
  on public.friendships(friend_id);

create index if not exists idx_friendships_user_friend_status
  on public.friendships(user_id, friend_id, status);

create index if not exists idx_room_members_room_user
  on public.room_members(room_id, user_id);

create index if not exists idx_room_members_user_room
  on public.room_members(user_id, room_id);

create index if not exists idx_messages_user_id
  on public.messages(user_id);

create index if not exists idx_messages_room_id
  on public.messages(room_id);

create index if not exists idx_messages_room_created_at
  on public.messages(room_id, created_at desc);

create index if not exists idx_chat_messages_user_id
  on public.chat_messages(user_id);

create index if not exists idx_chat_messages_room_id
  on public.chat_messages(room_id);

create index if not exists idx_message_reactions_user_id
  on public.message_reactions(user_id);

create index if not exists idx_message_reactions_message_id
  on public.message_reactions(message_id);

create index if not exists idx_pinned_messages_room_id
  on public.pinned_messages(room_id);

create index if not exists idx_pinned_messages_message_id
  on public.pinned_messages(message_id);

create index if not exists idx_pinned_messages_pinned_by
  on public.pinned_messages(pinned_by);

create index if not exists idx_room_nicknames_room_user
  on public.room_nicknames(room_id, user_id);

create index if not exists idx_typing_indicators_room_user
  on public.typing_indicators(room_id, user_id);

create index if not exists idx_subscriptions_user_id
  on public.subscriptions(user_id);

create index if not exists idx_security_events_user_event_created
  on public.security_events(user_id, event_type, created_at desc);

commit;

-- Verification:
select
  schemaname,
  tablename,
  indexname,
  indexdef
from pg_indexes
where schemaname = 'public'
  and indexname in (
    'idx_custom_rooms_created_by',
    'idx_custom_rooms_invite_code',
    'idx_blocked_users_blocker_id',
    'idx_blocked_users_blocked_id',
    'idx_friendships_user_id',
    'idx_friendships_friend_id',
    'idx_friendships_user_friend_status',
    'idx_room_members_room_user',
    'idx_room_members_user_room',
    'idx_messages_user_id',
    'idx_messages_room_id',
    'idx_messages_room_created_at',
    'idx_chat_messages_user_id',
    'idx_chat_messages_room_id',
    'idx_message_reactions_user_id',
    'idx_message_reactions_message_id',
    'idx_pinned_messages_room_id',
    'idx_pinned_messages_message_id',
    'idx_pinned_messages_pinned_by',
    'idx_room_nicknames_room_user',
    'idx_typing_indicators_room_user',
    'idx_subscriptions_user_id',
    'idx_security_events_user_event_created'
  )
order by tablename, indexname;
