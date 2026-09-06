create table rejected_dashboard_logins (
  rejected_dashboard_login_id text primary key,
  github_id text not null,
  github_login text not null,
  reason text not null,
  created_at text not null
);

create index rejected_dashboard_logins_created_at
  on rejected_dashboard_logins (created_at desc, rejected_dashboard_login_id desc);
