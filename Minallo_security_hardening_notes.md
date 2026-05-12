# Minallo Security Hardening Notes

This document summarizes what has already been done and what still needs to be done before making Minallo public for many students.

---

## 1. Current Database Tables

These are the public tables identified in Supabase:

```txt
blocked_users
chat_messages
custom_rooms
editor_docs
friendships
lecture_notes
message_reactions
messages
pinned_messages
profiles
room_members
room_nicknames
settings
subscriptions
typing_indicators
```

Important note: earlier SQL examples used tables like `courses`, `files`, `folders`, `notes`, and `subscriptions`. Some of those tables did not exist in your database, so the policies had to be adjusted to your real table names and columns.

---

## 2. RLS Status

RLS was already enabled for some tables, including:

```txt
settings
profiles
lecture_notes
custom_rooms
room_members
message_reactions
```

You then started adding exact policies based on the real columns of your tables.

---

# What We Already Did

## 3. `settings` Table

### Columns Found

```txt
id uuid
dark_mode boolean
auto_open_ai boolean
save_chat_history boolean
```

### Security Logic

`settings.id` is treated as the user ID.

A logged-in user can only access the settings row where:

```txt
settings.id = auth.uid()
```

### Policies Applied

```sql
alter table public.settings enable row level security;

drop policy if exists "Users can read their own settings" on public.settings;
drop policy if exists "Users can insert their own settings" on public.settings;
drop policy if exists "Users can update their own settings" on public.settings;
drop policy if exists "Users can delete their own settings" on public.settings;

create policy "Users can read their own settings"
on public.settings
for select
to authenticated
using (auth.uid() = id);

create policy "Users can insert their own settings"
on public.settings
for insert
to authenticated
with check (auth.uid() = id);

create policy "Users can update their own settings"
on public.settings
for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

create policy "Users can delete their own settings"
on public.settings
for delete
to authenticated
using (auth.uid() = id);
```

---

## 4. `profiles` Table

### Columns Found

```txt
id uuid
full_name text
email text
university text
programme text
matrikel text
updated_at timestamp with time zone
age integer
vertiefung text
auth_email text
```

### Security Logic

`profiles.id` is treated as the user ID.

A logged-in user can only access the profile row where:

```txt
profiles.id = auth.uid()
```

This is important because `profiles` contains personal information.

### Policies Applied

```sql
alter table public.profiles enable row level security;

drop policy if exists "Users can read their own profile" on public.profiles;
drop policy if exists "Users can insert their own profile" on public.profiles;
drop policy if exists "Users can update their own profile" on public.profiles;
drop policy if exists "Users can delete their own profile" on public.profiles;

create policy "Users can read their own profile"
on public.profiles
for select
to authenticated
using (auth.uid() = id);

create policy "Users can insert their own profile"
on public.profiles
for insert
to authenticated
with check (auth.uid() = id);

create policy "Users can update their own profile"
on public.profiles
for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

create policy "Users can delete their own profile"
on public.profiles
for delete
to authenticated
using (auth.uid() = id);
```

---

## 5. `lecture_notes` Table

### Columns Found

```txt
id text
user_id uuid
title text
content text
url text
date timestamp with time zone
created_at timestamp with time zone
```

### Security Logic

`lecture_notes.user_id` identifies the note owner.

A logged-in user can only access notes where:

```txt
lecture_notes.user_id = auth.uid()
```

### Policies Applied

```sql
alter table public.lecture_notes enable row level security;

drop policy if exists "Users can read their own lecture notes" on public.lecture_notes;
drop policy if exists "Users can insert their own lecture notes" on public.lecture_notes;
drop policy if exists "Users can update their own lecture notes" on public.lecture_notes;
drop policy if exists "Users can delete their own lecture notes" on public.lecture_notes;

create policy "Users can read their own lecture notes"
on public.lecture_notes
for select
to authenticated
using (auth.uid() = user_id);

create policy "Users can insert their own lecture notes"
on public.lecture_notes
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "Users can update their own lecture notes"
on public.lecture_notes
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can delete their own lecture notes"
on public.lecture_notes
for delete
to authenticated
using (auth.uid() = user_id);
```

---

## 6. `editor_docs` Table

### Columns Found

```txt
id text
user_id uuid
title text
data jsonb
updated_at timestamp with time zone
```

### Security Logic

`editor_docs.user_id` identifies the document owner.

A logged-in user can only access docs where:

```txt
editor_docs.user_id = auth.uid()
```

### Policies Applied

```sql
alter table public.editor_docs enable row level security;

drop policy if exists "Users can read their own editor docs" on public.editor_docs;
drop policy if exists "Users can insert their own editor docs" on public.editor_docs;
drop policy if exists "Users can update their own editor docs" on public.editor_docs;
drop policy if exists "Users can delete their own editor docs" on public.editor_docs;

create policy "Users can read their own editor docs"
on public.editor_docs
for select
to authenticated
using (auth.uid() = user_id);

create policy "Users can insert their own editor docs"
on public.editor_docs
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "Users can update their own editor docs"
on public.editor_docs
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can delete their own editor docs"
on public.editor_docs
for delete
to authenticated
using (auth.uid() = user_id);
```

---

## 7. `custom_rooms` Table

### Columns Found

```txt
id uuid
description text
created_by uuid
created_at timestamp with time zone
visibility text
invite_code text
topic text
slowmode_seconds integer
is_nsfw boolean
```

### Security Logic

`custom_rooms.created_by` identifies the room creator.

The safe starting policy allows users to manage only rooms they created.

### Policies Suggested / Applied

```sql
alter table public.custom_rooms enable row level security;

drop policy if exists "Users can read rooms they created" on public.custom_rooms;
drop policy if exists "Users can insert their own rooms" on public.custom_rooms;
drop policy if exists "Users can update rooms they created" on public.custom_rooms;
drop policy if exists "Users can delete rooms they created" on public.custom_rooms;

create policy "Users can read rooms they created"
on public.custom_rooms
for select
to authenticated
using (auth.uid() = created_by);

create policy "Users can insert their own rooms"
on public.custom_rooms
for insert
to authenticated
with check (auth.uid() = created_by);

create policy "Users can update rooms they created"
on public.custom_rooms
for update
to authenticated
using (auth.uid() = created_by)
with check (auth.uid() = created_by);

create policy "Users can delete rooms they created"
on public.custom_rooms
for delete
to authenticated
using (auth.uid() = created_by);
```

### Future Improvement

For rooms, you may later need broader read access:

```txt
Room creators can manage rooms.
Room members can read rooms they belong to.
Public rooms may be visible to authenticated users.
Private rooms require membership or invite code.
```

---

## 8. `room_members` Table

### Columns Found

```txt
id uuid
room_id uuid
user_id uuid
joined_at timestamp with time zone
```

### Security Logic

Users can manage only their own membership rows.

### Policies Applied

```sql
alter table public.room_members enable row level security;

drop policy if exists "Users can read their own room memberships" on public.room_members;
drop policy if exists "Users can join rooms as themselves" on public.room_members;
drop policy if exists "Users can leave rooms themselves" on public.room_members;

create policy "Users can read their own room memberships"
on public.room_members
for select
to authenticated
using (auth.uid() = user_id);

create policy "Users can join rooms as themselves"
on public.room_members
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "Users can leave rooms themselves"
on public.room_members
for delete
to authenticated
using (auth.uid() = user_id);
```

### Future Improvement

Room creators may need to see who joined their room. Add that later if your UI needs it.

---

# Policies Still To Apply / Verify

The following policies were recommended for the remaining tables. Apply them if you have not already.

---

## 9. `blocked_users`

### Columns Found

```txt
blocker_id uuid
blocked_id uuid
created_at timestamp with time zone
```

### Security Logic

A user can manage only rows where they are the blocker.

```sql
alter table public.blocked_users enable row level security;

drop policy if exists "Users can read their own blocked users" on public.blocked_users;
drop policy if exists "Users can block users themselves" on public.blocked_users;
drop policy if exists "Users can unblock users themselves" on public.blocked_users;

create policy "Users can read their own blocked users"
on public.blocked_users
for select
to authenticated
using (auth.uid() = blocker_id);

create policy "Users can block users themselves"
on public.blocked_users
for insert
to authenticated
with check (auth.uid() = blocker_id);

create policy "Users can unblock users themselves"
on public.blocked_users
for delete
to authenticated
using (auth.uid() = blocker_id);
```

---

## 10. `friendships`

### Columns Found

```txt
id uuid
user_id uuid
friend_id uuid
status text
created_at timestamp with time zone
```

### Security Logic

Users can read/update/delete friendships where they are either side.

```sql
alter table public.friendships enable row level security;

drop policy if exists "Users can read their friendships" on public.friendships;
drop policy if exists "Users can create friendship requests" on public.friendships;
drop policy if exists "Users can update their friendships" on public.friendships;
drop policy if exists "Users can delete their friendships" on public.friendships;

create policy "Users can read their friendships"
on public.friendships
for select
to authenticated
using (
  auth.uid() = user_id
  or auth.uid() = friend_id
);

create policy "Users can create friendship requests"
on public.friendships
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "Users can update their friendships"
on public.friendships
for update
to authenticated
using (
  auth.uid() = user_id
  or auth.uid() = friend_id
)
with check (
  auth.uid() = user_id
  or auth.uid() = friend_id
);

create policy "Users can delete their friendships"
on public.friendships
for delete
to authenticated
using (
  auth.uid() = user_id
  or auth.uid() = friend_id
);
```

### Future Improvement

Restrict `status` values with a database check:

```sql
alter table public.friendships
add constraint friendships_status_check
check (status in ('pending', 'accepted', 'blocked'));
```

---

## 11. `messages`

### Columns Found

```txt
id uuid
room_id text
user_id uuid
display_name text
content text
created_at timestamp with time zone
reply_to_id uuid
edited_at timestamp with time zone
mentions jsonb
attachment_url text
attachment_type text
attachment_name text
```

### Important Type Note

`messages.room_id` is `text`, while `room_members.room_id` is `uuid`.

The policies below use:

```sql
rm.room_id::text = messages.room_id
```

This should work if `messages.room_id` contains UUID strings.

Future improvement: make all `room_id` columns the same type, preferably `uuid`.

### Policies

```sql
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
  auth.uid() = user_id
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
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can delete their own messages"
on public.messages
for delete
to authenticated
using (auth.uid() = user_id);
```

---

## 12. `chat_messages`

### Columns Found

```txt
id uuid
room_id text
user_id uuid
display_name text
content text
created_at timestamp with time zone
```

### Policies

```sql
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
  auth.uid() = user_id
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
using (auth.uid() = user_id);
```

---

## 13. `message_reactions`

### Columns Found

```txt
message_id uuid
user_id uuid
emoji text
created_at timestamp with time zone
```

### Policies

```sql
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
with check (auth.uid() = user_id);

create policy "Users can delete their own reactions"
on public.message_reactions
for delete
to authenticated
using (auth.uid() = user_id);
```

### Future Improvement

Add a unique constraint to prevent duplicate reactions from the same user:

```sql
alter table public.message_reactions
add constraint message_reactions_unique_user_emoji
unique (message_id, user_id, emoji);
```

---

## 14. `pinned_messages`

### Columns Found

```txt
id uuid
room_id text
message_id uuid
pinned_by uuid
pinned_at timestamp with time zone
```

### Policies

```sql
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
  auth.uid() = pinned_by
  and exists (
    select 1
    from public.room_members rm
    where rm.room_id::text = pinned_messages.room_id
      and rm.user_id = auth.uid()
  )
);

create policy "Users can unpin messages they pinned"
on public.pinned_messages
for delete
to authenticated
using (auth.uid() = pinned_by);
```

### Future Improvement

You may want only room creators/moderators to pin messages.

---

## 15. `room_nicknames`

### Columns Found

```txt
room_id text
user_id uuid
nickname text
```

### Policies

```sql
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
with check (auth.uid() = user_id);

create policy "Users can update their own nickname"
on public.room_nicknames
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can delete their own nickname"
on public.room_nicknames
for delete
to authenticated
using (auth.uid() = user_id);
```

---

## 16. `typing_indicators`

### Columns Found

```txt
room_id text
user_id uuid
display_name text
updated_at timestamp with time zone
```

### Policies

```sql
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
with check (auth.uid() = user_id);

create policy "Users can update their own typing indicator"
on public.typing_indicators
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can delete their own typing indicator"
on public.typing_indicators
for delete
to authenticated
using (auth.uid() = user_id);
```

---

## 17. `subscriptions`

### Columns Found

```txt
id uuid
plan text
updated_at timestamp with time zone
user_id uuid
status text
stripe_subscription_id text
stripe_customer_id text
paypal_subscription_id text
expires_at timestamp with time zone
had_trial boolean
```

### Security Logic

Users should usually only read their own subscription.

Subscription updates should come from trusted backend functions or Stripe/PayPal webhooks using the Supabase service role key.

### Policy

```sql
alter table public.subscriptions enable row level security;

drop policy if exists "Users can read their own subscription" on public.subscriptions;
drop policy if exists "Users can insert their own subscription" on public.subscriptions;
drop policy if exists "Users can update their own subscription" on public.subscriptions;
drop policy if exists "Users can delete their own subscription" on public.subscriptions;

create policy "Users can read their own subscription"
on public.subscriptions
for select
to authenticated
using (auth.uid() = user_id);
```

Do not add public insert/update/delete policies for `subscriptions` unless absolutely required.

---

# Important Database Improvements To Do Later

## 18. Make `room_id` Types Consistent

Some tables use:

```txt
room_members.room_id uuid
```

while other tables use:

```txt
messages.room_id text
chat_messages.room_id text
pinned_messages.room_id text
room_nicknames.room_id text
typing_indicators.room_id text
```

Recommended future change:

```txt
Use uuid for room_id everywhere.
```

This reduces bugs and makes RLS policies cleaner.

---

## 19. Add Foreign Keys

Add foreign keys where possible.

Examples:

```sql
alter table public.room_members
add constraint room_members_room_id_fkey
foreign key (room_id)
references public.custom_rooms(id)
on delete cascade;

alter table public.room_members
add constraint room_members_user_id_fkey
foreign key (user_id)
references auth.users(id)
on delete cascade;
```

Add similar constraints for:

```txt
messages.user_id
messages.room_id
message_reactions.message_id
message_reactions.user_id
pinned_messages.message_id
pinned_messages.pinned_by
friendships.user_id
friendships.friend_id
blocked_users.blocker_id
blocked_users.blocked_id
subscriptions.user_id
```

Foreign keys help prevent broken or fake references.

---

## 20. Add Check Constraints

Restrict text fields that should only have specific values.

Examples:

```sql
alter table public.friendships
add constraint friendships_status_check
check (status in ('pending', 'accepted', 'blocked'));

alter table public.subscriptions
add constraint subscriptions_status_check
check (status in ('active', 'trialing', 'past_due', 'canceled', 'expired', 'inactive'));

alter table public.subscriptions
add constraint subscriptions_plan_check
check (plan in ('free', 'pro', 'premium', 'student'));
```

Adjust the allowed values to match your actual app.

---

## 21. Add Unique Constraints

Recommended:

```sql
alter table public.blocked_users
add constraint blocked_users_unique_pair
unique (blocker_id, blocked_id);

alter table public.friendships
add constraint friendships_unique_pair
unique (user_id, friend_id);

alter table public.room_members
add constraint room_members_unique_member
unique (room_id, user_id);

alter table public.room_nicknames
add constraint room_nicknames_unique_member
unique (room_id, user_id);

alter table public.message_reactions
add constraint message_reactions_unique_user_emoji
unique (message_id, user_id, emoji);
```

These prevent duplicates and make your app more reliable.

---

# Other Security Features Still To Do

## 22. Supabase Storage Security

Make all student upload buckets private unless files are meant to be public.

Recommended file path pattern:

```txt
user_id/course_id/file_id.pdf
```

Example policy idea:

```sql
create policy "Users can read their own files"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'course-files'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "Users can upload their own files"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'course-files'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "Users can delete their own files"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'course-files'
  and (storage.foldername(name))[1] = auth.uid()::text
);
```

---

## 23. Backend/API Authorization

Every backend function should verify:

```txt
Who is the user?
Are they logged in?
Are they allowed to access the requested object?
Is the input valid?
Is the request too large?
Is the request too frequent?
```

Critical backend endpoints to protect:

```txt
AI endpoint
admin endpoints
subscription/payment endpoints
file-processing endpoints
transcription endpoints
```

Do not trust user IDs sent from the frontend. Always get the user from the Supabase access token.

---

## 24. Rate Limiting

Add rate limits for:

```txt
AI requests
file uploads
chat messages
login attempts
admin searches
payment session creation
```

Suggested starting limits:

```txt
AI chat: 20 requests per user per hour
PDF summary: 5 requests per user per hour
Chat messages: 60 messages per minute
File uploads: 20 files per hour
Admin search: 30 requests per hour
```

---

## 25. File Upload Protection

Allow only file types you actually need.

Recommended allowed types:

```txt
.pdf
.txt
.docx
.png
.jpg
.jpeg
```

Block dangerous types:

```txt
.html
.js
.svg
.exe
.bat
.cmd
.sh
.php
.zip unless scanned and handled carefully
```

Also add:

```txt
maximum file size
safe generated filenames
private buckets
no direct public file URLs
server-side validation
```

Recommended storage filename pattern:

```txt
user_id/course_id/generated_uuid.pdf
```

Store the original filename only as metadata.

---

## 26. XSS Protection

User-generated values must be rendered safely.

Risky values include:

```txt
course names
room names
chat messages
file names
profile names
lecture note titles
AI responses
nicknames
```

Safe rule:

```txt
Use textContent for user-generated text.
Use innerHTML only for static markup.
```

Avoid:

```js
card.innerHTML = `<h3>${course.name}</h3>`;
```

Prefer:

```js
const title = document.createElement('h3');
title.textContent = course.name;
card.append(title);
```

If HTML strings are necessary, escape dynamic values:

```js
function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
```

---

## 27. Security Headers

Add basic security headers to `netlify.toml`.

```toml
[[headers]]
  for = "/*"
  [headers.values]
    X-Content-Type-Options = "nosniff"
    X-Frame-Options = "DENY"
    Referrer-Policy = "strict-origin-when-cross-origin"
    Permissions-Policy = "camera=(), microphone=(), geolocation=()"
```

Later add a Content Security Policy.

Example starting point:

```toml
Content-Security-Policy = "default-src 'self'; script-src 'self' https://cdnjs.cloudflare.com; connect-src 'self' https://*.supabase.co https://api.openai.com; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none';"
```

Adjust it based on the services you actually use.

---

## 28. GitHub Security Tools

Enable these in GitHub:

```txt
Secret scanning
Dependabot alerts
Dependabot security updates
CodeQL code scanning
```

Add `.github/dependabot.yml`:

```yaml
version: 2
updates:
  - package-ecosystem: 'npm'
    directory: '/'
    schedule:
      interval: 'weekly'

  - package-ecosystem: 'github-actions'
    directory: '/'
    schedule:
      interval: 'weekly'
```

Add CodeQL workflow:

```yaml
name: CodeQL

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  analyze:
    name: Analyze
    runs-on: ubuntu-latest
    permissions:
      security-events: write
      contents: read

    steps:
      - uses: actions/checkout@v4
      - uses: github/codeql-action/init@v3
        with:
          languages: javascript-typescript
      - uses: github/codeql-action/analyze@v3
```

---

## 29. Admin Security

Do not rely on frontend checks for admin access.

Recommended approach:

```txt
admins table
backend verifies Supabase token
backend checks admins table
backend performs admin action
admin action gets logged
```

Example admin table:

```sql
create table public.admins (
  user_id uuid primary key references auth.users(id),
  created_at timestamptz default now()
);

alter table public.admins enable row level security;
```

Admin actions to log:

```txt
who performed the action
target user
old value
new value
timestamp
reason if applicable
```

---

## 30. Authentication Settings

In Supabase Auth settings, check:

```txt
email confirmation enabled
production site URL is correct
redirect URLs are restricted
localhost redirect URLs removed from production
OAuth provider redirect URLs are correct
```

For production, avoid overly broad redirect URLs.

---

## 31. Logging and Monitoring

Create a security events table:

```sql
create table public.security_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  event_type text not null,
  metadata jsonb,
  created_at timestamptz default now()
);
```

Log events such as:

```txt
failed backend authorization
blocked AI request
rejected file upload
admin action
payment webhook event
suspicious access attempt
```

Do not log:

```txt
access tokens
refresh tokens
API keys
Stripe secrets
full private PDFs
full private user chats
```

---

## 32. Branch Protection

Protect the `main` branch.

Enable:

```txt
Require pull requests
Require status checks to pass
Require branches to be up to date
Require conversation resolution
Disable force pushes
Disable branch deletion
```

This prevents accidental production-breaking changes.

---

## 33. Security Testing With Two Accounts

Create two normal student accounts:

```txt
student_a@example.com
student_b@example.com
```

Test:

```txt
Can A read B's profile? Should be no.
Can A read B's settings? Should be no.
Can A edit B's lecture notes? Should be no.
Can A access B's editor docs? Should be no.
Can A access a room they are not a member of? Should be no.
Can A read messages from a private room they are not in? Should be no.
Can A change their subscription directly? Should be no.
Can logged-out users call AI? Should be no.
Can logged-out users upload files? Should be no.
Can a normal user call admin endpoints? Should be no.
Can a user upload .html or .js files? Should be no.
Can a user send huge AI requests? Should be no.
```

---

# Priority Checklist

## Already Done / Started

```txt
[x] Checked real Supabase table names
[x] Confirmed several tables already have RLS enabled
[x] Added RLS policies for settings
[x] Added RLS policies for profiles
[x] Added RLS policies for lecture_notes
[x] Added RLS policies for editor_docs
[x] Added/suggested RLS policies for custom_rooms
[x] Added RLS policies for room_members
[x] Identified remaining chat/social/subscription tables
[x] Moved PayPal subscription activation writes behind backend function
[x] Added public/course chat room RLS patch
[x] Moved chat friend list loading behind backend function
```

## Do Next

```txt
[x] Apply/verify RLS policies for blocked_users
[x] Apply/verify RLS policies for friendships
[x] Apply/verify RLS policies for messages
[x] Apply/verify RLS policies for chat_messages
[x] Apply/verify RLS policies for message_reactions
[x] Apply/verify RLS policies for pinned_messages
[x] Apply/verify RLS policies for room_nicknames
[x] Apply/verify RLS policies for typing_indicators
[x] Apply/verify read-only user policy for subscriptions
[ ] Test with two normal student accounts
```

## Do Before Public Launch

```txt
[x] Make Supabase Storage buckets private
[x] Add Supabase Storage policies
[x] Add file upload type restrictions
[x] Add file upload size limits
[x] Add backend request validation
[x] Add AI rate limiting
[x] Add chat/message rate limiting
[x] Add admin authorization using backend and admins table
[x] Add security headers in netlify.toml
[ ] Enable GitHub secret scanning
[x] Enable Dependabot
[ ] Enable CodeQL
[x] Add branch protection on main
[x] Add logging for security-relevant backend actions
[x] Check Supabase Auth redirect URLs
[x] Remove localhost redirect URLs from production
[ ] Add two-account security testing
```

GitHub note:

- `Enable GitHub secret scanning` and `Enable CodeQL` remain unchecked here because those features are not currently exposed for this repository's GitHub plan/settings.

---

# Main Security Mindset

The most important rules:

```txt
Never trust the frontend.
Every sensitive action must be checked by RLS or backend code.
Every user should only access their own private data.
Room data should only be visible to room members.
Subscription data should only be changed by trusted backend/webhook logic.
Expensive actions like AI must be rate-limited.
File uploads must be restricted and private.
User-generated text must be safely rendered.
```

If those principles are followed, Minallo will be much safer for public student usage.

---

# Missing / Newly Added Security Points

## 34. Remove Wildcard API CORS

If `netlify.toml` or a proxy rule contains this for backend/API routes:

```toml
Access-Control-Allow-Origin = "*"
```

remove it before production.

Use strict function-level CORS instead:

```js
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN;

const corsHeaders = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
};
```

Checklist:

```txt
[x] Remove wildcard API CORS from netlify.toml
[x] Use ALLOWED_ORIGIN from environment variables
[ ] Allow localhost only in development, not production
```

---

## 35. Verify Backend Functions Use Environment Variables Only

Backend functions should not contain hardcoded production URLs, fallback project URLs, admin emails, or payment price IDs.

Recommended `.env.example` variables:

```env
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
OPENAI_API_KEY=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRO_MONTHLY_PRICE_ID=
PAYPAL_CLIENT_ID=
PAYPAL_CLIENT_SECRET=
ALLOWED_ORIGIN=
```

Checklist:

```txt
[x] No hardcoded production origin in backend functions
[x] No fallback Supabase URL in backend functions
[x] No Stripe/PayPal price IDs hardcoded in frontend
[x] No admin identity based only on frontend logic
[x] .env.example exists and contains names only, not secrets
```

---

## 36. Verify AI Endpoint Rate Limiting Is Actually Enforced

The AI endpoint should have server-side controls:

```txt
authenticated user required
max request body size
max messages per request
max message length
max image count
max image size
allowed roles only
max output tokens
hourly/daily request limit per user
subscription/plan check if needed
```

Checklist:

```txt
[x] AI endpoint rejects unauthenticated requests
[x] AI endpoint rejects oversized request bodies
[x] AI endpoint clamps max_tokens
[x] AI endpoint limits message count and text size
[x] AI endpoint logs rejected requests without logging secrets
[x] AI endpoint has per-user rate limiting
```

---

## 37. Add Object-Level Authorization Tests

Backend functions must check object ownership, not just authentication.

Test cases:

```txt
Can user A request user B's subscription by changing user_id?
Can user A request user B's uploaded file metadata?
Can user A call admin search?
Can user A access a room they are not a member of?
Can user A edit/delete another user's message?
Can user A activate a subscription without payment webhook validation?
```

Checklist:

```txt
[x] Backend functions never trust user_id from request body
[x] Backend functions get user from Supabase access token
[x] Backend functions check ownership or room membership before action
[x] Admin functions check admins table or trusted admin claim
```

---

## 38. Improve Room Policies for Real Product Behavior

Current room policies are safe, but may be too restrictive for real chat behavior.

You may eventually need:

```txt
Room members can read room metadata.
Room creators can update/delete the room.
Public rooms can be discovered by authenticated users.
Private rooms can only be read by members.
Invite-code joins are handled carefully.
```

Checklist:

```txt
[ ] Decide public room vs private room behavior
[ ] Add room-member read policy if needed
[ ] Keep update/delete limited to room creator or moderators
[ ] Do not expose private invite codes unnecessarily
```

---

## 39. Add Moderation and Abuse Controls

Because Minallo includes chat/social features, add abuse controls:

```txt
report message/user
block user
delete own messages
admin/moderator delete abusive messages
slow mode enforcement
NSFW/private room handling
rate limit message sending
```

Checklist:

```txt
[x] Report table or report backend endpoint
[x] Admin/moderator review workflow
[x] Message spam limits
[x] Slowmode enforced server-side or by RLS/backend logic
[x] Blocked users cannot DM/interact where relevant
```

---

## 40. Protect Against Public Profile Data Leakage

`profiles` contains personal data such as name, email, university, programme, matriculation number, and age.

If you need public profile search later, do not expose the full `profiles` table.

Better pattern:

```txt
profiles = private profile data
public_profiles = safe public subset
```

Safe public fields might be:

```txt
id
display_name
avatar_url
university only if user consents
```

Do not expose by default:

```txt
email
auth_email
matrikel
age
private programme details if not needed
```

Checklist:

```txt
[x] Keep profiles private
[x] Create public_profiles view/table if needed
[x] Never expose matrikel publicly
[x] Never expose auth_email publicly
```

---

## 41. Add Database Indexes for RLS Performance

RLS policies use columns like `user_id`, `room_id`, `created_by`, and `message_id`.

Recommended indexes:

```sql
create index if not exists idx_settings_id on public.settings(id);
create index if not exists idx_profiles_id on public.profiles(id);
create index if not exists idx_lecture_notes_user_id on public.lecture_notes(user_id);
create index if not exists idx_editor_docs_user_id on public.editor_docs(user_id);
create index if not exists idx_custom_rooms_created_by on public.custom_rooms(created_by);
create index if not exists idx_room_members_user_id on public.room_members(user_id);
create index if not exists idx_room_members_room_id_user_id on public.room_members(room_id, user_id);
create index if not exists idx_messages_room_id on public.messages(room_id);
create index if not exists idx_messages_user_id on public.messages(user_id);
create index if not exists idx_chat_messages_room_id on public.chat_messages(room_id);
create index if not exists idx_friendships_user_id on public.friendships(user_id);
create index if not exists idx_friendships_friend_id on public.friendships(friend_id);
create index if not exists idx_subscriptions_user_id on public.subscriptions(user_id);
```

Checklist:

```txt
[x] Add indexes for all RLS ownership columns
[x] Add indexes for room membership checks
[x] Add indexes for message/reaction joins
```

---

## 42. Add Database Migration Files

Do not keep security SQL only in notes.

Recommended folder:

```txt
supabase/
└── migrations/
    ├── 001_initial_schema.sql
    ├── 002_rls_policies.sql
    ├── 003_storage_policies.sql
    ├── 004_indexes_constraints.sql
    └── 005_security_events.sql
```

Checklist:

```txt
[x] Move RLS policies into migration files
[x] Move indexes and constraints into migration files
[x] Document how to run migrations
[x] Keep production DB changes reproducible
```

---

## 43. Add Backup and Recovery Plan

Checklist:

```txt
[ ] Enable Supabase backups if available on your plan
[ ] Export schema before major DB changes
[ ] Test restoring from backup or export
[x] Keep migration files in GitHub
[ ] Never run destructive SQL without backup
```

---

## 44. Updated Remaining Security Checklist

```txt
[x] Two-account test: Student A cannot read or edit Student B profile/settings
[x] Two-account test: Student A cannot access Student B notes/docs/uploads/subscription
[x] Two-account test: room members can read and post only inside their own rooms
[x] Two-account test: non-members cannot use known room/message IDs
[x] Two-account test: frontend users cannot directly write subscription rows
[x] Verify every backend function rejects missing/invalid auth and malformed input
[ ] GitHub secret scanning
[ ] Dependabot
[ ] CodeQL
[ ] Branch protection
[x] Review Supabase Auth Site URL and Redirect URLs for production-safe values
[x] Remove localhost redirect URLs from production
[x] Add migration files for RLS/storage/indexes
[x] Add database indexes for RLS performance
[ ] Add backup/recovery plan
```

Recently completed in this hardening pass:

```txt
[x] AI per-user rate limiting
[x] Admin authorization using backend + admins table
[x] Remove wildcard API CORS
[x] Add .env.example
```
