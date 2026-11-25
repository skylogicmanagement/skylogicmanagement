alter table public.inventory_items
  add column minimum_quantity numeric(14, 3) not null default 0
    check (minimum_quantity >= 0);

grant update (minimum_quantity) on public.inventory_items to authenticated;
