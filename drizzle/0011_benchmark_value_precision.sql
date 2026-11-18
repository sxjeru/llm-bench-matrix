-- 量级后缀（k/M/B/T）会带来 `1.2T` 这类输入，换算后需要 13 位整数位；
-- 原 numeric(14, 6) 只有 8 位整数位，B/T 级别会直接溢出。
ALTER TABLE "benchmark_values" ALTER COLUMN "value_num" SET DATA TYPE numeric(20, 6);
ALTER TABLE "benchmark_values" ALTER COLUMN "value_num2" SET DATA TYPE numeric(20, 6);
