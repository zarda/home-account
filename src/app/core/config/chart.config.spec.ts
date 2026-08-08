import { CHART_REGISTERABLES } from './chart.config';

/**
 * The explicit registerables list trades bundle size for a maintenance
 * hazard: a chart type added later without its pieces breaks at render
 * time, and a missing Filler breaks nothing a canvas-exists assertion would
 * notice — the shading under an area chart just stops being drawn.
 *
 * These specs read the list rather than Chart's registry on purpose. The
 * registry is global and is written by whichever chart spec ran first, so
 * asserting against it would pass or fail on suite ordering. That the list
 * is actually wired up is proven where it matters, by the specs that render
 * a real chart (spending-chart, spending-analysis, forecast) and by the
 * route smoke.
 */
describe('CHART_REGISTERABLES', () => {
  const ids = CHART_REGISTERABLES.map(piece => (piece as { id: string }).id);

  it('names every controller, scale and element the app charts use', () => {
    // doughnut: dashboard spending. line: spending analysis, forecast.
    // bar: monthly comparison. Each needs its element; every axis is a
    // category x against a linear y.
    expect(ids).toEqual(
      jasmine.arrayContaining([
        'doughnut',
        'line',
        'bar',
        'arc',
        'point',
        'category',
        'linear',
      ])
    );
  });

  it('keeps the filler plugin so area charts shade', () => {
    // spending-analysis draws its income and expense series with fill: true.
    expect(ids).toContain('filler');
  });

  it('keeps the legend and tooltip plugins the charts configure', () => {
    expect(ids).toEqual(jasmine.arrayContaining(['legend', 'tooltip']));
  });

  it('leaves out the chart types the app never draws', () => {
    // The whole point of the list: these are what the default registry
    // carried into the initial bundle.
    for (const unused of ['polarArea', 'radar', 'bubble', 'scatter', 'radialLinear']) {
      expect(ids).not.toContain(unused);
    }
  });
});
