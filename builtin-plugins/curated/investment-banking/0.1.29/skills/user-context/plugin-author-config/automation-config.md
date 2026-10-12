# Investment Banking Default Automations

## Weekly Deal Process Review

- ID: `weekly-deal-process-review`
- Name: `Weekly Investment Banking Process Review`
- Frequency: Weekly on Monday at 9:00 AM local time.
- Launcher: `Set up a weekly Investment Banking process review in this conversation.`

### Canonical Automation Prompt

Pass this prompt to the automation tool substantially verbatim:

```text
Run a read-only weekly Investment Banking source check. Invoke the Investment Banking router and apply its user-context preflight before substantive work. Review only saved deal and tracker pointers that are already present. Do not perform broad research.

Report only: Upcoming Deadlines, Stale Sources, and Missing Inputs. Include the deal or tracker, the dated item or gap, the source pointer, and the as-of date when known.

If no saved deal or tracker pointer is available, say setup needs one deal or tracker pointer. Do not invent follow-ups. If context exists but there is nothing to surface, return: No upcoming deadlines, stale sources, or missing inputs identified this week. Then state the source coverage and freshness limitations.

Do not draft analysis or modify anything. Do not change source systems, send messages, edit trackers, or save new durable preferences without an explicit user request.
```
