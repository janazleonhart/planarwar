--- worldcore/infra/schema/027_add_talk_to_objective.sql

ALTER TYPE quest_objective_kind
  ADD VALUE IF NOT EXISTS 'talk_to';