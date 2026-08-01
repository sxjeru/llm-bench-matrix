ALTER TABLE "models"
  ADD COLUMN IF NOT EXISTS "total_params_b" NUMERIC(10, 3);

ALTER TABLE "models"
  ADD COLUMN IF NOT EXISTS "activated_params_b" NUMERIC(10, 3);

ALTER TABLE "models"
  ADD COLUMN IF NOT EXISTS "params_is_estimated" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "models"
  ADD COLUMN IF NOT EXISTS "params_note" TEXT;

ALTER TABLE "models"
  DROP CONSTRAINT IF EXISTS "models_params_range";
ALTER TABLE "models"
  ADD CONSTRAINT "models_params_range" CHECK (
    ("total_params_b" IS NULL OR "total_params_b" > 0)
    AND ("activated_params_b" IS NULL OR "activated_params_b" > 0)
    AND (
      "activated_params_b" IS NULL
      OR "total_params_b" IS NULL
      OR "activated_params_b" <= "total_params_b"
    )
  );
