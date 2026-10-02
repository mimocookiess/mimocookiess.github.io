const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { PGlite } = require(
  process.env.MIMO_PGLITE_MODULE || "@electric-sql/pglite"
);

(async () => {
  const db = new PGlite();
  await db.exec(`
    create role authenticated;
    create table public.store_settings (
      id smallint primary key,
      is_paused boolean,
      return_time timestamptz,
      pause_message text,
      store_mode text
    );
    grant update (is_paused, return_time, pause_message, store_mode)
      on public.store_settings to authenticated;
  `);
  await db.exec(fs.readFileSync(path.join(
    __dirname,
    "../supabase/migrations/20261001120000_add_manual_store_opening.sql"
  ), "utf8"));

  const { rows: [column] } = await db.query(`
    select data_type, is_nullable
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'store_settings'
      and column_name = 'manual_open_until'
  `);
  const { rows: [permission] } = await db.query(`
    select has_column_privilege(
      'authenticated',
      'public.store_settings',
      'manual_open_until',
      'UPDATE'
    ) as allowed
  `);

  assert.deepEqual(column, {
    data_type: "timestamp with time zone",
    is_nullable: "YES"
  });
  assert.equal(permission.allowed, true);
  console.log("Migration local: coluna nullable e grant UPDATE validados.");
  await db.close();
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
