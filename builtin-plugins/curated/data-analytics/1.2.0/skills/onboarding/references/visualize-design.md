# Onboarding selector references

Use the bundled HTML as the starting code for Visualize workflow buttons. Preserve its layout, scoped component styles, icons, accessibility, and confirmed follow-up behavior; personalize the labels and prompts without recreating the controls as generic chips. The Data visualize-data skill still owns file placement, the host bridge, and inline delivery. These product-specific styles implement the requested Figma design and deliberately replace generic utility-button styling only inside these selectors.

## Workflow choices

Copy [workflow-selector.html](../assets/workflow-selector.html). It implements the [workflow-first selector](https://www.figma.com/design/vrRhbJbSVJFlUgpdkzPHSo/Data-Plugin?node-id=4052-85673), also used by the [connection-first flow](https://www.figma.com/design/vrRhbJbSVJFlUgpdkzPHSo/Data-Plugin?node-id=4052-85789):

- Stack content-width pills vertically, aligned left, with 12px between them. Keep this layout at desktop widths; do not turn it into a horizontal toolbar or equal-width cards.
- Use the 24px icons, 8px icon-to-label gap, rounded ends, quiet border, and 40px minimum row height. On touch devices, use at least 44px targets. Long labels wrap within the available width while icons retain their size.
- The investigation and artifact icons embed the exact SVG exports from Figma nodes `4052:85680` and `4052:85684`. Keep them embedded so copied fragments need no external image request or expiring Figma URL. The connection action uses the host's Lucide plug icon.
- Show **Connect my data** first, followed by **Understand what changed** and **Build a dashboard or report**; omit a Skip button. After connection, remove the connection button and its map entry, leaving the two workflows. Preserve native focus indication, disabled pending states, typed fallback, and cancellation recovery.

Use concise user-facing prompts, such as “Help me investigate a metric change with Data.” Include real task details already known when useful. These prompts become visible messages in the conversation: do not insert long instructions about how the assistant should gather details, pick tools, or run onboarding. The onboarding skill already owns that behavior.

## Follow-up intake

The design shows [What would you like to make?](https://www.figma.com/design/vrRhbJbSVJFlUgpdkzPHSo/Data-Plugin?node-id=4119-88422), then [What should your dashboard cover?](https://www.figma.com/design/vrRhbJbSVJFlUgpdkzPHSo/Data-Plugin?node-id=4141-15858). Although those headers say “1 of 3” and “2 of 3,” the [next screen](https://www.figma.com/design/vrRhbJbSVJFlUgpdkzPHSo/Data-Plugin?node-id=4141-16237) says “Asked 2 questions” and offers app connections; it does not define a third question.

Follow [task intake](../../../shared/task-intake.md) for clarification and [source setup](../../../shared/source-setup.md#native-connection-controls) for provider connections. The design illustrates a possible flow, not a mandatory questionnaire. Preserve known answers and the selected format; do not recreate native intake or connection controls in Visualize or add custom Skip buttons.

## Conversation composition

For the first open-ended welcome, use the [welcome samples](business-review-demo.md): a short Data overview, sample dashboard and report descriptions with links, then the three choices. Open the dashboard beside the conversation and leave the report available through its link. Keep the fictional story and charts inside the outputs. Present native Plugin Management offers after the user chooses connection or a workflow needs access. Provider eligibility, installation, sign-in, and connection states come from the host; do not copy the design's sample providers or imitate its connection cards in Visualize.

When adapting a template, update its root ID everywhere, labels, accessible names, typed fallback, and prompts together. Keep root-scoped styling and the same host theme tokens. For a single post-result action, retain one workflow-style pill and remove setup-only controls. Rendering any selector ends the turn; resume only after the actual resulting user message.
