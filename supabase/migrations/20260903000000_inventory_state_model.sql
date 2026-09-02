-- Full inventory state model (SP-3): tracks reserved, damaged, expired and
-- in-transit stock alongside on-hand, so "available" is accurate and future
-- Sales Orders can reserve stock without overselling.
--
-- available = on_hand - reserved - damaged - expired. A unit that's
-- reserved, damaged or expired is still physically in the warehouse (it
-- stays part of on_hand) but isn't sellable. Incoming and in-transit are
-- informational only and are not subtracted from on_hand here.
--
-- 'damage' already existed as a movement_type but the old trigger treated
-- it as a write-off (decrementing on_hand like an outbound). That's being
-- redefined below to mean "flag as damaged" (increments damaged, on_hand
-- unchanged) — the correct fit for the state model above. This type has
-- never been used in any shipped seed data or migration, so redefining it
-- carries no migration burden for existing rows.
--
-- in_transit is schema-only for now: no movement type writes it yet. It's
-- reserved for the future stock-transfers feature.

ALTER TYPE public.movement_type ADD VALUE IF NOT EXISTS 'reserve';
ALTER TYPE public.movement_type ADD VALUE IF NOT EXISTS 'unreserve';
ALTER TYPE public.movement_type ADD VALUE IF NOT EXISTS 'expired';

ALTER TABLE public.stock_levels ADD COLUMN IF NOT EXISTS damaged NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE public.stock_levels ADD COLUMN IF NOT EXISTS expired NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE public.stock_levels ADD COLUMN IF NOT EXISTS in_transit NUMERIC(14,2) NOT NULL DEFAULT 0;
