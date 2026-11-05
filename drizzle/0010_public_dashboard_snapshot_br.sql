-- 快照改为存 Brotli 压缩后的字节：冷启动只需读 ~350 KB，而不是 3.5 MB 的 JSON 文本。
--
-- payload_json 保留为可空列，用于兼容升级前写入的旧行；
-- 旧行在下一次读取时会被就地压缩并回填 payload_br，之后 payload_json 恒为 null。
ALTER TABLE "public_dashboard_snapshots" ALTER COLUMN "payload_json" DROP NOT NULL;
ALTER TABLE "public_dashboard_snapshots" ADD COLUMN IF NOT EXISTS "payload_br" "bytea";
