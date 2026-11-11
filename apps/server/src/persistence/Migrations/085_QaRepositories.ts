import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

// QA history belongs to a repository and ref. `qa_key` stays null until QaService resolves the
// run's project to its repository; `ref` is '' for a run in a project's own checkout.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE qa_runs ADD COLUMN qa_key TEXT`;
  yield* sql`ALTER TABLE qa_runs ADD COLUMN ref TEXT NOT NULL DEFAULT ''`;
  yield* sql`DROP INDEX qa_runs_active_project`;
  yield* sql`CREATE INDEX qa_runs_scope ON qa_runs(qa_key, ref, started_at DESC)`;
  yield* sql`CREATE INDEX qa_runs_scope_suite ON qa_runs(qa_key, ref, suite_id, started_at DESC)`;
  yield* sql`CREATE UNIQUE INDEX qa_runs_active_scope ON qa_runs(qa_key) WHERE status = 'running'`;
  yield* sql`CREATE TABLE qa_ref_schedules (
    qa_key TEXT NOT NULL,
    ref TEXT NOT NULL,
    project_id TEXT NOT NULL,
    schedule_json TEXT NOT NULL,
    PRIMARY KEY (qa_key, ref)
  )`;
});
