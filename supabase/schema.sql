-- Rode no SQL Editor do Supabase

create table public.rotas (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  origem text not null,
  destino text not null,
  horarios text[] not null default '{}',
  whatsapp_url text,
  arquivo_path text,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.rotas enable row level security;

create policy "todos leem" on public.rotas for select using (true);
create policy "logado cria" on public.rotas for insert to authenticated with check (user_id = auth.uid());
create policy "dono edita" on public.rotas for update to authenticated using (user_id = auth.uid());
create policy "dono apaga" on public.rotas for delete to authenticated using (user_id = auth.uid());

-- Realtime
alter publication supabase_realtime add table public.rotas;

-- Storage (bucket público para baixar horários em PDF/imagem)
insert into storage.buckets (id, name, public) values ('horarios', 'horarios', true);

create policy "todos baixam" on storage.objects for select using (bucket_id = 'horarios');
create policy "logado envia" on storage.objects for insert to authenticated
  with check (bucket_id = 'horarios' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "dono remove arquivo" on storage.objects for delete to authenticated
  using (bucket_id = 'horarios' and (storage.foldername(name))[1] = auth.uid()::text);
