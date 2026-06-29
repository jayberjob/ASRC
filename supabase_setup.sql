-- ASRC 정기회의 사이트용 Supabase 초기 설정
-- Supabase Dashboard > SQL Editor > New query 에 전체 붙여넣고 Run 하세요.

create schema if not exists private;
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.opinions (
  id uuid primary key default extensions.gen_random_uuid(),
  meeting_id text not null check (meeting_id in ('2026-first', '2026-second')),
  nickname varchar(12) not null check (char_length(trim(nickname)) between 1 and 12),
  category text not null check (category in ('운영', '러닝', '친목', '안전', '기타')),
  title varchar(40) not null check (char_length(trim(title)) between 1 and 40),
  content varchar(500) not null check (char_length(trim(content)) between 1 and 500),
  likes integer not null default 0 check (likes >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists private.opinion_secrets (
  opinion_id uuid primary key references public.opinions(id) on delete cascade,
  password_hash text not null
);

create table if not exists private.opinion_likes (
  opinion_id uuid not null references public.opinions(id) on delete cascade,
  voter_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (opinion_id, voter_id)
);

create index if not exists opinions_meeting_created_idx
  on public.opinions (meeting_id, created_at desc);

alter table public.opinions enable row level security;

drop policy if exists "Anyone can read ASRC opinions" on public.opinions;
create policy "Anyone can read ASRC opinions"
on public.opinions
for select
to anon, authenticated
using (true);

-- 브라우저에서는 공개 의견만 읽을 수 있고, 쓰기/수정/삭제는 아래 함수만 통과합니다.
revoke all on table public.opinions from anon, authenticated;
grant select on table public.opinions to anon, authenticated;
revoke all on schema private from public, anon, authenticated;
revoke all on all tables in schema private from public, anon, authenticated;

create or replace function public.create_opinion(
  p_meeting_id text,
  p_nickname text,
  p_category text,
  p_title text,
  p_content text,
  p_password text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_meeting_id not in ('2026-first', '2026-second') then
    raise exception '올바르지 않은 회의입니다.';
  end if;
  if char_length(trim(coalesce(p_nickname, ''))) not between 1 and 12 then
    raise exception '닉네임은 1~12자로 입력해주세요.';
  end if;
  if p_category not in ('운영', '러닝', '친목', '안전', '기타') then
    raise exception '올바르지 않은 분야입니다.';
  end if;
  if char_length(trim(coalesce(p_title, ''))) not between 1 and 40 then
    raise exception '제목은 1~40자로 입력해주세요.';
  end if;
  if char_length(trim(coalesce(p_content, ''))) not between 1 and 500 then
    raise exception '내용은 1~500자로 입력해주세요.';
  end if;
  if coalesce(p_password, '') !~ '^[0-9]{4}$' then
    raise exception '비밀번호는 숫자 4자리여야 합니다.';
  end if;

  insert into public.opinions (meeting_id, nickname, category, title, content)
  values (
    p_meeting_id,
    trim(p_nickname),
    p_category,
    trim(p_title),
    trim(p_content)
  )
  returning id into v_id;

  insert into private.opinion_secrets (opinion_id, password_hash)
  values (v_id, extensions.crypt(p_password, extensions.gen_salt('bf')));

  return v_id;
end;
$$;

create or replace function public.verify_opinion_password(
  p_id uuid,
  p_password text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash text;
begin
  select password_hash
    into v_hash
  from private.opinion_secrets
  where opinion_id = p_id;

  return v_hash is not null
    and extensions.crypt(coalesce(p_password, ''), v_hash) = v_hash;
end;
$$;

create or replace function public.update_opinion(
  p_id uuid,
  p_password text,
  p_nickname text,
  p_category text,
  p_title text,
  p_content text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.verify_opinion_password(p_id, p_password) then
    return false;
  end if;
  if char_length(trim(coalesce(p_nickname, ''))) not between 1 and 12 then
    raise exception '닉네임은 1~12자로 입력해주세요.';
  end if;
  if p_category not in ('운영', '러닝', '친목', '안전', '기타') then
    raise exception '올바르지 않은 분야입니다.';
  end if;
  if char_length(trim(coalesce(p_title, ''))) not between 1 and 40 then
    raise exception '제목은 1~40자로 입력해주세요.';
  end if;
  if char_length(trim(coalesce(p_content, ''))) not between 1 and 500 then
    raise exception '내용은 1~500자로 입력해주세요.';
  end if;

  update public.opinions
  set nickname = trim(p_nickname),
      category = p_category,
      title = trim(p_title),
      content = trim(p_content),
      updated_at = now()
  where id = p_id;

  return found;
end;
$$;

create or replace function public.delete_opinion(
  p_id uuid,
  p_password text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.verify_opinion_password(p_id, p_password) then
    return false;
  end if;

  delete from public.opinions where id = p_id;
  return found;
end;
$$;

create or replace function public.toggle_opinion_like(
  p_opinion_id uuid,
  p_voter_id uuid
)
returns table (is_liked boolean, like_count integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  perform 1 from public.opinions where id = p_opinion_id for update;
  if not found then
    raise exception '존재하지 않는 의견입니다.';
  end if;

  delete from private.opinion_likes
  where opinion_id = p_opinion_id and voter_id = p_voter_id;

  if found then
    update public.opinions
    set likes = greatest(likes - 1, 0)
    where id = p_opinion_id
    returning likes into v_count;

    return query select false, v_count;
  else
    insert into private.opinion_likes (opinion_id, voter_id)
    values (p_opinion_id, p_voter_id);

    update public.opinions
    set likes = likes + 1
    where id = p_opinion_id
    returning likes into v_count;

    return query select true, v_count;
  end if;
end;
$$;

create or replace function public.get_my_liked_opinions(
  p_voter_id uuid,
  p_meeting_id text
)
returns table (opinion_id uuid)
language sql
security definer
set search_path = ''
stable
as $$
  select l.opinion_id
  from private.opinion_likes l
  join public.opinions o on o.id = l.opinion_id
  where l.voter_id = p_voter_id
    and o.meeting_id = p_meeting_id;
$$;

revoke all on function public.create_opinion(text, text, text, text, text, text) from public;
revoke all on function public.verify_opinion_password(uuid, text) from public;
revoke all on function public.update_opinion(uuid, text, text, text, text, text) from public;
revoke all on function public.delete_opinion(uuid, text) from public;
revoke all on function public.toggle_opinion_like(uuid, uuid) from public;
revoke all on function public.get_my_liked_opinions(uuid, text) from public;

grant execute on function public.create_opinion(text, text, text, text, text, text) to anon, authenticated;
grant execute on function public.verify_opinion_password(uuid, text) to anon, authenticated;
grant execute on function public.update_opinion(uuid, text, text, text, text, text) to anon, authenticated;
grant execute on function public.delete_opinion(uuid, text) to anon, authenticated;
grant execute on function public.toggle_opinion_like(uuid, uuid) to anon, authenticated;
grant execute on function public.get_my_liked_opinions(uuid, text) to anon, authenticated;

-- 의견 등록/수정/삭제/공감이 다른 접속자 화면에도 바로 반영되도록 Realtime에 추가합니다.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'opinions'
  ) then
    alter publication supabase_realtime add table public.opinions;
  end if;
end $$;
