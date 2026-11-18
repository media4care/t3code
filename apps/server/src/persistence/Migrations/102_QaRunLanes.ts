import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

// Suites once ran per platform, and each run named its platform. Suites now run per device and
// variant, which no saved platform maps onto, so those runs read as runs of the whole suite.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    UPDATE qa_runs
    SET run_json = json_remove(run_json, '$.suite.runPer', '$.platform')
    WHERE json_extract(run_json, '$.suite.runPer') = 'platform'
  `;
});
