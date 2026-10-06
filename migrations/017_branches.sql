-- Branch details and Google coordinates (set from the BackEnd). A branch with coordinates gets a matching geofenced workplace for attendance.
alter table branches add column address text;
alter table branches add column latitude numeric(9,6) check (latitude between -90 and 90);
alter table branches add column longitude numeric(9,6) check (longitude between -180 and 180);
alter table branches add column radius_m int not null default 150 check (radius_m between 20 and 5000);
alter table branches add column phone text;
alter table branches add column is_headquarters boolean not null default false;

-- Existing organisations: copy coordinates from the geofenced workplace already linked to each branch.
update branches b set latitude = w.latitude, longitude = w.longitude, radius_m = w.radius_m, address = coalesce(b.address, w.address), is_headquarters = (w.kind = 'headquarters')
  from workplaces w where w.branch_id = b.id and w.kind in ('headquarters','branch') and w.latitude is not null and b.latitude is null;
