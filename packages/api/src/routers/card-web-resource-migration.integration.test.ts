import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const statementBreakpoint = "--> statement-breakpoint";

describe("card web resource migration", () => {
  it("replaces the enum transactionally without losing upload or Drive rows", async () => {
    const client = new PGlite();
    await client.exec(`
      create type card_resource_kind as enum ('upload', 'drive');
      create table card_resource (
        id bigserial primary key,
        "cardId" bigint not null,
        kind card_resource_kind not null,
        "attachmentId" bigint,
        "driveType" varchar(32),
        "driveFileId" varchar(255),
        "resourceKey" varchar(255),
        "deletedAt" timestamp with time zone,
        constraint card_resource_kind_payload_check check (
          (kind = 'upload' and "attachmentId" is not null and "driveType" is null and "driveFileId" is null and "resourceKey" is null)
          or
          (kind = 'drive' and "attachmentId" is null and "driveType" is not null and "driveFileId" is not null)
        )
      );
      create unique index card_resource_drive_active_unique
        on card_resource ("cardId", "driveType", "driveFileId")
        where kind = 'drive' and "deletedAt" is null;
      insert into card_resource ("cardId", kind, "attachmentId")
        values (1, 'upload', 11);
      insert into card_resource ("cardId", kind, "driveType", "driveFileId")
        values (1, 'drive', 'document', 'DriveFileId12345');
    `);
    const migration = await readFile(
      resolve(
        process.cwd(),
        "../db/migrations/20260824125557_CardWebResources.sql",
      ),
      "utf8",
    );
    const statements = migration
      .split(statementBreakpoint)
      .map((statement) => statement.trim())
      .filter(Boolean);

    await client.transaction(async (transaction) => {
      for (const statement of statements) await transaction.exec(statement);
    });

    const rows = await client.query<{ kind: string; count: number }>(
      `select kind::text as kind, count(*)::int as count
       from card_resource
       group by kind
       order by kind`,
    );
    expect(rows.rows).toEqual([
      { kind: "drive", count: 1 },
      { kind: "upload", count: 1 },
    ]);
    const enumValues = await client.query<{ value: string }>(
      `select unnest(enum_range(null::card_resource_kind))::text as value`,
    );
    expect(enumValues.rows.map((row) => row.value)).toEqual([
      "upload",
      "drive",
      "web",
    ]);
    await client.exec(`
      insert into card_resource (
        "cardId",
        kind,
        "webUrl",
        "webUrlHash",
        "webDescription",
        "webSiteName",
        "webImageUrl"
      ) values (
        1,
        'web',
        'https://example.com/research',
        '${"a".repeat(64)}',
        'Research notes',
        'Example',
        'https://cdn.example.com/preview.png'
      )
    `);
    await expect(
      client.exec(`
        insert into card_resource ("cardId", kind, "webUrl", "webUrlHash")
        values (1, 'web', 'https://example.com/duplicate', '${"a".repeat(64)}')
      `),
    ).rejects.toThrow();
  });
});
