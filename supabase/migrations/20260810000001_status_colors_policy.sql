-- Status colours become a property of the company, not of a browser.
--
-- They lived in localStorage under 'king_david_status_colors', which meant an
-- admin who coloured the statuses changed them for exactly one browser on one
-- machine. Nobody on the floor saw it, and the same admin lost the work on a
-- new laptop or a cleared cache. Colour is a shared vocabulary — "the red ones
-- need calling" only means something if red is red for everyone.
--
-- app_policies is already the home for settings that apply to the whole
-- company (lead_visibility lives there), so the map joins it rather than
-- earning a table of its own. Shape: { "<status_value>": "<preset_id>" },
-- where preset_id is an id from STATUS_COLOR_PRESETS in
-- src/constants/statusColors.js. An unknown id falls back to the status's
-- built-in colour, so a stale row can never render an unstyled badge.

alter table app_policies
  add column if not exists status_colors jsonb not null default '{}'::jsonb;

comment on column app_policies.status_colors is
  'Per-status colour overrides shared by the whole company: { status_value: preset_id }. Preset ids come from src/constants/statusColors.js.';

-- The singleton row must exist for the update path to have something to write.
insert into app_policies (id)
values (1)
on conflict (id) do nothing;
