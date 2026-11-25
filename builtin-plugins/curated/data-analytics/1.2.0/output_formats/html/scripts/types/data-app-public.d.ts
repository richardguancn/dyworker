import type { ChartConfig, SingleChart } from "./canonical-chart";
export type { ChartConfig, SingleChart, Comparison } from "./canonical-chart";
import type * as React from "react";
import "./react-style";
import type { AuthoredChartSpec, ChartSpec, ChartDataInputs, ChartAnnotation, ValueFormat, BarOptions, BarPresentation, AppBarSpec } from "./chart-spec";
export type { AuthoredChartSpec as ChartSpec, ChartDataInputs, ChartAnnotation, ValueFormat, BarOptions, BarPresentation } from "./chart-spec";

/** Reviewed data is intentionally schema-flexible. Bindings and observations are
 * validated at runtime; this API does not infer database columns or cell units. */
export type DataRow = Record<string, any>;
/** Validate the canonical chart configuration and translate physical axes to the
 * retained renderer encoding used by the production public chart components. */
export function chartConfigEntries(config: ChartConfig): Array<Omit<SingleChart, "spec" | "height"> & {
  spec: ChartSpec; height: number;
}>;
export type DataStyle = React.CSSProperties & { [key: `--${string}`]: string | number | undefined };
export type Tone = "positive" | "negative" | "neutral";
export type FilterValue = string | string[];
export type FilterValues = Record<string, FilterValue>;
export interface FilterDefinition {
  id: string; field: string; label: string; queryIds?: readonly string[]; defaultValue?: FilterValue;
  multiple?: boolean; type?: string; valueType?: string; mode?: "through" | "exact";
  allLabel?: string; searchable?: boolean;
  visible?: boolean; reportVisible?: boolean; surface?: "dashboard" | "report";
  surfaces?: readonly ("dashboard" | "report")[];
}
/** Fields displayed by Sources. Store inputs, transformations and material limits
 * in their respective fields; a generic name/title/description is not rendered. */
export interface QuerySource {
  /** @deprecated Legacy citation fallback; use label for Sources and citations. */
  name?: string;
  label?: string; sql?: string; executedAt?: string;
  query?: { description?: string; sql?: string; [metadata: string]: unknown };
  files?: readonly (string | { name?: string; label?: string; file?: string; href?: string; url?: string })[];
  filters?: readonly string[]; caveats?: readonly string[];
  metricDefinitions?: readonly (string | { label: string; definition: string;
    field?: string; formula?: string; componentIds?: readonly string[]; [metadata: string]: unknown })[];
  [metadata: string]: unknown;
}
export interface ReviewedQuery { rows?: DataRow[]; source?: QuerySource; reportingField?: string; [metadata: string]: unknown }
export type ReviewedQueries = Record<string, ReviewedQuery>;
export interface ScopedFilter { field: string; label: string; value: FilterValue; queryIds?: readonly string[] }
export interface SectionScope { id?: string; rowId?: string; label?: string; componentIds?: readonly string[] }
export interface ComponentRecord {
  id: string; title: string; queryId: string; queryIds?: readonly string[]; kind?: string; chart?: ChartSpec;
  displayRows?: readonly DataRow[]; sourceRows?: readonly DataRow[]; sourceRowsByQuery?: Record<string, readonly DataRow[]>;
  description?: string; scopeFilters?: readonly ScopedFilter[];
}
export interface DataComponentProps extends Omit<ComponentRecord, "chart"> {
  chart?: AuthoredChartSpec;
  dataInputs?: ChartDataInputs; editMode?: boolean; canEdit?: boolean; published?: boolean; className?: string;
  onOpen?: (view: string, component: ComponentRecord) => void; onHide?: (id: string) => void;
  onEdit?: () => void; onCopy?: (format: string, component: ComponentRecord) => void | Promise<void>;
  onRegisterComponent?: (component: ComponentRecord, element: HTMLElement | null) => void;
  onTitleChange?: (title: string, id: string) => void; titleOverrides?: Record<string, string>;
  additionalActions?: React.ReactNode; hideDescriptionTooltip?: boolean; variant?: "plain" | "card";
  padding?: "standard" | "spacious" | "compact"; smoothCorners?: boolean;
  showHeading?: boolean; showActions?: boolean; headingLevel?: number; sectionFilters?: FiltersProps;
  headerControls?: React.ReactNode; children?: React.ReactNode; loading?: boolean;
  loadingError?: unknown; loadingKind?: string; loadingHeight?: number | string; onRetry?: () => void;
}
export function DataComponent(props: DataComponentProps): React.ReactElement | null;
export function ReportSection(props: DataComponentProps): React.ReactElement | null;

export type ColorResolver = (input?: { field?: string; dimension?: string; value?: unknown; index?: number; explicitColor?: string }) => string;
export interface ChartMarkContext { chartId?: string; row?: DataRow; label?: string; field?: string; value?: unknown;
  spec?: ChartSpec; [metadata: string]: unknown }
export interface MarkAction { label: string; onSelect?: () => void; href?: string; disabled?: boolean }
export interface ChartOptions {
  resolveColor?: ColorResolver; visibleSeries?: readonly string[]; onVisibleSeriesChange?: (series: string[]) => void;
  zoomRange?: ChartZoomRange | null; onZoomChange?: (range: ChartZoomRange | null) => void;
  tooltipContent?: React.ReactNode | ((props: ChartTooltipProps) => React.ReactNode);
  getMarkActions?: (context: ChartMarkContext) => readonly MarkAction[];
  onSankeySelection?: (selection: unknown) => void; portalContainer?: HTMLElement | DocumentFragment;
}
export interface LegacyChartProps extends ChartOptions { chartId?: string; spec: AuthoredChartSpec; dataInputs?: ChartDataInputs;
  rows: readonly DataRow[]; height?: number }
export type ChartProps = (ChartOptions & { config: ChartConfig; spec?: never; rows?: never; chartId?: never; dataInputs?: never; height?: never })
  | (LegacyChartProps & { config?: never });
export function Chart(props: ChartProps): React.ReactElement | null;
export { Chart as ChartRenderer };
export interface LegacyEvidenceChartProps extends Omit<DataComponentProps, "kind" | "chart" | "displayRows"> {
  spec: AuthoredChartSpec; rows: readonly DataRow[]; sourceRows?: readonly DataRow[]; height?: number;
  chartOptions?: ChartOptions; renderPlot?: (plot: React.ReactElement, chart: ChartSpec) => React.ReactNode;
}
export type ChartEvidenceProps = Omit<LegacyEvidenceChartProps, "id" | "title" | "description" | "spec" | "rows" | "height" | "dataInputs" | "queryId"> & { queryId?: string };
export type EvidenceChartProps = (LegacyEvidenceChartProps & { config?: never })
  | (ChartEvidenceProps & { config: ChartConfig; evidenceById?: Record<string, ChartEvidenceProps & { queryId: string }>;
      id?: never; title?: never; spec?: never; rows?: never; height?: never; description?: never; dataInputs?: never });
export function EvidenceChart(props: EvidenceChartProps): React.ReactElement | null;
export interface ChartTooltipEntry { dataKey?: string; name?: string; value?: unknown; color?: string; fill?: string; payload?: DataRow }
export interface ChartTooltipProps {
  active?: boolean; label?: React.ReactNode; payload?: readonly ChartTooltipEntry[]; stacked?: boolean; vertical?: boolean;
  resolveColor?: (entry: ChartTooltipEntry) => string | undefined; mode?: "default" | "pie" | "heatmap" | "scatter" | "boxPlot";
  xField?: string; yField?: string; groupField?: string; xLabel?: string; yLabel?: string;
  formatValue?: (value: any, field?: string) => React.ReactNode; details?: readonly { label: string; value: React.ReactNode }[];
  detailFields?: readonly { field: string; label: string }[]; headerValue?: React.ReactNode; children?: React.ReactNode;
  formatLabel?: (entry: ChartTooltipEntry) => React.ReactNode;
  resolveStyle?: (entry: ChartTooltipEntry) => { type?: string; opacity?: number };
  comparisonMode?: boolean; baseField?: (field: string) => string;
}
export function ChartTooltip(props: ChartTooltipProps): React.ReactElement | null;
export function ChartMark(props: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  context: ChartMarkContext; tooltip?: React.ReactNode; tooltipEnabled?: boolean;
}): React.ReactElement;
export interface ChartPresentation { chart: ChartSpec; title: string; description?: string }
export interface ChartEditorCapabilities { types?: readonly ChartSpec["type"][]; fieldsEditable?: boolean;
  xFields?: readonly string[]; yFields?: readonly string[]; seriesFields?: readonly string[]; [option: string]: unknown }
export interface ChartEditorProps {
  DialogComponent: React.ComponentType<DialogProps>; SelectComponent: React.ComponentType<NativeSelectProps>;
  TooltipComponent?: typeof Tooltip; component: ComponentRecord & { chart: ChartSpec };
  getRows: () => DataRow[]; resolveColor?: ColorResolver; visibleSeries?: readonly string[];
  zoomRange?: ChartZoomRange | null; canEdit?: boolean; onClose: () => void;
  onSave: (chart: ChartSpec, metadata?: { title: string; description: string }) => void | Promise<void>;
  variant?: "dialog" | "contained"; portalContainer?: HTMLElement | DocumentFragment; themeRoot?: HTMLElement;
  style?: DataStyle; previewHeight?: number; saveLabel?: string; notice?: React.ReactNode; editMetadata?: boolean;
  resetPresentation?: { chart: ChartSpec; title?: string; description?: string }; resetLabel?: string;
  validatePresentation?: (presentation: ChartPresentation, rows: readonly DataRow[]) => ChartPresentation | Promise<ChartPresentation>;
  getCapabilities?: (spec: ChartSpec, rows: readonly DataRow[]) => ChartEditorCapabilities;
}
export function ChartEditor(props: ChartEditorProps): React.ReactElement;

export interface TableColumn<Row extends DataRow = DataRow> {
  field?: string; key?: string; label?: string;
  presentation?: "identity" | "sparkline" | "bar" | "status" | "percent";
  secondaryField?: string; valueFormat?: ValueFormat; max?: number;
  renderCell?: (value: any, row: Row) => React.ReactNode;
  deltaTone?: Tone | ((value: any, row: Row) => Tone);
}
export interface DataTableProps<Row extends DataRow = DataRow> {
  rows: readonly Row[]; searchable?: boolean; compactColumns?: readonly string[]; compactNumbers?: boolean;
  signedDeltas?: boolean; columns?: readonly (TableColumn<Row> & ({ field: string } | { key: string }))[];
  rowKey?: string; selectedRowKey?: string | number | null; onRowSelect?: (row: Row) => void; rowActionLabel?: (row: Row) => string;
  toolbarControls?: React.ReactNode; caption?: string; label?: string; pageSize?: number; paginationStyle?: "default" | "receipt";
}
export function DataTable<Row extends DataRow = DataRow>(props: DataTableProps<Row>): React.ReactElement;
export { DataTable as Table };
export interface NativeSelectProps {
  label: string; value?: string; choices?: readonly string[]; onChange?: (value: string) => void;
  showLabel?: boolean; allLabel?: string; formatChoice?: (choice: string) => React.ReactNode;
  triggerClassName?: string; disabled?: boolean; groups?: readonly { label?: string; choices: readonly string[] }[];
}
export function NativeSelect(props: NativeSelectProps): React.ReactElement;
type SelectMode = { multiple?: false; value?: string; onChange?: (value: string) => void }
  | { multiple: true; value?: readonly string[]; onChange?: (value: string[]) => void };
export type DropdownProps = Omit<NativeSelectProps, "value" | "onChange"> & SelectMode & {
  searchable?: boolean; choiceLabels?: Record<string, React.ReactNode>; describedBy?: string;
  renderChoice?: (choice: string) => React.ReactNode; contentClassName?: string; align?: "start" | "center" | "end";
  modal?: boolean; scrollToSelected?: boolean; portalContainer?: HTMLElement | DocumentFragment; placeholder?: string;
};
export function Dropdown(props: DropdownProps): React.ReactElement;
export function DateRangePicker(props: { label?: string; value: string; choices?: readonly string[];
  formatChoice?: (choice: string) => React.ReactNode; onChange?: (value: string) => void; allValue?: string; disabled?: boolean }): React.ReactElement;
export interface FiltersProps {
  filters?: readonly FilterDefinition[]; queries?: ReviewedQueries; values?: FilterValues;
  onChange?: (id: string, value: FilterValue) => void; sticky?: boolean; ariaLabel?: string; clearLabel?: string;
  showClear?: boolean; dateAllValue?: string; sectionScope?: SectionScope; children?: React.ReactNode; trailingControls?: React.ReactNode;
}
export function Filters(props: FiltersProps): React.ReactElement | null;
export function InlineFilters(props: { label: string; field: string; rows?: readonly DataRow[]; value?: string;
  onChange?: (value: string) => void }): React.ReactElement;
export interface SliderProps { id?: string; name?: string; label?: string; min?: number; max?: number; step?: number;
  value?: number; onChange?: (value: number) => void; formatValue?: (value: number) => string | number;
  disabled?: boolean; showBounds?: boolean; labelPlacement?: "outside" | "inline" | "hidden";
  layout?: "stacked" | "inline"; className?: string; style?: DataStyle }
export function Slider(props: SliderProps): React.ReactElement;
export function RangeSlider(props: Omit<SliderProps, "value" | "onChange"> & { lowerName?: string; upperName?: string;
  minDistance?: number; value?: readonly [number, number]; onChange?: (value: [number, number]) => void }): React.ReactElement;
export type SegmentedOption<Value extends string | number = string | number> = Value | { value: Value; label: React.ReactNode;
  ariaLabel?: string; title?: string; tooltip?: React.ReactNode; disabled?: boolean };
export type SegmentedControlProps<Value extends string | number = string | number> = {
  options?: readonly SegmentedOption<Value>[]; ariaLabel?: string; size?: "compact" | "default";
  disabled?: boolean; fullWidth?: boolean; className?: string;
} & ({ selectionMode?: "single"; value?: Value; onChange?: (value: Value) => void }
  | { selectionMode: "multiple"; value?: readonly Value[]; onChange?: (value: Value[]) => void });
export function SegmentedControl<Value extends string | number = string | number>(props: SegmentedControlProps<Value>): React.ReactElement;
export function Switch(props: { label: string; checked?: boolean; onChange?: (checked: boolean) => void;
  disabled?: boolean; fullWidth?: boolean; size?: "default" | "compact"; className?: string }): React.ReactElement;

export interface MetricCardProps extends Omit<DataComponentProps, "kind"> { value: React.ReactNode; comparison?: React.ReactNode;
  deltaTone?: Tone | ((value: React.ReactNode) => Tone); negative?: boolean; trendValues?: readonly (number | null | undefined)[]; trendLabel?: string; periodLabel?: string; periodDescription?: string }
export function MetricCard(props: MetricCardProps): React.ReactElement;
export function MetricSparkline(props: { values?: readonly (number | null | undefined)[]; label?: string; tone?: Tone;
  negative?: boolean; className?: string }): React.ReactElement | null;
export interface MetricTabItem { id: string; title: string; value: React.ReactNode; comparison?: React.ReactNode;
  tone?: Tone; negative?: boolean; trendValues?: readonly (number | null | undefined)[]; description?: string }
export function MetricCardTabs(props: { items: readonly MetricTabItem[]; selectedId: string; onChange?: (id: string) => void;
  size?: "small" | "medium" | "large"; orientation?: "horizontal" | "vertical"; ariaLabel?: string;
  className?: string; children?: React.ReactNode | ((state: { item: MetricTabItem; selectedId: string }) => React.ReactNode) }): React.ReactElement;

export type SectionSpacing = "none" | "metrics" | "content" | "continuation" | "section" | "after-metrics";
export type SectionProps = { children?: React.ReactNode; columns?: number; kind?: "content" | "metrics";
  spacing?: SectionSpacing; className?: string }
  & ({ id: string; title: string; filters?: React.ReactNode }
    | { id?: string; title?: ""; filters?: null | false | "" | 0 });
export function Section(props: SectionProps): React.ReactElement;
export function SectionHeader(props: { id: string; title: React.ReactNode; filters?: React.ReactNode;
  as?: keyof React.JSX.IntrinsicElements; className?: string }): React.ReactElement;
export function SectionNavigator(props: { sections?: readonly { id: string; label: string }[];
  label?: string; placement?: "auto" | "inline" }): React.ReactElement | null;
export function ExecutiveSummary(props: { title?: string; preview?: React.ReactNode; open?: boolean; defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void; headingLevel?: number; inset?: boolean; className?: string; children?: React.ReactNode }): React.ReactElement;
export function EditableText<Tag extends keyof React.JSX.IntrinsicElements = "p">(
  props: { as?: Tag } & React.ComponentPropsWithoutRef<Tag>): React.ReactElement;
export function RichNarrative(props: React.HTMLAttributes<HTMLDivElement> & { id: string; value: string;
  sourcePreviews?: Record<string, { title?: string; description?: string; [metadata: string]: unknown }>; label?: string }): React.ReactElement;
export interface SortableRow { id: string; items: readonly string[]; kind?: "content" | "metrics";
  spacing?: SectionSpacing; header?: React.ReactNode; className?: string; label?: string }
export function SortableRegion(props: React.HTMLAttributes<HTMLElement> & { id: string; htmlId?: string; label?: string;
  variant?: "stack" | "grid" | "canvas" | "freeform"; transferGroup?: string; authoredRevision?: number;
  authoredOrder?: readonly string[]; columns?: number; rows?: readonly SortableRow[]; spacing?: "authored" | "standard";
  as?: keyof React.JSX.IntrinsicElements; style?: DataStyle }): React.ReactElement;
export function SortableItem(props: { id: string; label?: string; kind?: string; span?: number; minSpan?: number;
  effectiveSpan?: number; soloResized?: boolean; resizable?: boolean; resizeRange?: readonly [number, number];
  resizeNeighborId?: string; resizeNeighborLabel?: string; locked?: boolean; className?: string;
  style?: DataStyle; children?: React.ReactNode }): React.ReactElement;

export function Button(props: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger" }): React.ReactElement;
export function Icon(props: { name: string; size?: number; className?: string }): React.ReactElement;
export interface DialogProps { open?: boolean; title: React.ReactNode; titleInfo?: React.ReactNode; initialFocusSelector?: string;
  expanded?: boolean; className?: string; style?: DataStyle; headerActions?: React.ReactNode; onClose: () => void;
  children?: React.ReactNode; showClose?: boolean; backdropClassName?: string; portalContainer?: HTMLElement | DocumentFragment;
  contentRef?: React.Ref<HTMLDivElement>; onKeyDown?: React.KeyboardEventHandler<HTMLDivElement> }
export function Dialog(props: DialogProps): React.ReactElement;
export function ContainedDialog(props: Omit<DialogProps, "open" | "titleInfo" | "style" | "backdropClassName" | "portalContainer"> & {
  layerClassName?: string }): React.ReactElement;
export function Tooltip(props: React.HTMLAttributes<HTMLDivElement> & { portal?: boolean; visible?: boolean }): React.ReactElement;
export function InfoTooltip(props: { label?: string; trigger?: React.ReactNode; triggerClassName?: string; children?: React.ReactNode; portalContainer?: HTMLElement | DocumentFragment }): React.ReactElement;
export function TruncatedText<Tag extends keyof React.JSX.IntrinsicElements = "span">(props: { as?: Tag;
  focusOnParent?: boolean; anchorRef?: React.RefObject<HTMLElement | null> } & React.ComponentPropsWithoutRef<Tag>): React.ReactElement;
export function Menu(props: { label: string; trigger: React.ReactNode; children?: React.ReactNode; align?: "start" | "center" | "end";
  side?: "top" | "bottom" | "left" | "right"; contentClassName?: string; open?: boolean; onOpenChange?: (open: boolean) => void;
  contentProps?: React.HTMLAttributes<HTMLDivElement>; portalContainer?: HTMLElement | DocumentFragment }): React.ReactElement;
export function MenuItem(props: Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onSelect"> & { icon?: string; leading?: React.ReactNode;
  danger?: boolean; subtext?: React.ReactNode; onSelect?: (event: Event) => void; href?: string; target?: string; rel?: string }): React.ReactElement;
export function MenuSub(props: { icon?: string; leading?: React.ReactNode; label: string; children?: React.ReactNode;
  contentClassName?: string; triggerClassName?: string; portalContainer?: HTMLElement | DocumentFragment }): React.ReactElement;
export function MenuGroup(props: { label: string; children?: React.ReactNode }): React.ReactElement;
export function MenuSeparator(): React.ReactElement;
export function Tabs(props: { id?: string; label: string; items: readonly { id: string; label: React.ReactNode }[];
  value: string; onChange: (id: string) => void; className?: string; variant?: "underline" | "default";
  indicatorMotion?: { duration: number; easing: string } }): React.ReactElement;
export function TabPanel(props: { tabsId: string; tabId: string; active: boolean; className?: string;
  children?: React.ReactNode; keepMounted?: boolean }): React.ReactElement | null;
export function QueryDataBoundary(props: { queryIds?: readonly string[]; children?: React.ReactNode;
  loadingLayout?: "page" | "component"; loadingKind?: string; loadingHeight?: number | string }): React.ReactElement | null;

export interface SourceInspectorProps { component: ComponentRecord; query?: ReviewedQuery; rows?: readonly DataRow[];
  filters?: readonly ScopedFilter[]; allowCopy?: boolean; chartEdited?: boolean; receiptQueries?: readonly ReviewedQuery[];
  onReceiptCollapse?: () => void; receiptContentId?: string; externalReceiptToggle?: boolean; receiptAssumptions?: Record<string, unknown> }
export function SourceInspector(props: SourceInspectorProps): React.ReactElement;
export function SourceSidebar(props: { component: ComponentRecord; getSource: (queryId: string) => Omit<SourceInspectorProps, "component"> | null;
  queries?: ReviewedQueries; onClose: () => void; variant?: "viewport" | "contained"; allowCopy?: boolean; chartEdited?: boolean }): React.ReactElement;

export interface DataAppSnapshot { id?: string; title: string; surface?: "dashboard" | "report"; queries: ReviewedQueries;
  filters?: readonly FilterDefinition[]; report?: { visibleFilterIds?: readonly string[]; [metadata: string]: unknown };
  [metadata: string]: unknown }
export interface DataSnapshot extends DataAppSnapshot {}
export interface PeriodRowsOptions { period?: "history" | "latest" | "previous"; periodField?: string;
  currentPeriod?: string | number; breakdown?: readonly string[]; visibleFilterIds?: readonly string[] }
export interface ChartZoomRange { start: string; end: string }
export interface ChartState { visibleSeries?: string[]; zoomRange?: ChartZoomRange | null }
export interface ReportFollowUp { id?: string; narrativeId?: string; text?: string; queryId?: string;
  queryIds?: readonly string[]; editorOnly?: boolean; [metadata: string]: unknown }
export interface DashboardTab { id: string; label: string; filterIds?: readonly string[]; [metadata: string]: unknown }
export interface DataAppContext {
  snapshot: DataAppSnapshot; hosted: boolean; canEdit: boolean; queries: ReviewedQueries; filters: FilterValues;
  setFilter(id: string, value: FilterValue): void; reviewedRows(queryId: string, breakdown?: readonly string[]): DataRow[];
  reviewedPeriodRows(queryId: string, options?: PeriodRowsOptions): DataRow[];
  reviewedAggregatePeriodRows(queryId: string, options?: PeriodRowsOptions): DataRow[];
  activeFilters: ScopedFilter[]; mode: "view" | "edit"; appTitle: string; setAppTitle: React.Dispatch<React.SetStateAction<string>>;
  assumptions: Record<string, any>; setAssumptions: React.Dispatch<React.SetStateAction<Record<string, any>>>;
  sectionViews: Record<string, FilterValues>; setSectionView(id: string, values: FilterValues): void;
  chartOverrides: Record<string, ChartSpec | undefined>; chartStates: Record<string, ChartState | undefined>; visible(id: string): boolean;
  updateChartState(id: string, changes: Partial<ChartState>): void;
  chartProps(id: string): ChartOptions & { chartId: string }; resolveColor: ColorResolver; surfaceNoun: "report" | "dashboard";
  componentActions: Partial<DataComponentProps>; chartExportActive: boolean; activeTabId: string;
  registerDashboardTabs(tabs: readonly DashboardTab[]): void; setDashboardBusy(busy: boolean): void;
  exploreDashboard(tabId: string, payload?: { filters?: FilterValues; focus?: Record<string, string> }): void;
  returnFromExploration(): void;
  setDashboardFocus(focus: Record<string, unknown> | null): void; viewFocus: Record<string, unknown> | null;
  canReturnFromExploration: boolean; hiddenBlockIds: Set<string>; narrativeEdits: Record<string, string>;
  reportFollowUpHref(followUp: ReportFollowUp): React.AnchorHTMLAttributes<HTMLAnchorElement> | null;
  requestReportFollowUp(action: "report-investigate" | "report-investigate-update" | "report-correct", followUp: ReportFollowUp): Promise<boolean>;
  requestTextEdit(target: HTMLElement): void; setNarrativeEdit(id: string, value: string): void;
}
export function useDataApp(): DataAppContext;
export function useDashboardTabs(definitions?: readonly DashboardTab[]): { activeTabId: string };
export function useSectionFilters(definitions?: readonly FilterDefinition[], initialValues?: FilterValues, scope?: SectionScope): {
  values: FilterValues; setFilter(id: string, value: FilterValue): void;
  reviewedRows(queryId: string, breakdown?: readonly string[]): DataRow[];
  componentProps(queryId: string, breakdown?: readonly string[]): Required<Pick<DataComponentProps, "displayRows" | "sourceRows" | "scopeFilters">> & Pick<DataComponentProps, "sectionFilters">;
  filterProps: FiltersProps;
};
export function previousPeriodRows<Row extends DataRow>(rows: readonly Row[], definitions: readonly FilterDefinition[],
  filters: FilterValues, queryId: string, periodField: string, currentPeriod: string | number): Row[];

export function compact(value: unknown): string;
export function displayValue(value: unknown): string;
export function label(field?: string): string;
export function percentage(value: unknown): string;
export function shortDate(value: string | number | Date): string;
export function periodComparison(current: number | null | undefined, previous: number | null | undefined,
  options?: { percentagePoints?: boolean; lowerIsBetter?: boolean; previousPeriod?: string; includePeriod?: boolean }): { comparison?: string; negative?: boolean };
export function semanticColorResolver(queries?: ReviewedQueries, metadata?: unknown): ColorResolver;
export const chartSpecKeys: readonly string[];
export function projectChartSpec(spec: ChartSpec): ChartSpec;
export function chartDataShape(spec: ChartSpec, rows?: readonly DataRow[]): { columns: string[]; numeric: string[];
  seriesValues: string[]; fields: string[]; barFields: string[]; heatmapGroup?: string; sankeyStages: string[];
  longForm: boolean; reviewedBoxPlot: boolean; requiresX: boolean; requiredRowFields: string[]; optionalRowFields: string[]; rowFields: string[] };
export function groupAdditiveCategories<Row extends DataRow>(rows?: readonly Row[], options?: { categoryField?: string;
  valueField?: string; maxCategories?: number; preserveCategories?: readonly string[]; enabled?: boolean }): Row[];
export function normalizeChartAnnotations(annotations?: readonly ChartAnnotation[]): ChartAnnotation[];
export function resolveChartAnnotations(spec: ChartSpec, rows: readonly DataRow[], options?: {
  data?: readonly DataRow[]; visibleFields?: readonly string[] }): (ChartAnnotation & Record<string, unknown>)[];
export type BarRecipe = Omit<BarOptions, "formatValue"> & { formatValue?: never; xLabel?: string; type?: "bar" | "horizontalBar";
  presentation?: BarPresentation; valueFormat?: ValueFormat }
  & ({ category: string; x?: string } | { x: string; category?: string })
  & ({ value: string; y?: string } | { y: string; value?: string }
    | { series: readonly [NonNullable<BarOptions["series"]>[number], ...NonNullable<BarOptions["series"]>[number][]] });
export function barChartSpec(recipe: BarRecipe | (AppBarSpec & { formatValue?: never })): AppBarSpec;
