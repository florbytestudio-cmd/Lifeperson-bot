-- MyBot Personal Assistant Schema
-- Ejecuta esto en el SQL Editor de Supabase

-- Categorías (extensible)
create table if not exists categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  icon text default '📁',
  is_default boolean default false,
  created_at timestamptz default now()
);

-- Tarjetas de banco
create table if not exists cards (
  id uuid primary key default gen_random_uuid(),
  bank text not null,
  label text,
  type text check (type in ('credito','debito')) default 'credito',
  color text default '#3B82F6',
  active boolean default true,
  created_at timestamptz default now()
);

-- Transacciones (gastos e ingresos)
create table if not exists transactions (
  id uuid primary key default gen_random_uuid(),
  card_id uuid references cards(id),
  type text check (type in ('gasto','ingreso')) default 'gasto',
  amount numeric(10,2) not null,
  description text,
  category text,
  ticket_url text,
  raw_ocr text,
  created_at timestamptz default now()
);

-- Prospectos FlorByte
create table if not exists prospects (
  id uuid primary key default gen_random_uuid(),
  name text,
  business text,
  platform text,
  profile_url text,
  industry text,
  status text default 'pendiente'
    check (status in ('pendiente','interesado','no_interesado','cerrado')),
  audio_url text,
  transcript text,
  notes text,
  created_at timestamptz default now()
);

-- Membresías
create table if not exists memberships (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  amount numeric(10,2),
  currency text default 'MXN',
  billing_day int check (billing_day between 1 and 31),
  reminder_days int default 3,
  active boolean default true,
  notes text,
  created_at timestamptz default now()
);

-- Tareas
create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  priority text default 'media'
    check (priority in ('alta','media','baja')),
  done boolean default false,
  due_date date,
  category_id uuid references categories(id),
  notes text,
  created_at timestamptz default now(),
  completed_at timestamptz
);

-- Proyectos (clientes activos FlorByte)
create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  client_name text not null,
  description text,
  progress int default 0 check (progress between 0 and 100),
  status text default 'activo'
    check (status in ('activo','pausado','terminado')),
  start_date date,
  deadline date,
  budget numeric(10,2),
  notes text,
  created_at timestamptz default now()
);

-- Notas (búsqueda full-text)
create table if not exists notes (
  id uuid primary key default gen_random_uuid(),
  content text not null,
  tags text[],
  audio_url text,
  transcript text,
  category_id uuid references categories(id),
  created_at timestamptz default now()
);

-- Log de mensajes del bot
create table if not exists bot_logs (
  id uuid primary key default gen_random_uuid(),
  telegram_user_id text,
  message_type text,
  content text,
  response text,
  created_at timestamptz default now()
);

-- Índice para búsqueda de notas
create index if not exists notes_search_idx on notes using gin(to_tsvector('spanish', content));

-- RLS (permisivo para desarrollo)
do $$ begin
  alter table categories enable row level security;
  alter table cards enable row level security;
  alter table transactions enable row level security;
  alter table prospects enable row level security;
  alter table memberships enable row level security;
  alter table tasks enable row level security;
  alter table projects enable row level security;
  alter table notes enable row level security;
  alter table bot_logs enable row level security;
exception when others then null;
end $$;

create policy "allow all" on categories for all using (true);
create policy "allow all" on cards for all using (true);
create policy "allow all" on transactions for all using (true);
create policy "allow all" on prospects for all using (true);
create policy "allow all" on memberships for all using (true);
create policy "allow all" on tasks for all using (true);
create policy "allow all" on projects for all using (true);
create policy "allow all" on notes for all using (true);
create policy "allow all" on bot_logs for all using (true);

-- Datos iniciales
insert into categories (name, icon, is_default) values
  ('Banco', '🏦', true),
  ('FlorByte', '💼', true),
  ('Membresías', '📦', true),
  ('Tareas', '✅', true),
  ('Proyectos', '📁', true),
  ('Notas', '📝', true)
on conflict (name) do nothing;

insert into cards (bank, label, type) values
  ('Santander', 'Santander', 'credito'),
  ('BBVA', 'BBVA', 'credito')
on conflict do nothing;

insert into memberships (name, amount, currency, billing_day, reminder_days) values
  ('YouTube Music', 99, 'MXN', 15, 3)
on conflict do nothing;
