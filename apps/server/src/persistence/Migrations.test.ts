import { assert, describe, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { QaRun } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as Migrator from "effect/sql/Migrator";
import * as Ref from "effect/Ref";
import * as Logger from "effect/Logger";
import * as Console from "effect/Console";
import * as NodeUtil from "node:util";
import type { DatabaseMigrationProgress as Progress } from "@t3tools/contracts";
import {
  databaseMigrationProgress,
  DATABASE_MIGRATION_PROGRESS_MESSAGE,
} from "@t3tools/shared/databaseMigrationLog";
import * as DatabaseMigrationProgress from "./DatabaseMigrationProgress.ts";

import { migrationManifest, runMigrations } from "./Migrations.ts";
import Insights from "./Migrations/120_Insights.ts";
import QaRuns from "./Migrations/121_QaRuns.ts";
import QaInputs from "./Migrations/122_QaInputs.ts";
import QaAutomation from "./Migrations/123_QaAutomation.ts";
import QaRepositories from "./Migrations/124_QaRepositories.ts";
import QaRunLanes from "./Migrations/125_QaRunLanes.ts";

const explorerMigrations = [
  ["Insights", Insights],
  ["QaRuns", QaRuns],
  ["QaInputs", QaInputs],
  ["QaAutomation", QaAutomation],
  ["QaRepositories", QaRepositories],
  ["QaRunLanes", QaRunLanes],
] as const;

// Explorer builds recorded their migrations right after upstream's 72, then after its 76, 79, 80, 81, 96, 102, and 117.
const seedExplorer = Effect.fn("test.seedExplorer")(function* (base: number, count: number) {
  yield* runMigrations({ toMigrationInclusive: base - 1 });
  yield* Migrator.make({})({
    loader: Migrator.fromRecord(
      Object.fromEntries(
        explorerMigrations
          .slice(0, count)
          .map(([name, migration], index) => [`${base + index}_${name}`, migration]),
      ),
    ),
  });
});

const decodeQaRun = Schema.decodeEffect(Schema.fromJsonString(QaRun));

const v2Migrations = migrationManifest.filter(([id]) => id >= 55);
const newerMigrationId = Math.max(...migrationManifest.map(([id]) => id)) + 1;

const history = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{ readonly migration_id: number; readonly name: string }>`
    SELECT migration_id, name FROM effect_sql_migrations ORDER BY migration_id
  `;
  return rows.map((row) => [row.migration_id, row.name] as const);
});

const v2TableCount = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql`
    SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'orchestration_v2_%'
  `;
  return rows.length;
});

describe("runMigrations", () => {
  it.effect.each(
    [73, 77, 80, 81, 82, 97, 103, 118].flatMap((base) =>
      [1, 2, 3, 4, 5, 6].map((count) => [base, count] as const),
    ),
  )("preserves Explorer data when upgrading %s-based migrations through %s", ([base, count]) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* seedExplorer(base, count);
      yield* sql`INSERT INTO insights_reports VALUES ('report', 'thread', 'completed', '2026-10-30', 42, '{"recommendations":["keep"]}')`;
      yield* sql`UPDATE effect_sql_migrations SET created_at = '2026-10-30 00:00:00' WHERE migration_id >= ${base}`;
      if (count >= 2)
        yield* sql`INSERT INTO qa_runs (id, project_id, suite_id, started_at, status, run_json, output) VALUES ('run', 'project', 'suite', '2026-10-30', 'passed', '{}', 'saved output')`;
      if (count >= 3) yield* sql`INSERT INTO qa_run_inputs VALUES ('run', '{"hash":"saved"}')`;
      if (count >= 4) yield* sql`INSERT INTO qa_schedules VALUES ('project', '{"enabled":true}')`;
      const tables = [
        "insights_reports",
        ...(count >= 2 ? ["qa_runs"] : []),
        ...(count >= 3 ? ["qa_run_inputs"] : []),
        ...(count >= 4 ? ["qa_schedules"] : []),
      ];
      // Later Explorer migrations add columns, so compare the columns that were saved.
      const saved = Effect.forEach(tables, (table) =>
        table === "qa_runs"
          ? sql`SELECT id, project_id, suite_id, started_at, status, run_json, output FROM qa_runs`
          : sql`SELECT * FROM ${sql(table)}`,
      );
      const before = yield* saved;
      yield* runMigrations();
      assert.deepStrictEqual(yield* history, migrationManifest);
      assert.deepStrictEqual(yield* saved, before);
      assert.deepStrictEqual(
        yield* sql`SELECT created_at FROM effect_sql_migrations WHERE migration_id = 120`,
        [{ created_at: "2026-10-30 00:00:00" }],
      );
      const columns = yield* sql<{ name: string }>`PRAGMA table_info(projection_projects)`;
      assert.ok(columns.some((column) => column.name === "pinned_at"));
      assert.deepStrictEqual(yield* runMigrations(), []);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );

  it.effect.each([
    [73, "ProjectionProjectsPinArchive"],
    [77, "DelegatedRecoveryIndexes"],
    [80, "ScheduledTaskThreadMode"],
    [81, "ProjectionMessageSearchText"],
    [82, "RepairStaleTitleRegeneration"],
    [97, "ThreadItemCounts"],
    [103, "WorkflowMailSender"],
    [118, "WorkflowPools"],
  ] as const)("rolls back a %s-based Explorer upgrade if %s fails", ([base, failing]) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* seedExplorer(base, 6);
      const before = yield* history;
      yield* sql.unsafe(
        `CREATE TRIGGER fail_explorer_upgrade BEFORE INSERT ON effect_sql_migrations WHEN NEW.name = '${failing}' BEGIN SELECT RAISE(FAIL, 'injected failure'); END`,
      );
      assert.isTrue(Exit.isFailure(yield* Effect.exit(runMigrations())));
      assert.deepStrictEqual(yield* history, before);
      yield* sql`DROP TRIGGER fail_explorer_upgrade`;
      yield* runMigrations();
      assert.deepStrictEqual(yield* history, migrationManifest);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );

  it.effect.each(
    [73, 77, 80, 81, 82, 97, 103, 118].flatMap((base) => [
      [base, "gap"] as const,
      [base, "unknown"] as const,
    ]),
  )("refuses a %s-based Explorer history with a %s", ([base, problem]) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* seedExplorer(base, 6);
      if (problem === "gap") {
        yield* sql`DELETE FROM effect_sql_migrations WHERE migration_id = ${base + 1}`;
      } else {
        yield* sql`INSERT INTO effect_sql_migrations (migration_id, name) VALUES (${base + 6}, 'UnknownMigration')`;
      }
      const before = yield* history;
      const exit = yield* Effect.exit(runMigrations());
      assert.isTrue(Exit.isFailure(exit));
      assert.include(String(exit), "Cannot upgrade Explorer with unexpected later migrations");
      assert.deepStrictEqual(yield* history, before);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );

  it.effect("refuses to start when another migration took a V2 id", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 54 });
      yield* sql`
        INSERT INTO effect_sql_migrations (migration_id, name) VALUES (55, 'FutureMainMigration')
      `;
      const before = yield* history;

      assert.deepStrictEqual(yield* runMigrations({ toMigrationInclusive: 54 }), []);
      const exit = yield* Effect.exit(runMigrations());

      assert.isTrue(Exit.isFailure(exit));
      assert.include(String(exit), "55_OrchestrationV2 (recorded: FutureMainMigration)");
      assert.deepStrictEqual(yield* history, before);
      assert.strictEqual(yield* v2TableCount, 0);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );

  it.effect("refuses to start when a later id would skip V2 migrations", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 54 });
      yield* sql`
        INSERT INTO effect_sql_migrations (migration_id, name)
        VALUES (${newerMigrationId}, 'FutureMainMigration')
      `;
      const before = yield* history;

      const exit = yield* Effect.exit(runMigrations());

      assert.isTrue(Exit.isFailure(exit));
      for (const [id, name] of v2Migrations) {
        assert.include(String(exit), `${id}_${name} (recorded: nothing)`);
      }
      assert.deepStrictEqual(yield* history, before);
      assert.strictEqual(yield* v2TableCount, 0);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );

  it.effect.each([54, 76, 79, 80])(
    "upgrades a database at exactly %s, then rechecks it without a write lock",
    (id) =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* runMigrations({ toMigrationInclusive: id });
        const expected = migrationManifest.filter(([next]) => next > id);
        const current = yield* Ref.make<Progress | null>(null);
        const steps: Array<Progress | null> = [];
        const loggedSteps: Array<Progress | null> = [];
        let output = "";
        const pretty = Logger.consolePretty({ mode: "tty", colors: false });
        const logger = Logger.make((options) => {
          pretty.log(options);
          if (String(options.message).startsWith(DATABASE_MIGRATION_PROGRESS_MESSAGE)) {
            steps.push(Ref.getUnsafe(current));
            loggedSteps.push(databaseMigrationProgress(output.slice(-4_000)));
          }
        });
        assert.deepStrictEqual(
          yield* runMigrations().pipe(
            Effect.provideService(DatabaseMigrationProgress.DatabaseMigrationProgress, { current }),
            Effect.provide(Logger.layer([logger], { mergeWithExisting: false })),
            Effect.provideService(Console.Console, {
              ...globalThis.console,
              log: (...args) => {
                output += `${NodeUtil.format(...args)}\n`;
              },
            }),
          ),
          expected,
        );
        assert.deepStrictEqual(
          steps,
          expected.map((_, index) => ({ current: index + 1, total: expected.length })),
        );
        assert.deepStrictEqual(loggedSteps, steps);
        assert.isNull(yield* Ref.get(current));
        assert.deepStrictEqual(
          yield* runMigrations().pipe(
            Effect.provideService(DatabaseMigrationProgress.DatabaseMigrationProgress, { current }),
          ),
          [],
        );
        assert.isNull(yield* Ref.get(current));
        assert.deepStrictEqual(yield* history, migrationManifest);
        assert.isAbove(yield* v2TableCount, 0);

        // query_only rejects BEGIN IMMEDIATE, which CLI startup would otherwise take on the live database.
        yield* sql`PRAGMA query_only = ON`;
        assert.deepStrictEqual(yield* runMigrations(), []);
        assert.deepStrictEqual(yield* history, migrationManifest);
      }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );

  it.effect("drops the unused correlation index and keeps correlation values", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 54 });
      yield* sql`
        INSERT INTO orchestration_events (
          event_id, aggregate_kind, stream_id, stream_version, event_type, occurred_at,
          command_id, causation_event_id, correlation_id, actor_kind, payload_json, metadata_json
        )
        VALUES (
          'event-1', 'thread', 'thread-1', 0, 'thread.created', '2026-01-01T00:00:00.000Z',
          'command-1', NULL, 'correlation-1', 'client', '{}', '{}'
        )
      `;

      yield* runMigrations();

      const indexes = yield* sql<{ readonly name: string }>`
        SELECT name FROM sqlite_master
        WHERE type = 'index' AND tbl_name = 'orchestration_events' AND sql IS NOT NULL
      `;
      const indexNames = indexes.map((row) => row.name);
      assert.notInclude(indexNames, "idx_orch_events_correlation_id");
      for (const kept of [
        "idx_orch_events_stream_version",
        "idx_orch_events_stream_sequence",
        "idx_orch_events_command_id",
        "idx_orchestration_events_agent_stream_sequence",
      ]) {
        assert.include(indexNames, kept);
      }
      const events = yield* sql<{ readonly correlation_id: string | null }>`
        SELECT correlation_id FROM orchestration_events WHERE event_id = 'event-1'
      `;
      assert.deepStrictEqual(events, [{ correlation_id: "correlation-1" }]);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );

  it.effect.each([30, 54])("still starts with a site-local migration at id %s", (id) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 54 });
      yield* sql`
        UPDATE effect_sql_migrations SET name = 'SiteLocalMigration' WHERE migration_id = ${id}
      `;

      assert.deepStrictEqual(yield* runMigrations(), v2Migrations);
      assert.isAbove(yield* v2TableCount, 0);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );

  it.effect("only checks V2 migrations within the requested limit", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 55 });
      yield* sql`
        INSERT INTO effect_sql_migrations (migration_id, name)
        VALUES (56, 'SiteLocalMigration'), (${newerMigrationId}, 'NewerV2Migration')
      `;
      const before = yield* history;

      assert.deepStrictEqual(yield* runMigrations({ toMigrationInclusive: 55 }), []);
      const exit = yield* Effect.exit(runMigrations({ toMigrationInclusive: 56 }));
      assert.isTrue(Exit.isFailure(exit));
      assert.include(
        String(exit),
        "56_RemoveRedundantProjectionIndexes (recorded: SiteLocalMigration)",
      );
      assert.notInclude(String(exit), "57_ScheduledTaskWebhooks");
      assert.deepStrictEqual(yield* history, before);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );

  it.effect("keeps QA runs saved before suites ran per device readable", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 124 });
      const suite = {
        id: "maestro",
        name: "Maestro",
        command: "maestro test",
        devices: [{ id: "ios", platform: "ios" }],
      };
      const run = {
        projectId: "project",
        cwd: "/repo",
        startedAt: "2026-11-17T11:51:07.800Z",
        finishedAt: "2026-11-17T11:58:30.286Z",
        status: "failed",
        exitCode: 1,
        commit: null,
        branch: "master",
        dirty: false,
        summary: null,
        note: null,
      };
      // Before runs were per device, a suite ran per platform and each run named its platform.
      const legacy = {
        ...run,
        id: "legacy",
        suite: { ...suite, runPer: "platform" },
        platform: "ios",
      };
      const current = { ...run, id: "current", suite: { ...suite, runPer: "device" }, lane: "ios" };
      for (const saved of [legacy, current])
        yield* sql`INSERT INTO qa_runs (id, project_id, suite_id, started_at, status, run_json) VALUES (${saved.id}, 'project', 'maestro', ${saved.startedAt}, 'failed', ${JSON.stringify(saved)})`;

      yield* runMigrations();

      const rows = yield* sql<{ readonly run_json: string }>`
        SELECT run_json FROM qa_runs ORDER BY id
      `;
      const [savedCurrent, savedLegacy] = yield* Effect.forEach(rows, (row) =>
        decodeQaRun(row.run_json),
      );
      assert.strictEqual(savedLegacy?.suite.runPer, undefined);
      assert.notProperty(JSON.parse(rows[1]!.run_json), "platform");
      assert.strictEqual(savedCurrent?.suite.runPer, "device");
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );

  it.effect("keeps the migrations that finished before a later one failed", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 81 });
      yield* sql`CREATE TABLE orchestration_v2_projection_turn_item_counts (thread_id TEXT)`;

      const current = yield* Ref.make<Progress | null>(null);
      const exit = yield* Effect.exit(
        runMigrations().pipe(
          Effect.provideService(DatabaseMigrationProgress.DatabaseMigrationProgress, { current }),
        ),
      );

      assert.isTrue(Exit.isFailure(exit));
      assert.isNull(yield* Ref.get(current));
      assert.deepStrictEqual(
        yield* history,
        migrationManifest.filter(([id]) => id <= 84),
      );
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );

  it.effect("reapplies peer link migrations whose ledger rows are missing", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 72 });
      yield* sql`DELETE FROM effect_sql_migrations WHERE migration_id BETWEEN 70 AND 72`;

      assert.deepStrictEqual(
        yield* runMigrations(),
        migrationManifest.filter(([id]) => id >= 70),
      );
      assert.deepStrictEqual(yield* history, migrationManifest);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );

  it.effect("still starts after a newer build recorded a later V2 migration", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations();
      yield* sql`
        INSERT INTO effect_sql_migrations (migration_id, name)
        VALUES (${newerMigrationId}, 'NewerV2Migration')
      `;

      assert.deepStrictEqual(yield* runMigrations(), []);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );
});

// The npm launcher reads the highest migration id from these file names.
it.effect("registers every migration file", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const dir = path.join(import.meta.dirname, "Migrations");
    const files = (yield* fs.readDirectory(dir)).flatMap((name) => {
      const match = /^(\d+)_(\w+)\.ts$/.exec(name);
      return match ? [[Number(match[1]), match[2]] as const] : [];
    });
    assert.deepStrictEqual(
      files.toSorted(([a], [b]) => a - b),
      migrationManifest,
    );
  }).pipe(Effect.provide(NodeServices.layer)),
);
