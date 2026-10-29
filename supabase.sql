-- Выполни весь этот SQL в Supabase: SQL Editor -> New query -> Run.
-- Включает таблицы, безопасные политики доступа и создание профиля после регистрации.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Пользователь' check (char_length(display_name) between 2 and 40),
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles(id) on delete cascade,
  receiver_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now(),
  constraint messages_not_to_self check (sender_id <> receiver_id)
);

create index if not exists messages_sender_receiver_created_idx
  on public.messages (sender_id, receiver_id, created_at);
create index if not exists messages_receiver_sender_created_idx
  on public.messages (receiver_id, sender_id, created_at);

alter table public.profiles enable row level security;
alter table public.messages enable row level security;

-- Удаляем политики с такими именами, чтобы скрипт можно было запускать повторно.
drop policy if exists "Authenticated users can view profiles" on public.profiles;
drop policy if exists "Users can insert their own profile" on public.profiles;
drop policy if exists "Users can update their own profile" on public.profiles;
drop policy if exists "Chat participants can read messages" on public.messages;
drop policy if exists "Users can send messages as themselves" on public.messages;

create policy "Authenticated users can view profiles"
  on public.profiles for select to authenticated
  using (true);

create policy "Users can insert their own profile"
  on public.profiles for insert to authenticated
  with check (auth.uid() = id);

create policy "Users can update their own profile"
  on public.profiles for update to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

create policy "Chat participants can read messages"
  on public.messages for select to authenticated
  using (auth.uid() = sender_id or auth.uid() = receiver_id);

create policy "Users can send messages as themselves"
  on public.messages for insert to authenticated
  with check (
    auth.uid() = sender_id
    and sender_id <> receiver_id
    and exists (select 1 from public.profiles p where p.id = receiver_id)
  );

-- Создаёт профиль для каждого нового пользователя.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, email)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(new.email, '@', 1), 'Пользователь'),
    new.email
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Включи Realtime для таблицы messages, если она ещё не включена.
-- Если следующая команда выдаст ошибку "already member", таблица уже добавлена — это нормально.
alter publication supabase_realtime add table public.messages;
