CREATE TABLE IF NOT EXISTS points (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  director TEXT,
  winner TEXT,
  note TEXT,
  status TEXT DEFAULT 'planowany',
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- jeśli tabela już istnieje, dołóż brakujące kolumny
ALTER TABLE points ADD COLUMN IF NOT EXISTS director TEXT;
ALTER TABLE points ADD COLUMN IF NOT EXISTS winner TEXT;
-- USERS (logowanie)
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Indexes for recent updates feed
create index if not exists point_comments_created_at_idx
  on point_comments (created_at desc);

create index if not exists tunnel_comments_created_at_idx
  on tunnel_comments (created_at desc);

create index if not exists point_comments_point_id_idx
  on point_comments (point_id);

create index if not exists tunnel_comments_tunnel_id_idx
  on tunnel_comments (tunnel_id);

