/**
 * Server PostgreSQL lokal untuk pengembangan (embedded-postgres).
 * Produksi memakai instance PostgreSQL sendiri lewat DATABASE_URL.
 *
 * Jalankan: npm run dev:db   (data tersimpan di ./.pgdata)
 */
import EmbeddedPostgres from "embedded-postgres";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import pg from "pg";

const PORT = Number(process.env.DEV_DB_PORT ?? 5443);
const USER = process.env.DEV_DB_USER ?? "netcontrol";
const PASSWORD = process.env.DEV_DB_PASSWORD ?? "netcontrol";
const DB_NAME = process.env.DEV_DB_NAME ?? "netcontrol";
const DATA_DIR = path.resolve(process.cwd(), ".pgdata");

mkdirSync(DATA_DIR, { recursive: true });

const instance = new EmbeddedPostgres({
  databaseDir: DATA_DIR,
  port: PORT,
  user: USER,
  password: PASSWORD,
  authMethod: "password",
  persistent: true,
  createPostgresUser: false,
  onLog: () => {},
  onError: (e) => console.error("[postgres]", e),
});

if (!existsSync(path.join(DATA_DIR, "PG_VERSION"))) {
  console.log(`[dev:db] menginisialisasi cluster baru di ${DATA_DIR}`);
  await instance.initialise();
} else {
  console.log(`[dev:db] memakai cluster yang ada di ${DATA_DIR}`);
}

await instance.start();

const admin = new pg.Client({
  host: "127.0.0.1",
  port: PORT,
  user: USER,
  password: PASSWORD,
  database: "postgres",
});
await admin.connect();
const existing = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [
  DB_NAME,
]);
if ((existing.rowCount ?? 0) === 0) {
  await admin.query(`CREATE DATABASE "${DB_NAME}"`);
  console.log(`[dev:db] database "${DB_NAME}" dibuat`);
} else {
  console.log(`[dev:db] database "${DB_NAME}" sudah ada`);
}
await admin.end();

console.log(
  `[dev:db] siap: postgresql://${USER}:***@127.0.0.1:${PORT}/${DB_NAME}?schema=public`,
);

const shutdown = async () => {
  console.log("\n[dev:db] menghentikan postgres…");
  await instance.stop().catch(() => {});
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
await new Promise(() => {});