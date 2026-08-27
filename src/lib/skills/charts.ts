/**
 * Chart skill: validates a structural chart specification coming from the
 * model and normalizes it into a SAFE ECharts option that the client renders
 * interactively (RichMessageRenderer lazy-loads echarts for ```chart fences).
 *
 * The normalized option is embedded in the assistant markdown as a fenced
 * ```chart code block, so charts persist with the conversation and re-render
 * on reload without any extra protocol.
 */

export type ChartType = 'line' | 'bar' | 'pie' | 'scatter' | 'area' | 'horizontal_bar';

export interface ChartSeries {
  name: string;
  data: number[];
}

export interface ChartSpec {
  title: string;
  chartType: ChartType;
  labels: string[];
  series: ChartSeries[];
  xLabel?: string;
  yLabel?: string;
}

export const CHART_TYPES: ChartType[] = ['line', 'bar', 'pie', 'scatter', 'area', 'horizontal_bar'];

const MAX_LABELS = 200;
const MAX_SERIES = 10;

function toNumber(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(String(value ?? '').replace(/[,%\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Validates and normalizes a raw chart spec (as produced by the model).
 * Throws a readable Arabic error when the spec is unusable — the tool surfaces
 * it to the model so it can retry with corrected inputs.
 */
export function normalizeChartSpec(raw: Record<string, unknown>): ChartSpec {
  const title = String(raw.title || '').trim();
  if (!title) throw new Error('عنوان المخطط (title) مطلوب');

  const chartType = String(raw.chartType || raw.type || 'bar').toLowerCase() as ChartType;
  if (!CHART_TYPES.includes(chartType)) {
    throw new Error(`نوع مخطط غير مدعوم: ${chartType}. الأنواع المتاحة: ${CHART_TYPES.join(', ')}`);
  }

  let labels = Array.isArray(raw.labels) ? raw.labels.map((l) => String(l)) : [];
  if (labels.length === 0 && typeof raw.labels === 'string') {
    labels = (raw.labels as string)
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (labels.length === 0) throw new Error('تسميات المحاور (labels) مطلوبة وغير فارغة');
  labels = labels.slice(0, MAX_LABELS);

  let rawSeries: unknown[] = [];
  if (Array.isArray(raw.series)) {
    rawSeries = raw.series;
  } else if (Array.isArray(raw.data)) {
    // Single-series shorthand: data: [1,2,3]
    rawSeries = [{ name: title, data: raw.data }];
  }
  if (rawSeries.length === 0) throw new Error('بيانات السلاسل (series) مطلوبة: مصفوفة من {name, data[]}');

  const series: ChartSeries[] = rawSeries.slice(0, MAX_SERIES).map((s, i) => {
    const obj = (s && typeof s === 'object' ? s : {}) as Record<string, unknown>;
    const data = Array.isArray(obj.data) ? obj.data.map(toNumber) : [];
    if (data.length === 0) throw new Error(`السلسلة رقم ${i + 1} لا تحتوي على بيانات رقمية (data)`);
    return {
      name: String(obj.name || `سلسلة ${i + 1}`).slice(0, 80),
      data: data.slice(0, MAX_LABELS),
    };
  });

  return {
    title: title.slice(0, 160),
    chartType,
    labels,
    series,
    xLabel: raw.xLabel ? String(raw.xLabel).slice(0, 60) : undefined,
    yLabel: raw.yLabel ? String(raw.yLabel).slice(0, 60) : undefined,
  };
}

/**
 * Converts the normalized spec into a minimal, safe ECharts option object.
 * Only whitelisted keys are emitted — no callbacks, no raw JS, nothing the
 * renderer would eval. The client applies it with setOption(option).
 */
export function toEChartsOption(spec: ChartSpec): Record<string, unknown> {
  const horizontal = spec.chartType === 'horizontal_bar';
  const categoryAxis = {
    type: 'category',
    data: spec.labels,
    name: horizontal ? spec.yLabel : spec.xLabel,
    axisLabel: { interval: 0, rotate: !horizontal && spec.labels.length > 8 ? 35 : 0 },
  };
  const valueAxis = {
    type: 'value',
    name: horizontal ? spec.xLabel : spec.yLabel,
  };

  const baseType =
    spec.chartType === 'area'
      ? 'line'
      : spec.chartType === 'horizontal_bar' || spec.chartType === 'bar'
        ? 'bar'
        : spec.chartType;

  return {
    title: { text: spec.title, left: 'center', textStyle: { fontSize: 14 } },
    tooltip: { trigger: spec.chartType === 'pie' ? 'item' : 'axis' },
    legend: spec.series.length > 1 || spec.chartType === 'pie' ? { bottom: 0 } : undefined,
    grid: { left: 48, right: 24, top: 48, bottom: spec.series.length > 1 ? 48 : 32, containLabel: true },
    xAxis: spec.chartType === 'pie' ? undefined : horizontal ? valueAxis : categoryAxis,
    yAxis: spec.chartType === 'pie' ? undefined : horizontal ? categoryAxis : valueAxis,
    series:
      spec.chartType === 'pie'
        ? [
            {
              type: 'pie',
              radius: ['30%', '65%'],
              data: spec.labels.map((label, i) => ({ name: label, value: spec.series[0]?.data[i] ?? 0 })),
            },
          ]
        : spec.series.map((s) => ({
            name: s.name,
            type: baseType,
            data: s.data,
            smooth: spec.chartType === 'line' || spec.chartType === 'area',
            areaStyle: spec.chartType === 'area' ? {} : undefined,
          })),
  };
}

/**
 * The markdown fence the model embeds in its reply (and the UI re-renders).
 * It carries the normalized ChartSpec — NOT the ECharts option — so the client
 * re-validates it and builds the whitelisted option itself (single source of
 * truth for rendering, no untrusted option objects shipped to the browser).
 */
export function chartMarkdownFence(spec: ChartSpec): string {
  return '```chart\n' + JSON.stringify(spec) + '\n```';
}
