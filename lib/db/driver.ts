export function getConnectionString(): string {
  return process.env.DATABASE_URL || process.env.POSTGRES_URL || "";
}

export function shouldUseNeon(connectionString: string): boolean {
  return (
    process.env.DATABASE_DRIVER === "neon" ||
    (process.env.DATABASE_DRIVER !== "pg" && /\.neon\.tech/.test(connectionString))
  );
}
