create table if not exists public.shared_settings (
  key text primary key check (key in ('products', 'emailjs')),
  value jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.shared_settings enable row level security;
revoke all on table public.shared_settings from anon, authenticated;
grant select on table public.shared_settings to anon, authenticated;
grant insert, update, delete on table public.shared_settings to authenticated;

drop policy if exists "Public can read shared settings" on public.shared_settings;
drop policy if exists "Admins can insert shared settings" on public.shared_settings;
drop policy if exists "Admins can update shared settings" on public.shared_settings;
drop policy if exists "Admins can delete shared settings" on public.shared_settings;

create policy "Public can read shared settings"
on public.shared_settings for select
to anon, authenticated
using (true);

create policy "Admins can insert shared settings"
on public.shared_settings for insert
to authenticated
with check (true);

create policy "Admins can update shared settings"
on public.shared_settings for update
to authenticated
using (true)
with check (true);

create policy "Admins can delete shared settings"
on public.shared_settings for delete
to authenticated
using (true);

create table if not exists public.orders (
  id text primary key,
  customer_name text not null check (length(customer_name) between 1 and 120),
  customer_email text not null check (length(customer_email) between 3 and 320),
  phone text not null default '',
  notes text not null default '',
  items jsonb not null check (jsonb_typeof(items) = 'array'),
  total numeric(10, 2) not null check (total >= 0),
  created_at timestamptz not null,
  expires_at timestamptz not null,
  status text not null default 'pending',
  payment text not null default 'cash in person'
);

alter table public.orders enable row level security;
revoke all on table public.orders from anon, authenticated;
grant insert on table public.orders to anon, authenticated;
grant select, delete on table public.orders to authenticated;

drop policy if exists "Customers can submit orders" on public.orders;
drop policy if exists "Admins can read orders" on public.orders;
drop policy if exists "Admins can delete orders" on public.orders;

create policy "Customers can submit orders"
on public.orders for insert
to anon, authenticated
with check (
  length(trim(customer_name)) > 0
  and length(trim(customer_email)) > 2
  and jsonb_typeof(items) = 'array'
  and total >= 0
);

create policy "Admins can read orders"
on public.orders for select
to authenticated
using (true);

create policy "Admins can delete orders"
on public.orders for delete
to authenticated
using (true);