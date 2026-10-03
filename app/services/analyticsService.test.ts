import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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
import {
  getCourseBreakdown,
  getCourseFunnel,
  getCourseSummary,
  getInstructorOverview,
  getRevenueInRange,
  getRevenueTrend,
} from "./analyticsService";

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

function purchase(courseId: number, amountPaid: number, createdAt?: string) {
  testDb
    .insert(schema.purchases)
    .values({
      userId: createStudent().id,
      courseId,
      amountPaid,
      createdAt,
    })
    .run();
}

function enroll(courseId: number, completed = false, enrolledAt?: string) {
  testDb
    .insert(schema.enrollments)
    .values({
      userId: createStudent().id,
      courseId,
      enrolledAt,
      completedAt: completed ? new Date().toISOString() : null,
    })
    .run();
}

function rate(courseId: number, rating: number) {
  testDb
    .insert(schema.courseRatings)
    .values({ userId: createStudent().id, courseId, rating })
    .run();
}

// "Now" for tests that depend on the clock
const NOW = new Date("2026-06-15T12:00:00.000Z");

function daysAgo(days: number) {
  return new Date(NOW.getTime() - days * 86_400_000).toISOString();
}

function createLesson(courseId: number, modulePosition = 1, position = 1) {
  const mod = testDb
    .insert(schema.modules)
    .values({
      courseId,
      title: `Module ${modulePosition}`,
      position: modulePosition,
    })
    .returning()
    .get();
  return testDb
    .insert(schema.lessons)
    .values({ moduleId: mod.id, title: `Lesson ${position}`, position })
    .returning()
    .get();
}

function completeLesson(userId: number, lessonId: number, completedAt: string) {
  testDb
    .insert(schema.lessonProgress)
    .values({
      userId,
      lessonId,
      status: schema.LessonProgressStatus.Completed,
      completedAt,
    })
    .run();
}

function watch(userId: number, lessonId: number, createdAt: string) {
  testDb
    .insert(schema.videoWatchEvents)
    .values({
      userId,
      lessonId,
      eventType: "play",
      positionSeconds: 0,
      createdAt,
    })
    .run();
}

describe("analyticsService", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
  });

  afterEach(() => {
    vi.useRealTimers();
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
        .values({
          userId: buyer.id,
          courseId: base.course.id,
          amountPaid: 25000,
        })
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
        activeStudents: 0,
        unansweredQuestions: 0,
      });
    });
  });

  describe("getCourseBreakdown", () => {
    it("reports revenue, enrollments, completion and rating for a course", () => {
      purchase(base.course.id, 4999);
      purchase(base.course.id, 2500);
      enroll(base.course.id, true);
      enroll(base.course.id);
      enroll(base.course.id);
      enroll(base.course.id);
      rate(base.course.id, 5);
      rate(base.course.id, 4);

      const [row] = getCourseBreakdown(base.instructor.id);

      expect(row).toEqual({
        id: base.course.id,
        title: base.course.title,
        status: schema.CourseStatus.Published,
        revenue: 7499,
        enrollments: 4,
        completionRate: 0.25,
        averageRating: 4.5,
        ratingCount: 2,
        activeStudents: 0,
      });
    });

    it("sorts courses by revenue, highest first", () => {
      const small = createCourse(schema.CourseStatus.Published);
      const big = createCourse(schema.CourseStatus.Archived);
      purchase(small.id, 100);
      purchase(big.id, 9000);
      purchase(base.course.id, 500);

      const rows = getCourseBreakdown(base.instructor.id);

      expect(rows.map((row) => row.id)).toEqual([
        big.id,
        base.course.id,
        small.id,
      ]);
    });

    it("reports no rating and no completion rate for an untouched course", () => {
      const [row] = getCourseBreakdown(base.instructor.id);

      expect(row).toMatchObject({
        revenue: 0,
        enrollments: 0,
        completionRate: null,
        averageRating: null,
        ratingCount: 0,
      });
    });

    it("lists only the instructor's published and archived courses", () => {
      const draft = createCourse(schema.CourseStatus.Draft);
      const archived = createCourse(schema.CourseStatus.Archived);
      const other = testDb
        .insert(schema.users)
        .values({
          name: "Other Instructor",
          email: "other@example.com",
          role: schema.UserRole.Instructor,
        })
        .returning()
        .get();
      const othersCourse = createCourse(
        schema.CourseStatus.Published,
        other.id
      );
      purchase(draft.id, 1000);
      purchase(othersCourse.id, 1000);
      rate(othersCourse.id, 1);

      const rows = getCourseBreakdown(base.instructor.id);

      expect(rows.map((row) => row.id).sort()).toEqual(
        [base.course.id, archived.id].sort()
      );
    });
  });

  describe("active students", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(NOW);
    });

    it("counts a student who completed a lesson in the last 30 days", () => {
      const lesson = createLesson(base.course.id);
      completeLesson(createStudent().id, lesson.id, daysAgo(29));

      expect(getInstructorOverview(base.instructor.id).activeStudents).toBe(1);
    });

    it("counts a student who only watched a video in the last 30 days", () => {
      const lesson = createLesson(base.course.id);
      watch(createStudent().id, lesson.id, daysAgo(2));

      expect(getInstructorOverview(base.instructor.id).activeStudents).toBe(1);
    });

    it("ignores activity older than 30 days", () => {
      const lesson = createLesson(base.course.id);
      completeLesson(createStudent().id, lesson.id, daysAgo(31));
      watch(createStudent().id, lesson.id, daysAgo(30.01));

      expect(getInstructorOverview(base.instructor.id).activeStudents).toBe(0);
    });

    it("counts a student once across activity types and courses", () => {
      const archived = createCourse(schema.CourseStatus.Archived);
      const lesson = createLesson(base.course.id);
      const archivedLesson = createLesson(archived.id);
      const student = createStudent();
      completeLesson(student.id, lesson.id, daysAgo(1));
      watch(student.id, lesson.id, daysAgo(1));
      watch(student.id, archivedLesson.id, daysAgo(3));

      expect(getInstructorOverview(base.instructor.id).activeStudents).toBe(1);
    });

    it("ignores activity in drafts and other instructors' courses", () => {
      const other = testDb
        .insert(schema.users)
        .values({
          name: "Other Instructor",
          email: "other@example.com",
          role: schema.UserRole.Instructor,
        })
        .returning()
        .get();
      const draftLesson = createLesson(
        createCourse(schema.CourseStatus.Draft).id
      );
      const othersLesson = createLesson(
        createCourse(schema.CourseStatus.Published, other.id).id
      );
      completeLesson(createStudent().id, draftLesson.id, daysAgo(1));
      watch(createStudent().id, othersLesson.id, daysAgo(1));

      expect(getInstructorOverview(base.instructor.id).activeStudents).toBe(0);
    });

    it("ignores lessons that are only in progress", () => {
      const lesson = createLesson(base.course.id);
      testDb
        .insert(schema.lessonProgress)
        .values({
          userId: createStudent().id,
          lessonId: lesson.id,
          status: schema.LessonProgressStatus.InProgress,
          completedAt: daysAgo(1),
        })
        .run();

      expect(getInstructorOverview(base.instructor.id).activeStudents).toBe(0);
    });

    it("counts active students per course in the breakdown", () => {
      const archived = createCourse(schema.CourseStatus.Archived);
      const lesson = createLesson(base.course.id);
      const archivedLesson = createLesson(archived.id);
      const both = createStudent();
      completeLesson(both.id, lesson.id, daysAgo(1));
      watch(both.id, archivedLesson.id, daysAgo(1));
      watch(createStudent().id, lesson.id, daysAgo(5));
      watch(createStudent().id, archivedLesson.id, daysAgo(40));

      const rows = getCourseBreakdown(base.instructor.id);
      const activeById = Object.fromEntries(
        rows.map((row) => [row.id, row.activeStudents])
      );

      expect(activeById).toEqual({ [base.course.id]: 2, [archived.id]: 1 });
    });
  });

  describe("unanswered questions", () => {
    function ask(
      userId: number,
      lessonId: number,
      parentId: number | null = null
    ) {
      return testDb
        .insert(schema.comments)
        .values({ userId, lessonId, parentId, body: "How does this work?" })
        .returning()
        .get();
    }

    it("counts student questions without a reply from the instructor", () => {
      const lesson = createLesson(base.course.id);
      ask(base.user.id, lesson.id);
      ask(createStudent().id, lesson.id);
      const answered = ask(createStudent().id, lesson.id);
      ask(base.instructor.id, lesson.id, answered.id);
      // A reply from another student doesn't answer the question
      const peerReplied = ask(createStudent().id, lesson.id);
      ask(base.user.id, lesson.id, peerReplied.id);

      expect(
        getInstructorOverview(base.instructor.id).unansweredQuestions
      ).toBe(3);
    });

    it("ignores questions on other instructors' courses", () => {
      const other = testDb
        .insert(schema.users)
        .values({
          name: "Other Instructor",
          email: "other@example.com",
          role: schema.UserRole.Instructor,
        })
        .returning()
        .get();
      const othersLesson = createLesson(
        createCourse(schema.CourseStatus.Published, other.id).id
      );
      ask(base.user.id, othersLesson.id);

      expect(
        getInstructorOverview(base.instructor.id).unansweredQuestions
      ).toBe(0);
    });
  });

  describe("getRevenueInRange", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(NOW);
    });

    it("covers today and the six days before it for the last 7 days", () => {
      purchase(base.course.id, 100, "2026-06-09T00:00:00.000Z");
      purchase(base.course.id, 200, "2026-06-15T11:00:00.000Z");
      purchase(base.course.id, 400, "2026-06-08T23:59:59.999Z");

      expect(getRevenueInRange(base.instructor.id, "7d")).toBe(300);
    });

    it("covers today and the 29 days before it for the last 30 days", () => {
      purchase(base.course.id, 100, "2026-05-17T00:00:00.000Z");
      purchase(base.course.id, 400, "2026-05-16T23:59:59.999Z");

      expect(getRevenueInRange(base.instructor.id, "30d")).toBe(100);
    });

    it("covers today and the 89 days before it for the last 90 days", () => {
      purchase(base.course.id, 100, "2026-03-18T00:00:00.000Z");
      purchase(base.course.id, 400, "2026-03-17T23:59:59.999Z");

      expect(getRevenueInRange(base.instructor.id, "90d")).toBe(100);
    });

    it("covers every purchase for all time, in included courses only", () => {
      purchase(base.course.id, 100, "2020-01-01T00:00:00.000Z");
      purchase(base.course.id, 200, daysAgo(1));
      purchase(createCourse(schema.CourseStatus.Draft).id, 400, daysAgo(1));

      expect(getRevenueInRange(base.instructor.id, "all")).toBe(300);
    });
  });

  describe("getRevenueTrend", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(NOW);
    });

    it("buckets the last 7 days by day, filling empty days with zeroes", () => {
      purchase(base.course.id, 100, "2026-06-09T08:00:00.000Z");
      purchase(base.course.id, 250, "2026-06-12T08:00:00.000Z");
      purchase(base.course.id, 50, "2026-06-12T20:00:00.000Z");
      enroll(base.course.id, false, "2026-06-12T08:00:00.000Z");
      enroll(base.course.id, false, "2026-06-15T09:00:00.000Z");
      // The day before the range starts
      purchase(base.course.id, 999, "2026-06-08T23:00:00.000Z");
      enroll(base.course.id, false, "2026-06-08T23:00:00.000Z");

      expect(getRevenueTrend(base.instructor.id, "7d")).toEqual([
        { bucketStart: "2026-06-09", revenue: 100, enrollments: 0 },
        { bucketStart: "2026-06-10", revenue: 0, enrollments: 0 },
        { bucketStart: "2026-06-11", revenue: 0, enrollments: 0 },
        { bucketStart: "2026-06-12", revenue: 300, enrollments: 1 },
        { bucketStart: "2026-06-13", revenue: 0, enrollments: 0 },
        { bucketStart: "2026-06-14", revenue: 0, enrollments: 0 },
        { bucketStart: "2026-06-15", revenue: 0, enrollments: 1 },
      ]);
    });

    it("buckets the last 30 days by day", () => {
      const trend = getRevenueTrend(base.instructor.id, "30d");

      expect(trend).toHaveLength(30);
      expect(trend[0].bucketStart).toBe("2026-05-17");
      expect(trend[29].bucketStart).toBe("2026-06-15");
    });

    it("buckets the last 90 days by week starting Monday", () => {
      // The range starts Wednesday 18 March, inside the week of Monday 16 March
      purchase(base.course.id, 999, "2026-03-17T12:00:00.000Z");
      purchase(base.course.id, 100, "2026-03-18T00:00:00.000Z");
      purchase(base.course.id, 200, "2026-03-22T23:00:00.000Z");
      purchase(base.course.id, 400, "2026-03-23T01:00:00.000Z");
      enroll(base.course.id, false, "2026-06-15T01:00:00.000Z");

      const trend = getRevenueTrend(base.instructor.id, "90d");

      expect(trend).toHaveLength(14);
      expect(trend.slice(0, 3)).toEqual([
        { bucketStart: "2026-03-16", revenue: 300, enrollments: 0 },
        { bucketStart: "2026-03-23", revenue: 400, enrollments: 0 },
        { bucketStart: "2026-03-30", revenue: 0, enrollments: 0 },
      ]);
      expect(trend[13]).toEqual({
        bucketStart: "2026-06-15",
        revenue: 0,
        enrollments: 1,
      });
    });

    it("buckets all time by month from the first activity", () => {
      enroll(base.course.id, false, "2026-02-27T10:00:00.000Z");
      purchase(base.course.id, 100, "2026-03-31T23:59:00.000Z");
      purchase(base.course.id, 200, "2026-06-01T00:00:00.000Z");
      // Draft activity doesn't extend the range
      purchase(
        createCourse(schema.CourseStatus.Draft).id,
        999,
        "2025-01-01T00:00:00.000Z"
      );

      expect(getRevenueTrend(base.instructor.id, "all")).toEqual([
        { bucketStart: "2026-02-01", revenue: 0, enrollments: 1 },
        { bucketStart: "2026-03-01", revenue: 100, enrollments: 0 },
        { bucketStart: "2026-04-01", revenue: 0, enrollments: 0 },
        { bucketStart: "2026-05-01", revenue: 0, enrollments: 0 },
        { bucketStart: "2026-06-01", revenue: 200, enrollments: 0 },
      ]);
    });

    it("shows the current month alone for all time with no activity", () => {
      expect(getRevenueTrend(base.instructor.id, "all")).toEqual([
        { bucketStart: "2026-06-01", revenue: 0, enrollments: 0 },
      ]);
    });
  });

  describe("getCourseSummary", () => {
    it("matches the course's row in the breakdown", () => {
      const archived = createCourse(schema.CourseStatus.Archived);
      purchase(archived.id, 1500);
      enroll(archived.id, true);
      enroll(archived.id);
      rate(archived.id, 3);
      purchase(base.course.id, 100);

      const summary = getCourseSummary(base.instructor.id, archived.id);

      expect(summary).toEqual({
        id: archived.id,
        title: archived.title,
        status: schema.CourseStatus.Archived,
        revenue: 1500,
        enrollments: 2,
        completionRate: 0.5,
        averageRating: 3,
        ratingCount: 1,
        activeStudents: 0,
      });
    });

    it("has nothing for a draft or another instructor's course", () => {
      const other = testDb
        .insert(schema.users)
        .values({
          name: "Other Instructor",
          email: "other@example.com",
          role: schema.UserRole.Instructor,
        })
        .returning()
        .get();
      const draft = createCourse(schema.CourseStatus.Draft);
      const othersCourse = createCourse(
        schema.CourseStatus.Published,
        other.id
      );

      expect(getCourseSummary(base.instructor.id, draft.id)).toBeUndefined();
      expect(
        getCourseSummary(base.instructor.id, othersCourse.id)
      ).toBeUndefined();
    });
  });

  describe("getCourseFunnel", () => {
    function enrollStudent(courseId: number) {
      const student = createStudent();
      testDb
        .insert(schema.enrollments)
        .values({ userId: student.id, courseId })
        .run();
      return student;
    }

    function addLesson(moduleId: number, title: string, position: number) {
      return testDb
        .insert(schema.lessons)
        .values({ moduleId, title, position })
        .returning()
        .get();
    }

    function addModule(title: string, position: number) {
      return testDb
        .insert(schema.modules)
        .values({ courseId: base.course.id, title, position })
        .returning()
        .get();
    }

    it("lists lessons by module then lesson position with completion percentages", () => {
      // Inserted out of order to show ordering comes from positions
      const second = addModule("Second", 2);
      const first = addModule("First", 1);
      const b2 = addLesson(second.id, "B2", 2);
      const a1 = addLesson(first.id, "A1", 1);
      const b1 = addLesson(second.id, "B1", 1);
      const a2 = addLesson(first.id, "A2", 2);
      const students = [1, 2, 3, 4].map(() => enrollStudent(base.course.id));
      for (const student of students.slice(0, 3)) {
        completeLesson(student.id, a1.id, daysAgo(10));
      }
      for (const student of students.slice(0, 2)) {
        completeLesson(student.id, a2.id, daysAgo(10));
        completeLesson(student.id, b1.id, daysAgo(10));
      }
      completeLesson(students[0].id, b2.id, daysAgo(10));

      const funnel = getCourseFunnel(base.instructor.id, base.course.id)!;

      expect(funnel.enrolled).toBe(4);
      expect(funnel.steps).toEqual([
        {
          moduleId: first.id,
          moduleTitle: "First",
          lessonId: a1.id,
          lessonTitle: "A1",
          completed: 3,
          percent: 75,
          drop: 25,
        },
        {
          moduleId: first.id,
          moduleTitle: "First",
          lessonId: a2.id,
          lessonTitle: "A2",
          completed: 2,
          percent: 50,
          drop: 25,
        },
        {
          moduleId: second.id,
          moduleTitle: "Second",
          lessonId: b1.id,
          lessonTitle: "B1",
          completed: 2,
          percent: 50,
          drop: 0,
        },
        {
          moduleId: second.id,
          moduleTitle: "Second",
          lessonId: b2.id,
          lessonTitle: "B2",
          completed: 1,
          percent: 25,
          drop: 25,
        },
      ]);
    });

    it("counts each enrolled student once, and only completed progress", () => {
      const lesson = addLesson(addModule("Only", 1).id, "L1", 1);
      const twice = enrollStudent(base.course.id);
      const inProgress = enrollStudent(base.course.id);
      completeLesson(twice.id, lesson.id, daysAgo(3));
      completeLesson(twice.id, lesson.id, daysAgo(2));
      testDb
        .insert(schema.lessonProgress)
        .values({
          userId: inProgress.id,
          lessonId: lesson.id,
          status: schema.LessonProgressStatus.InProgress,
        })
        .run();
      // Completed, but not enrolled in the course
      completeLesson(createStudent().id, lesson.id, daysAgo(1));

      const [step] = getCourseFunnel(base.instructor.id, base.course.id)!.steps;

      expect(step).toMatchObject({ completed: 1, percent: 50, drop: 50 });
    });

    it("calls out the lesson with the largest drop", () => {
      const mod = addModule("Only", 1);
      const l1 = addLesson(mod.id, "L1", 1);
      const l2 = addLesson(mod.id, "L2", 2);
      const l3 = addLesson(mod.id, "L3", 3);
      const students = [1, 2, 3, 4, 5].map(() => enrollStudent(base.course.id));
      // 80% → 60% → 20%: drops of 20, 20 and 40 points
      for (const student of students.slice(0, 4))
        completeLesson(student.id, l1.id, daysAgo(1));
      for (const student of students.slice(0, 3))
        completeLesson(student.id, l2.id, daysAgo(1));
      completeLesson(students[0].id, l3.id, daysAgo(1));

      expect(
        getCourseFunnel(base.instructor.id, base.course.id)!.largestDropLessonId
      ).toBe(l3.id);
    });

    it("picks the earliest lesson when drops tie", () => {
      const mod = addModule("Only", 1);
      const l1 = addLesson(mod.id, "L1", 1);
      addLesson(mod.id, "L2", 2);
      const students = [1, 2].map(() => enrollStudent(base.course.id));
      completeLesson(students[0].id, l1.id, daysAgo(1));

      expect(
        getCourseFunnel(base.instructor.id, base.course.id)!.largestDropLessonId
      ).toBe(l1.id);
    });

    it("calls out no lesson when nobody drops", () => {
      const lesson = addLesson(addModule("Only", 1).id, "L1", 1);
      completeLesson(enrollStudent(base.course.id).id, lesson.id, daysAgo(1));

      expect(
        getCourseFunnel(base.instructor.id, base.course.id)!.largestDropLessonId
      ).toBeNull();
    });

    it("handles a course with no enrollments", () => {
      const lesson = addLesson(addModule("Only", 1).id, "L1", 1);

      expect(getCourseFunnel(base.instructor.id, base.course.id)).toEqual({
        enrolled: 0,
        steps: [
          expect.objectContaining({
            lessonId: lesson.id,
            completed: 0,
            percent: null,
            drop: null,
          }),
        ],
        largestDropLessonId: null,
      });
    });

    it("has nothing for a draft or another instructor's course", () => {
      const other = testDb
        .insert(schema.users)
        .values({
          name: "Other Instructor",
          email: "other@example.com",
          role: schema.UserRole.Instructor,
        })
        .returning()
        .get();
      const draft = createCourse(schema.CourseStatus.Draft);
      const othersCourse = createCourse(
        schema.CourseStatus.Published,
        other.id
      );

      expect(getCourseFunnel(base.instructor.id, draft.id)).toBeUndefined();
      expect(
        getCourseFunnel(base.instructor.id, othersCourse.id)
      ).toBeUndefined();
    });
  });
});
