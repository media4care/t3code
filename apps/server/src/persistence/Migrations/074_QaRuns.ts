import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE qa_runs (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    suite_id TEXT NOT NULL,
    started_at TEXT NOT NULL,
    status TEXT NOT NULL,
    run_json TEXT NOT NULL,
    output TEXT NOT NULL DEFAULT '',
    output_truncated INTEGER NOT NULL DEFAULT 0,
    report_xml TEXT
  )`;
  yield* sql`CREATE INDEX qa_runs_project ON qa_runs(project_id, started_at DESC)`;
  yield* sql`CREATE INDEX qa_runs_suite ON qa_runs(project_id, suite_id, started_at DESC)`;
  yield* sql`CREATE UNIQUE INDEX qa_runs_active_project ON qa_runs(project_id) WHERE status = 'running'`;
});
