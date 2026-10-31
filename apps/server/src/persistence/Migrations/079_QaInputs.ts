import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE qa_run_inputs (run_id TEXT PRIMARY KEY REFERENCES qa_runs(id) ON DELETE CASCADE, evidence_json TEXT NOT NULL)`;
});
