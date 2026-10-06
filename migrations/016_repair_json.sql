-- Repair: on a real Postgres connection, JSON that the application sent as text was stored as a JSON *string* (double-encoded)
-- instead of an object. Convert any such value back. Only strings that look like a JSON object/array are touched.
do $$
declare r record;
begin
  for r in
    select c.table_name, c.column_name
      from information_schema.columns c join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
     where c.table_schema = current_schema() and c.data_type = 'jsonb' and t.table_type = 'BASE TABLE'
  loop
    begin
      execute format('update %I set %I = (%I #>> ''{}'')::jsonb where jsonb_typeof(%I) = ''string'' and left(%I #>> ''{}'', 1) in (''{'', ''['')',
                     r.table_name, r.column_name, r.column_name, r.column_name, r.column_name);
    exception when others then null; -- e.g. frozen payslips: leave that table as it is
    end;
  end loop;
end $$;
