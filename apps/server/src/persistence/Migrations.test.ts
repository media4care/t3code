import { assert, describe, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as SqlClient from "effect/sql/SqlClient";
import * as Migrator from "effect/sql/Migrator";

import { migrationManifest, runMigrations } from "./Migrations.ts";
import Insights from "./Migrations/077_Insights.ts";
import QaRuns from "./Migrations/078_QaRuns.ts";
import QaInputs from "./Migrations/079_QaInputs.ts";
import QaAutomation from "./Migrations/080_QaAutomation.ts";

const seedExplorer = Effect.fn("test.seedExplorer")(function* (throughId: number) {
  yield* runMigrations({ toMigrationInclusive: 72 });
  yield* Migrator.make({})({
    loader: Migrator.fromRecord(
      Object.fromEntries(
        (
          [
            ["73_Insights", Insights],
            ["74_QaRuns", QaRuns],
            ["75_QaInputs", QaInputs],
            ["76_QaAutomation", QaAutomation],
          ] as const
        ).filter(([name]) => Number(String(name).slice(0, 2)) <= throughId),
      ),
    ),
  });
});

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
  it.effect.each([73, 74, 75, 76])(
    "preserves Explorer data when upgrading legacy migration %s",
    (lastId) =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* seedExplorer(lastId);
        yield* sql`INSERT INTO insights_reports VALUES ('report', 'thread', 'completed', '2026-10-30', 42, '{"recommendations":["keep"]}')`;
        yield* sql`UPDATE effect_sql_migrations SET created_at = '2026-10-30 00:00:00' WHERE migration_id >= 73`;
        if (lastId >= 74)
          yield* sql`INSERT INTO qa_runs (id, project_id, suite_id, started_at, status, run_json, output) VALUES ('run', 'project', 'suite', '2026-10-30', 'passed', '{}', 'saved output')`;
        if (lastId >= 75) yield* sql`INSERT INTO qa_run_inputs VALUES ('run', '{"hash":"saved"}')`;
        if (lastId >= 76)
          yield* sql`INSERT INTO qa_schedules VALUES ('project', '{"enabled":true}')`;
        const tables = [
          "insights_reports",
          ...(lastId >= 74 ? ["qa_runs"] : []),
          ...(lastId >= 75 ? ["qa_run_inputs"] : []),
          ...(lastId >= 76 ? ["qa_schedules"] : []),
        ];
        const before = yield* Effect.forEach(tables, (table) => sql`SELECT * FROM ${sql(table)}`);
        yield* runMigrations();
        assert.deepStrictEqual(yield* history, migrationManifest);
        assert.deepStrictEqual(
          yield* Effect.forEach(tables, (table) => sql`SELECT * FROM ${sql(table)}`),
          before,
        );
        assert.deepStrictEqual(
          yield* sql`SELECT created_at FROM effect_sql_migrations WHERE migration_id = 77`,
          [{ created_at: "2026-10-30 00:00:00" }],
        );
        const columns = yield* sql<{ name: string }>`PRAGMA table_info(projection_projects)`;
        assert.ok(columns.some((column) => column.name === "pinned_at"));
        assert.deepStrictEqual(yield* runMigrations(), []);
      }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );

  it.effect("rolls back an Explorer upgrade if an upstream migration fails", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* seedExplorer(76);
      const before = yield* history;
      yield* sql`CREATE TRIGGER fail_explorer_upgrade BEFORE INSERT ON effect_sql_migrations WHEN NEW.name = 'ProjectionProjectsPinArchive' BEGIN SELECT RAISE(FAIL, 'injected failure'); END`;
      assert.isTrue(Exit.isFailure(yield* Effect.exit(runMigrations())));
      assert.deepStrictEqual(yield* history, before);
      const columns = yield* sql<{ name: string }>`PRAGMA table_info(projection_projects)`;
      assert.isFalse(columns.some((column) => column.name === "pinned_at"));
      yield* sql`DROP TRIGGER fail_explorer_upgrade`;
      yield* runMigrations();
      assert.deepStrictEqual(yield* history, migrationManifest);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );

  it.effect.each(["gap", "unknown"])("refuses an Explorer history with a %s", (problem) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* seedExplorer(76);
      if (problem === "gap") {
        yield* sql`DELETE FROM effect_sql_migrations WHERE migration_id = 74`;
      } else {
        yield* sql`INSERT INTO effect_sql_migrations (migration_id, name) VALUES (77, 'UnknownMigration')`;
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

  it.effect.each([54, 76])("upgrades a database at exactly %s", (id) =>
    Effect.gen(function* () {
      yield* runMigrations({ toMigrationInclusive: id });
      assert.deepStrictEqual(
        yield* runMigrations(),
        migrationManifest.filter(([next]) => next > id),
      );
      assert.deepStrictEqual(yield* history, migrationManifest);
      assert.isAbove(yield* v2TableCount, 0);
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
