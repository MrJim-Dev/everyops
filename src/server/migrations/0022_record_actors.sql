-- Who added each record and who changed it last: the person, public form, automation, API key, agent or sync that
-- wrote it, as {type, id, name}. Stamped by the server on every write, never taken from the browser. Records
-- written before this have none and read as blank.
alter table workspace_record add column if not exists created_by jsonb;
alter table workspace_record add column if not exists updated_by jsonb;
