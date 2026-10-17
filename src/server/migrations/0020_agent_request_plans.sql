-- Plans AI agents prepared through MCP's ask_everyops: the checked plan and the design version it was made for.
-- apply_change applies one (status 'planned' -> 'applied'); a plan that has to wait for a person (team changes,
-- removals while "Always ask before removing" is on) goes to the owners' Requests from agents ('open').
alter table agent_request add column if not exists plan jsonb;
alter table agent_request add column if not exists base_version int;
