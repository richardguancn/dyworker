# Data release maintenance

For Data release, deploy, publish, or release-related push requests, read
[RELEASE.md](RELEASE.md) first and follow its build, package validation, remote
version check, and readiness steps. Preparation is mandatory. Keep the prepared
artifact and its validation evidence together; deploy those exact bytes.

When adding, changing, or retiring a standard chart component, run the
[template impact check](skills/visualize-data/CHART_RELEASES.md#check-templates-that-consume-the-changed-charts)
as part of the chart task. Identify affected templates without waiting for a
reviewer to ask. Fix and verify required compatibility updates in the same
change. For optional migrations, name the templates and offer to implement
and verify the updates for the user.
