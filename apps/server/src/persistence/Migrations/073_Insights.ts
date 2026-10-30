import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE insights_settings (id INTEGER PRIMARY KEY CHECK (id = 1), payload_json TEXT NOT NULL)`;
  yield* sql`CREATE TABLE insights_reports (
    id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, status TEXT NOT NULL,
    created_at TEXT NOT NULL, through_sequence INTEGER NOT NULL, payload_json TEXT NOT NULL
  )`;
  yield* sql`CREATE INDEX insights_reports_created_idx ON insights_reports(created_at DESC)`;
  yield* sql`CREATE TABLE insights_recommendations (
    id TEXT PRIMARY KEY, insight_key TEXT NOT NULL UNIQUE, status TEXT NOT NULL,
    updated_at TEXT NOT NULL, payload_json TEXT NOT NULL
  )`;
  yield* sql`CREATE TABLE insights_attributions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, thread_id TEXT NOT NULL, run_id TEXT,
    created_at TEXT NOT NULL, payload_json TEXT NOT NULL
  )`;
  yield* sql`CREATE INDEX insights_attributions_run_idx ON insights_attributions(run_id)`;
});
