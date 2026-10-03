import {
  and,
  countDistinct,
  eq,
  gte,
  inArray,
  min,
  sql,
  type SQL,
} from "drizzle-orm";
import { union, type SQLiteColumn } from "drizzle-orm/sqlite-core";
import { db } from "~/db";
import {
  CourseStatus,
  courseRatings,
  courses,
  enrollments,
  LessonProgressStatus,
  lessonProgress,
  lessons,
  modules,
  purchases,
  videoWatchEvents,
} from "~/db/schema";
import { getUnansweredQuestions } from "~/services/commentService";

// ─── Analytics Service ───
// Instructor analytics, computed on demand with SQL aggregates.
// Uses positional parameters (project convention).

// Analytics cover an instructor's published and archived courses. Drafts are
// unreleased work and never contribute.
const INCLUDED_STATUSES = [CourseStatus.Published, CourseStatus.Archived];

function isIncludedCourseOf(instructorId: number) {
  return and(
    eq(courses.instructorId, instructorId),
    inArray(courses.status, INCLUDED_STATUSES)
  );
}

const ACTIVE_WINDOW_DAYS = 30;

/**
 * (student, course) pairs with activity in the last 30 days: a completed lesson
 * or a video watch event. Lesson progress only records a time on completion, so
 * watch events are what catch a student partway through a lesson.
 */
function recentActivity(instructorId: number) {
  const cutoff = new Date(
    Date.now() - ACTIVE_WINDOW_DAYS * 86_400_000
  ).toISOString();

  const completions = db
    .select({ userId: lessonProgress.userId, courseId: courses.id })
    .from(lessonProgress)
    .innerJoin(lessons, eq(lessonProgress.lessonId, lessons.id))
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .innerJoin(courses, eq(modules.courseId, courses.id))
    .where(
      and(
        isIncludedCourseOf(instructorId),
        eq(lessonProgress.status, LessonProgressStatus.Completed),
        gte(lessonProgress.completedAt, cutoff)
      )
    );

  const watches = db
    .select({ userId: videoWatchEvents.userId, courseId: courses.id })
    .from(videoWatchEvents)
    .innerJoin(lessons, eq(videoWatchEvents.lessonId, lessons.id))
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .innerJoin(courses, eq(modules.courseId, courses.id))
    .where(
      and(
        isIncludedCourseOf(instructorId),
        gte(videoWatchEvents.createdAt, cutoff)
      )
    );

  return union(completions, watches).as("recent_activity");
}

export function getInstructorOverview(instructorId: number) {
  const includedCourses = db
    .select({ total: sql<number>`count(*)` })
    .from(courses)
    .where(isIncludedCourseOf(instructorId))
    .get();

  const revenue = db
    .select({ total: sql<number>`coalesce(sum(${purchases.amountPaid}), 0)` })
    .from(purchases)
    .innerJoin(courses, eq(purchases.courseId, courses.id))
    .where(isIncludedCourseOf(instructorId))
    .get();

  const enrollment = db
    .select({
      total: sql<number>`count(*)`,
      completed: sql<number>`count(${enrollments.completedAt})`,
    })
    .from(enrollments)
    .innerJoin(courses, eq(enrollments.courseId, courses.id))
    .where(isIncludedCourseOf(instructorId))
    .get();

  const activity = recentActivity(instructorId);
  const active = db
    .select({ total: countDistinct(activity.userId) })
    .from(activity)
    .get();

  const totalStudents = enrollment?.total ?? 0;
  const completed = enrollment?.completed ?? 0;

  return {
    includedCourseCount: includedCourses?.total ?? 0,
    grossRevenue: revenue?.total ?? 0,
    totalStudents,
    // Null rather than 0 when nobody is enrolled — there is no rate to report.
    completionRate: totalStudents > 0 ? completed / totalStudents : null,
    activeStudents: active?.total ?? 0,
    // The questions queue owns what "unanswered" means; count what it lists.
    unansweredQuestions: getUnansweredQuestions(instructorId).length,
  };
}

export type CourseBreakdownRow = {
  id: number;
  title: string;
  status: CourseStatus;
  revenue: number;
  enrollments: number;
  completionRate: number | null;
  averageRating: number | null;
  ratingCount: number;
  activeStudents: number;
};

// Each figure is aggregated per course in its own query, then merged — joining
// purchases, enrollments and ratings together would multiply rows.
export function getCourseBreakdown(instructorId: number): CourseBreakdownRow[] {
  const included = isIncludedCourseOf(instructorId);

  const courseRows = db
    .select({ id: courses.id, title: courses.title, status: courses.status })
    .from(courses)
    .where(included)
    .all();

  const revenueByCourse = new Map(
    db
      .select({
        courseId: purchases.courseId,
        total: sql<number>`sum(${purchases.amountPaid})`,
      })
      .from(purchases)
      .innerJoin(courses, eq(purchases.courseId, courses.id))
      .where(included)
      .groupBy(purchases.courseId)
      .all()
      .map((row) => [row.courseId, row.total])
  );

  const enrollmentByCourse = new Map(
    db
      .select({
        courseId: enrollments.courseId,
        total: sql<number>`count(*)`,
        completed: sql<number>`count(${enrollments.completedAt})`,
      })
      .from(enrollments)
      .innerJoin(courses, eq(enrollments.courseId, courses.id))
      .where(included)
      .groupBy(enrollments.courseId)
      .all()
      .map((row) => [row.courseId, row])
  );

  const ratingByCourse = new Map(
    db
      .select({
        courseId: courseRatings.courseId,
        average: sql<number>`avg(${courseRatings.rating})`,
        count: sql<number>`count(*)`,
      })
      .from(courseRatings)
      .innerJoin(courses, eq(courseRatings.courseId, courses.id))
      .where(included)
      .groupBy(courseRatings.courseId)
      .all()
      .map((row) => [row.courseId, row])
  );

  const activity = recentActivity(instructorId);
  const activeByCourse = new Map(
    db
      .select({
        courseId: activity.courseId,
        total: countDistinct(activity.userId),
      })
      .from(activity)
      .groupBy(activity.courseId)
      .all()
      .map((row) => [row.courseId, row.total])
  );

  return courseRows
    .map((course) => {
      const enrollment = enrollmentByCourse.get(course.id);
      const rating = ratingByCourse.get(course.id);
      const enrolled = enrollment?.total ?? 0;

      return {
        ...course,
        revenue: revenueByCourse.get(course.id) ?? 0,
        enrollments: enrolled,
        completionRate: enrolled > 0 ? enrollment!.completed / enrolled : null,
        averageRating: rating?.average ?? null,
        ratingCount: rating?.count ?? 0,
        activeStudents: activeByCourse.get(course.id) ?? 0,
      };
    })
    .sort((a, b) => b.revenue - a.revenue);
}

// ─── Ranges ───
// An N-day range covers today plus the N-1 whole days before it, in UTC, so
// "last 7 days" is seven full calendar days on the chart.

export const ANALYTICS_RANGES = ["7d", "30d", "90d", "all"] as const;
export type AnalyticsRange = (typeof ANALYTICS_RANGES)[number];

const RANGE_DAYS: Record<AnalyticsRange, number | null> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
  all: null,
};

/** Midnight UTC on the first day of the range, or null for all time. */
function rangeStart(range: AnalyticsRange) {
  const days = RANGE_DAYS[range];
  if (days === null) return null;
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return start.toISOString();
}

export function getRevenueInRange(instructorId: number, range: AnalyticsRange) {
  const start = rangeStart(range);

  const revenue = db
    .select({ total: sql<number>`coalesce(sum(${purchases.amountPaid}), 0)` })
    .from(purchases)
    .innerJoin(courses, eq(purchases.courseId, courses.id))
    .where(
      and(
        isIncludedCourseOf(instructorId),
        start === null ? undefined : gte(purchases.createdAt, start)
      )
    )
    .get();

  return revenue?.total ?? 0;
}

// ─── Trend ───
// Revenue and new enrollments over a range, one point per bucket. Buckets are
// UTC days, ISO weeks (starting Monday) or calendar months, each keyed by its
// first day as YYYY-MM-DD.

type BucketSize = "day" | "week" | "month";

const RANGE_BUCKET: Record<AnalyticsRange, BucketSize> = {
  "7d": "day",
  "30d": "day",
  "90d": "week",
  all: "month",
};

export type TrendPoint = {
  bucketStart: string;
  revenue: number;
  enrollments: number;
};

/** The start of the bucket holding an ISO timestamp column, in SQL. */
function bucketOf(column: SQLiteColumn, size: BucketSize): SQL<string> {
  switch (size) {
    case "day":
      return sql<string>`date(${column})`;
    case "week":
      // 'weekday 1' moves forward to a Monday, so step back first
      return sql<string>`date(${column}, '-6 days', 'weekday 1')`;
    case "month":
      return sql<string>`strftime('%Y-%m-01', ${column})`;
  }
}

/** The same bucket start as bucketOf, computed in JavaScript. */
function bucketStartOf(date: Date, size: BucketSize) {
  const start = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
  if (size === "week") {
    const daysSinceMonday = (start.getUTCDay() + 6) % 7;
    start.setUTCDate(start.getUTCDate() - daysSinceMonday);
  } else if (size === "month") {
    start.setUTCDate(1);
  }
  return start;
}

function nextBucket(date: Date, size: BucketSize) {
  const next = new Date(date);
  if (size === "day") next.setUTCDate(next.getUTCDate() + 1);
  else if (size === "week") next.setUTCDate(next.getUTCDate() + 7);
  else next.setUTCMonth(next.getUTCMonth() + 1);
  return next;
}

export function getRevenueTrend(
  instructorId: number,
  range: AnalyticsRange
): TrendPoint[] {
  const size = RANGE_BUCKET[range];
  const start = rangeStart(range);
  const included = isIncludedCourseOf(instructorId);

  const revenueBucket = bucketOf(purchases.createdAt, size);
  const revenueByBucket = new Map(
    db
      .select({
        bucket: revenueBucket,
        total: sql<number>`sum(${purchases.amountPaid})`,
      })
      .from(purchases)
      .innerJoin(courses, eq(purchases.courseId, courses.id))
      .where(
        and(
          included,
          start === null ? undefined : gte(purchases.createdAt, start)
        )
      )
      .groupBy(revenueBucket)
      .all()
      .map((row) => [row.bucket, row.total])
  );

  const enrollmentBucket = bucketOf(enrollments.enrolledAt, size);
  const enrollmentsByBucket = new Map(
    db
      .select({ bucket: enrollmentBucket, total: sql<number>`count(*)` })
      .from(enrollments)
      .innerJoin(courses, eq(enrollments.courseId, courses.id))
      .where(
        and(
          included,
          start === null ? undefined : gte(enrollments.enrolledAt, start)
        )
      )
      .groupBy(enrollmentBucket)
      .all()
      .map((row) => [row.bucket, row.total])
  );

  // All time runs from the first purchase or enrollment, or just this month
  const now = new Date();
  const firstActivity =
    start ?? earliestActivity(instructorId) ?? now.toISOString();

  const points: TrendPoint[] = [];
  for (
    let bucket = bucketStartOf(new Date(firstActivity), size);
    bucket <= now;
    bucket = nextBucket(bucket, size)
  ) {
    const key = bucket.toISOString().slice(0, 10);
    points.push({
      bucketStart: key,
      revenue: revenueByBucket.get(key) ?? 0,
      enrollments: enrollmentsByBucket.get(key) ?? 0,
    });
  }
  return points;
}

function earliestActivity(instructorId: number) {
  const firstPurchase = db
    .select({ at: min(purchases.createdAt) })
    .from(purchases)
    .innerJoin(courses, eq(purchases.courseId, courses.id))
    .where(isIncludedCourseOf(instructorId))
    .get()?.at;
  const firstEnrollment = db
    .select({ at: min(enrollments.enrolledAt) })
    .from(enrollments)
    .innerJoin(courses, eq(enrollments.courseId, courses.id))
    .where(isIncludedCourseOf(instructorId))
    .get()?.at;

  const candidates = [firstPurchase, firstEnrollment].filter(
    (at): at is string => !!at
  );
  return candidates.length > 0 ? candidates.sort()[0] : null;
}
