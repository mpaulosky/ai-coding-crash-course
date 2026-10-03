import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";

let testDb: ReturnType<typeof createTestDb>;
let base: ReturnType<typeof seedBaseData>;

vi.mock("~/db", () => ({
  get db() {
    return testDb;
  },
}));

// Import after mock so the module picks up our test db
import { getInstructorOverview } from "./analyticsService";

let studentCount = 0;

function createStudent() {
  studentCount++;
  return testDb
    .insert(schema.users)
    .values({
      name: `Student ${studentCount}`,
      email: `student${studentCount}@example.com`,
      role: schema.UserRole.Student,
    })
    .returning()
    .get();
}

function createCourse(
  status: schema.CourseStatus,
  instructorId = base.instructor.id
) {
  const slug = `course-${Math.random().toString(36).slice(2)}`;
  return testDb
    .insert(schema.courses)
    .values({
      title: slug,
      slug,
      description: "A course",
      salesCopy: "Sales copy.",
      instructorId,
      categoryId: base.category.id,
      status,
    })
    .returning()
    .get();
}

function purchase(courseId: number, amountPaid: number) {
  testDb
    .insert(schema.purchases)
    .values({
      userId: createStudent().id,
      courseId,
      amountPaid,
    })
    .run();
}

function enroll(courseId: number, completed = false) {
  testDb
    .insert(schema.enrollments)
    .values({
      userId: createStudent().id,
      courseId,
      completedAt: completed ? new Date().toISOString() : null,
    })
    .run();
}

describe("analyticsService", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
  });

  describe("getInstructorOverview", () => {
    it("sums amountPaid across the instructor's purchases", () => {
      // A full-price purchase and a PPP-discounted one
      purchase(base.course.id, 4999);
      purchase(base.course.id, 2500);

      const overview = getInstructorOverview(base.instructor.id);

      expect(overview.grossRevenue).toBe(7499);
    });

    it("counts a team purchase in full, regardless of seats redeemed", () => {
      const buyer = createStudent();
      const team = testDb.insert(schema.teams).values({}).returning().get();
      const teamPurchase = testDb
        .insert(schema.purchases)
        .values({ userId: buyer.id, courseId: base.course.id, amountPaid: 25000 })
        .returning()
        .get();
      testDb
        .insert(schema.coupons)
        .values([
          {
            teamId: team.id,
            courseId: base.course.id,
            code: "SEAT-1",
            purchaseId: teamPurchase.id,
            redeemedByUserId: base.user.id,
            redeemedAt: new Date().toISOString(),
          },
          {
            teamId: team.id,
            courseId: base.course.id,
            code: "SEAT-2",
            purchaseId: teamPurchase.id,
          },
        ])
        .run();

      const overview = getInstructorOverview(base.instructor.id);

      expect(overview.grossRevenue).toBe(25000);
    });

    it("excludes draft courses and includes archived courses", () => {
      const draft = createCourse(schema.CourseStatus.Draft);
      const archived = createCourse(schema.CourseStatus.Archived);
      purchase(draft.id, 1000);
      purchase(archived.id, 300);
      purchase(base.course.id, 200);

      const overview = getInstructorOverview(base.instructor.id);

      expect(overview.grossRevenue).toBe(500);
    });

    it("ignores other instructors' courses", () => {
      const other = testDb
        .insert(schema.users)
        .values({
          name: "Other Instructor",
          email: "other@example.com",
          role: schema.UserRole.Instructor,
        })
        .returning()
        .get();
      const otherCourse = createCourse(schema.CourseStatus.Published, other.id);
      purchase(otherCourse.id, 9999);
      enroll(otherCourse.id, true);
      enroll(otherCourse.id, true);
      purchase(base.course.id, 100);
      enroll(base.course.id);

      const overview = getInstructorOverview(base.instructor.id);

      expect(overview.grossRevenue).toBe(100);
      expect(overview.totalStudents).toBe(1);
      expect(overview.completionRate).toBe(0);
    });

    it("counts enrollments in included courses as total students", () => {
      const draft = createCourse(schema.CourseStatus.Draft);
      const archived = createCourse(schema.CourseStatus.Archived);
      enroll(base.course.id);
      enroll(base.course.id);
      enroll(archived.id);
      enroll(draft.id);

      const overview = getInstructorOverview(base.instructor.id);

      expect(overview.totalStudents).toBe(3);
    });

    it("computes completion rate as completed over total enrollments", () => {
      enroll(base.course.id, true);
      enroll(base.course.id);
      enroll(base.course.id);
      enroll(base.course.id);
      // A completed enrollment in a draft doesn't count
      enroll(createCourse(schema.CourseStatus.Draft).id, true);

      const overview = getInstructorOverview(base.instructor.id);

      expect(overview.completionRate).toBe(0.25);
    });

    it("reports no completion rate when there are no enrollments", () => {
      const overview = getInstructorOverview(base.instructor.id);

      expect(overview.completionRate).toBeNull();
    });

    it("counts only published and archived courses as included", () => {
      createCourse(schema.CourseStatus.Draft);
      createCourse(schema.CourseStatus.Archived);

      const overview = getInstructorOverview(base.instructor.id);

      expect(overview.includedCourseCount).toBe(2);
    });

    it("reports no included courses for an instructor with only drafts", () => {
      const newcomer = testDb
        .insert(schema.users)
        .values({
          name: "New Instructor",
          email: "new@example.com",
          role: schema.UserRole.Instructor,
        })
        .returning()
        .get();
      createCourse(schema.CourseStatus.Draft, newcomer.id);

      const overview = getInstructorOverview(newcomer.id);

      expect(overview).toEqual({
        includedCourseCount: 0,
        grossRevenue: 0,
        totalStudents: 0,
        completionRate: null,
      });
    });
  });
});
