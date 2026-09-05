'use client';

import React, { useEffect, useRef } from 'react';
// Direct d3 submodules (v0.12.13): the umbrella `d3` package shipped ~260KB
// for three symbols. These five subpackages are the full surface used here —
// `d3-transition` is imported for its side effect (patches selection with
// .transition()).
import { select } from 'd3-selection';
import { scaleOrdinal } from 'd3-scale';
import { schemeSet3 } from 'd3-scale-chromatic';
import { arc, pie, type PieArcDatum } from 'd3-shape';
import 'd3-transition';
import { t } from '@/lib/i18n';

interface ChunksDistributionChartProps {
  data: { name: string; count: number }[];
  lang: 'ar' | 'en';
}

export default function ChunksDistributionChart({ data, lang }: ChunksDistributionChartProps) {
  const chartRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!chartRef.current || !data || data.length === 0) return;

    // Clear previous chart
    select(chartRef.current).selectAll('*').remove();

    const width = 400;
    const height = 300;
    const margin = 40;
    const radius = Math.min(width, height) / 2 - margin;

    const svg = select(chartRef.current)
      .append('svg')
      .attr('width', '100%')
      .attr('height', height)
      .attr('viewBox', `0 0 ${width} ${height}`)
      .append('g')
      .attr('transform', `translate(${width / 2},${height / 2})`);

    // Define color scale
    const color = scaleOrdinal<string>()
      .domain(data.map((d) => d.name))
      .range(schemeSet3);

    // Compute the position of each group on the pie
    const pieLayout = pie<{ name: string; count: number }>()
      .value((d) => d.count)
      .sort(null);

    const data_ready = pieLayout(data);

    // Shape helper to build arcs
    const arcGenerator = arc<PieArcDatum<{ name: string; count: number }>>()
      .innerRadius(radius * 0.5) // This makes it a donut chart
      .outerRadius(radius);

    // Hover arc generator
    const arcHover = arc<PieArcDatum<{ name: string; count: number }>>()
      .innerRadius(radius * 0.5)
      .outerRadius(radius + 10);

    // Build the pie chart
    svg
      .selectAll('mySlices')
      .data(data_ready)
      .enter()
      .append('path')
      .attr('d', arcGenerator)
      .attr('fill', (d) => color(d.data.name))
      .attr('stroke', 'white')
      .style('stroke-width', '2px')
      .style('opacity', 0.8)
      .style('transition', 'all 0.3s ease-in-out')
      .on('mouseover', function (event, d) {
        select(this)
          .transition()
          .duration(200)
          .attr('d', arcHover as any)
          .style('opacity', 1);

        // Tooltip or central text could be added here
      })
      .on('mouseout', function (event, d) {
        select(this)
          .transition()
          .duration(200)
          .attr('d', arcGenerator as any)
          .style('opacity', 0.8);
      });

    // Add labels
    const outerArc = arc<PieArcDatum<{ name: string; count: number }>>()
      .innerRadius(radius * 1.1)
      .outerRadius(radius * 1.1);

    svg
      .selectAll('allLabels')
      .data(data_ready)
      .enter()
      .append('text')
      .text((d) => d.data.name + ' (' + d.data.count + ')')
      .attr('transform', (d) => {
        const pos = outerArc.centroid(d);
        const midangle = d.startAngle + (d.endAngle - d.startAngle) / 2;
        pos[0] = radius * 1.05 * (midangle < Math.PI ? 1 : -1);
        return `translate(${pos})`;
      })
      .style('text-anchor', (d) => {
        const midangle = d.startAngle + (d.endAngle - d.startAngle) / 2;
        return midangle < Math.PI ? 'start' : 'end';
      })
      .style('font-size', '12px')
      .style('fill', '#475569')
      .style('font-weight', '500');

    // Add Polylines connecting slices to labels
    svg
      .selectAll('allPolylines')
      .data(data_ready)
      .enter()
      .append('polyline')
      .attr('stroke', '#cbd5e1')
      .style('fill', 'none')
      .attr('stroke-width', 1)
      .attr('points', (d) => {
        const posA = arcGenerator.centroid(d); // line insertion in the slice
        const posB = outerArc.centroid(d); // line break: we use the other arc generator that has been built only for that
        const posC = outerArc.centroid(d); // Label position
        const midangle = d.startAngle + (d.endAngle - d.startAngle) / 2;
        posC[0] = radius * 1.0 * (midangle < Math.PI ? 1 : -1); // multiply by 1 or -1 to put it on the right or left
        return [posA, posB, posC] as any;
      });
  }, [data, lang]);

  return (
    <div className="w-full flex flex-col items-center justify-center p-4 bg-white rounded-xl shadow-sm border border-slate-200">
      <h4 className="text-sm font-semibold text-slate-800 mb-4 self-start">{t(lang, 'chunksChart.title')}</h4>
      {data && data.length > 0 ? (
        <div ref={chartRef} className="w-full flex justify-center" />
      ) : (
        <div className="h-[300px] flex items-center justify-center text-slate-400 text-sm">
          {t(lang, 'chunksChart.noData')}
        </div>
      )}
    </div>
  );
}
