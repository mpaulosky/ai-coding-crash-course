import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "~/db";
import {
  CourseStatus,
  courseRatings,
  courses,
  enrollments,
  purchases,
} from "~/db/schema";

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

  const totalStudents = enrollment?.total ?? 0;
  const completed = enrollment?.completed ?? 0;

  return {
    includedCourseCount: includedCourses?.total ?? 0,
    grossRevenue: revenue?.total ?? 0,
    totalStudents,
    // Null rather than 0 when nobody is enrolled — there is no rate to report.
    completionRate: totalStudents > 0 ? completed / totalStudents : null,
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
      };
    })
    .sort((a, b) => b.revenue - a.revenue);
}
