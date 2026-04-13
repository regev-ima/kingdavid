-- =============================================
-- PRODUCT ADDONS TABLE
-- =============================================

CREATE TABLE product_addons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  base_price NUMERIC(10,2) NOT NULL DEFAULT 0,
  vat_percent NUMERIC(5,2) NOT NULL DEFAULT 18,
  final_price NUMERIC(10,2) NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_product_addons_updated_at
  BEFORE UPDATE ON product_addons
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- =============================================
-- PRODUCT ADDON PRICES (per variation)
-- =============================================

CREATE TABLE product_addon_prices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  addon_id UUID NOT NULL REFERENCES product_addons(id) ON DELETE CASCADE,
  variation_id UUID NOT NULL REFERENCES product_variations(id) ON DELETE CASCADE,
  price NUMERIC(10,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(addon_id, variation_id)
);

CREATE INDEX idx_product_addon_prices_addon ON product_addon_prices(addon_id);
CREATE INDEX idx_product_addon_prices_variation ON product_addon_prices(variation_id);

-- =============================================
-- EXTRA CHARGES TABLE
-- =============================================

CREATE TABLE extra_charges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_extra_charges_updated_at
  BEFORE UPDATE ON extra_charges
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
