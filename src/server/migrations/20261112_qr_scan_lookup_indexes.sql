CREATE INDEX IF NOT EXISTS idx_qr_codes_label_upper
  ON qr_codes (UPPER(label_id));

CREATE INDEX IF NOT EXISTS idx_qr_codes_qr_id
  ON qr_codes (qr_id);

CREATE INDEX IF NOT EXISTS idx_qr_codes_assigned_user
  ON qr_codes (assigned_user_id);

CREATE INDEX IF NOT EXISTS idx_qr_codes_label_upper_created_at
  ON qr_codes (UPPER(label_id), created_at DESC);
