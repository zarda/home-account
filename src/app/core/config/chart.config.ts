import { provideCharts } from 'ng2-charts';
import {
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  DoughnutController,
  Filler,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
} from 'chart.js';

/**
 * Every Chart.js piece the app actually draws.
 *
 * The default registry carries polar area, radar, bubble and scatter along
 * with their scales, none of which this app has ever rendered. Listing the
 * pieces by hand is what lets the rest be tree-shaken.
 *
 * A chart type added later must add its pieces here, and a missing piece
 * fails loudly (an unregistered controller throws) except for Filler, which
 * silently drops the shading under an area chart — chart.config.spec pins
 * that one by name for exactly that reason.
 */
export const CHART_REGISTERABLES = [
  // Controllers: doughnut (dashboard spending), line (spending analysis,
  // forecast), bar (monthly comparison).
  DoughnutController,
  LineController,
  BarController,
  ArcElement,
  LineElement,
  PointElement,
  BarElement,
  // Category on every x axis, linear on every y — including the second
  // right-hand axis the savings-rate series adds.
  CategoryScale,
  LinearScale,
  Legend,
  Tooltip,
  // Required by the `fill: true` datasets in spending analysis.
  Filler,
];

/**
 * Providing this — rather than a spec-local registry — is what keeps a spec
 * from passing against a wider set of pieces than production ships.
 */
export function provideAppCharts() {
  return provideCharts({ registerables: CHART_REGISTERABLES });
}
