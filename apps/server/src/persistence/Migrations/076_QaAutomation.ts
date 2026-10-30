import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE qa_schedules (
    project_id TEXT PRIMARY KEY,
    schedule_json TEXT NOT NULL
  )`;
  yield* sql`CREATE TABLE qa_ci_imports (
    project_id TEXT NOT NULL,
    suite_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    external_id TEXT NOT NULL,
    run_id TEXT NOT NULL REFERENCES qa_runs(id) ON DELETE CASCADE,
    payload_hash TEXT NOT NULL,
    PRIMARY KEY (project_id, suite_id, provider, external_id)
  )`;
});
