import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "~/db";
import { CourseStatus, courses, enrollments, purchases } from "~/db/schema";

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
