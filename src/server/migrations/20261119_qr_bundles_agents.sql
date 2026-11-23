CREATE TABLE IF NOT EXISTS public.agents (
  agent_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES public.merchants(merchant_id),
  name text NOT NULL,
  phone text,
  address text,
  status varchar NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Inactive')),
  created_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS agents_merchant_lower_name_uidx
  ON public.agents (merchant_id, lower(name));

CREATE TABLE IF NOT EXISTS public.qr_bundles (
  bundle_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES public.merchants(merchant_id),
  bundle_code text NOT NULL UNIQUE,
  variant_id uuid NOT NULL REFERENCES public.variants(variant_id),
  qty integer NOT NULL CHECK (qty > 0),
  remarks text,
  expiry_date date,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'assigned', 'voided')),
  agent_id uuid REFERENCES public.agents(agent_id),
  assigned_at timestamptz,
  assigned_by uuid REFERENCES public.users(user_id),
  created_by uuid REFERENCES public.users(user_id),
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.qr_bundle_items (
  bundle_id uuid NOT NULL REFERENCES public.qr_bundles(bundle_id) ON DELETE CASCADE,
  qr_batch uuid NOT NULL REFERENCES public.qr_codes(qr_batch),
  PRIMARY KEY (bundle_id, qr_batch),
  UNIQUE (qr_batch)
);

CREATE INDEX IF NOT EXISTS qr_bundles_merchant_created_idx
  ON public.qr_bundles (merchant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS qr_bundles_agent_idx
  ON public.qr_bundles (agent_id);
