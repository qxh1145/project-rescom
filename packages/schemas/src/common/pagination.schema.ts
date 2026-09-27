/**
 * Shared upper bound of list `offset` / `page` query parameters. Larger values
 * (e.g. `1e20`) would reach the database `skip` and fail with a 500 instead of
 * a 400 validation error.
 */
export const MAX_PAGINATION_OFFSET = 10_000;
