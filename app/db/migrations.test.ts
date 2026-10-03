import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

// createTestDb migrates an empty database, so it can't catch a migration that
// only fails on existing rows. These tests migrate up to a point, insert data,
// then apply the rest — the path `npm run db:migrate` takes on a live data.db.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.resolve(__dirname, "../../drizzle");

type Journal = { entries: { idx: number }[] };

/** A copy of drizzle/ whose journal stops before migration `idx`. */
function migrationsBefore(idx: number) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "migrations-"));
  fs.cpSync(migrationsFolder, dir, { recursive: true });
  const journalPath = path.join(dir, "meta/_journal.json");
  const journal: Journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
  journal.entries = journal.entries.filter((entry) => entry.idx < idx);
  fs.writeFileSync(journalPath, JSON.stringify(journal));
  return dir;
}

describe("migrations on existing data", () => {
  describe("0008 (comments cascade on lesson delete)", () => {
    let sqlite: Database.Database;

    beforeEach(() => {
      sqlite = new Database(":memory:");
      sqlite.pragma("foreign_keys = ON");
      migrate(drizzle(sqlite), { migrationsFolder: migrationsBefore(8) });

      sqlite.exec(`
        INSERT INTO users (id, name, email, role, created_at)
          VALUES (1, 'Student', 'student@example.com', 'student', '');
        INSERT INTO categories (id, name, slug) VALUES (1, 'Cat', 'cat');
        INSERT INTO courses (id, title, slug, description, sales_copy, instructor_id, category_id, status, created_at, updated_at)
          VALUES (1, 'Course', 'course', 'd', 's', 1, 1, 'published', '', '');
        INSERT INTO modules (id, course_id, title, position, created_at)
          VALUES (1, 1, 'Module', 1, '');
        INSERT INTO lessons (id, module_id, title, position, created_at)
          VALUES (1, 1, 'Lesson', 1, '');
        INSERT INTO comments (id, lesson_id, user_id, parent_id, body, created_at)
          VALUES (1, 1, 1, NULL, 'Question', '');
        INSERT INTO comments (id, lesson_id, user_id, parent_id, body, created_at)
          VALUES (2, 1, 1, 1, 'Answer', '');
      `);

      migrate(drizzle(sqlite), { migrationsFolder });
    });

    it("keeps an existing parent and reply", () => {
      expect(
        sqlite.prepare("SELECT id, parent_id FROM comments ORDER BY id").all()
      ).toEqual([
        { id: 1, parent_id: null },
        { id: 2, parent_id: 1 },
      ]);
      expect(sqlite.pragma("foreign_key_check")).toEqual([]);
    });

    it("points the reply's parent key at the renamed table", () => {
      expect(() =>
        sqlite
          .prepare(
            "INSERT INTO comments (lesson_id, user_id, parent_id, body, created_at) VALUES (1, 1, 999, 'x', '')"
          )
          .run()
      ).toThrow(/FOREIGN KEY/);
    });

    it("cascades a lesson delete to its comments", () => {
      sqlite.prepare("DELETE FROM lessons WHERE id = 1").run();

      expect(sqlite.prepare("SELECT COUNT(*) AS n FROM comments").get()).toEqual(
        { n: 0 }
      );
    });
  });
});
