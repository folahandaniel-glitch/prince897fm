-- The KPI library gains a measure fed by approved deliverables.
alter table kpi_metrics drop constraint kpi_metrics_source_check;
alter table kpi_metrics add constraint kpi_metrics_source_check check (source in ('punctuality','attendance','task_completion','task_timeliness','report_submission','knowledge','sales_target','new_clients','followups','ticket_sla','deliverables','manual'));
