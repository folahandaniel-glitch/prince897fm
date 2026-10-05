-- Two-way shift exchange: the colleague hands one of their own shifts back.
alter table shift_swaps add column counter_entry_id uuid references roster_entries(id);
alter table shift_swaps add column counter_date date;
alter table shift_swaps add column counter_shift_id uuid references shifts(id);
create unique index swap_one_open_counter on shift_swaps (counter_entry_id) where counter_entry_id is not null and status in ('awaiting_colleague','awaiting_manager');
