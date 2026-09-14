CREATE TABLE IF NOT EXISTS "public_dashboard_snapshots" (
	"key" text PRIMARY KEY NOT NULL,
	"etag" text NOT NULL,
	"dashboard_version" text NOT NULL,
	"pricing_version" text NOT NULL,
	"settings_version" text NOT NULL,
	"payload_json" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

