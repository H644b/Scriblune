-- Private quizzes: browser/service clients cannot query answer keys directly.
create table private.practice_quizzes (
 id uuid primary key,
 account_id uuid not null references auth.users(id) on delete cascade,
 title text not null check(length(btrim(title)) between 1 and 160),
 difficulty text not null check(difficulty in ('easier','similar','harder')),
 question_count integer not null check(question_count between 1 and 20),
 request_hash text not null check(length(request_hash)=64),
 status text not null default 'generating' check(status in ('generating','in_progress','completed','failed')),
 generation_started boolean not null default false,
 sources jsonb not null default '[]' check(jsonb_typeof(sources)='array'),
 questions jsonb not null default '[]' check(jsonb_typeof(questions)='array'),
 answers jsonb not null default '[]' check(jsonb_typeof(answers)='array'),
 revision integer not null default 0 check(revision>=0),
 correct_count integer check(correct_count between 0 and question_count),
 error text check(length(error)<=300),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 completed_at timestamptz,
 check(status<>'completed' or (correct_count is not null and completed_at is not null))
);
create index practice_quizzes_account_updated on private.practice_quizzes(account_id,updated_at desc,id);
alter table private.practice_quizzes enable row level security;
revoke all on private.practice_quizzes from public,anon,authenticated,service_role;
grant select,insert,update,delete on private.practice_quizzes to scriblune_server;
create policy practice_quizzes_account on private.practice_quizzes to scriblune_server
 using(account_id=(select private.account_id())) with check(account_id=(select private.account_id()));
