import { useMemo } from 'react'
import { defineChart, lineY } from '@tanstack/charts'
import { Chart } from '@tanstack/charts/react'
import { scaleLinear } from '@tanstack/charts/scales/linear'
import { tooltip } from '@tanstack/charts/tooltip'
export interface Point {
  time: number
  value: number | null
}
export function Trend({
  points,
  label,
  unit,
  compact = false,
  gapMs = 20000,
  showDate = false,
}: {
  points: Point[]
  label: string
  unit: string
  compact?: boolean
  gapMs?: number
  showDate?: boolean
}) {
  const definition = useMemo(() => {
    const data: Point[] = []
    for (const point of points) {
      const previous = data.at(-1)
      if (previous && point.time - previous.time > gapMs)
        data.push({ time: previous.time + 1, value: null })
      data.push(point)
    }
    return defineChart({
      marks: [lineY(data, { x: 'time', y: 'value', stroke: '#ff9a62', strokeWidth: 1.5 })],
      scales: {
        x: {
          scale: scaleLinear,
          axis: compact
            ? false
            : {
                ticks: {
                  count: 3,
                  format: (value) =>
                    showDate
                      ? new Date(value).toLocaleString([], {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })
                      : new Date(value).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        }),
                },
              },
        },
        y: {
          scale: () =>
            scaleLinear().domain([0, Math.max(1, ...data.map((p) => p.value ?? 0)) * 1.1]),
          grid: !compact,
          axis: compact ? false : { ticks: { count: 3 } },
        },
      },
      theme: {
        foreground: 'light-dark(#52525b,#a1a1aa)',
        muted: 'light-dark(#52525b,#81818b)',
        grid: 'light-dark(#e4e4e7,#29292f)',
        background: 'transparent',
      },
      focus: 'nearest-x',
      maxFocusDistance: Number.POSITIVE_INFINITY,
      tooltip: {
        use: tooltip,
        className: 'metric-tooltip',
        format: (p) =>
          `${showDate ? new Date(p.datum.time).toLocaleString() : new Date(p.datum.time).toLocaleTimeString()}\n${label}: ${p.datum.value == null ? 'Unavailable' : p.datum.value.toLocaleString(undefined, { maximumFractionDigits: 2 }) + ' ' + unit}`,
      },
    })
  }, [points, label, unit, compact, gapMs, showDate])
  return (
    <Chart definition={definition} height={compact ? 36 : 150} ariaLabel={label + ' history'} />
  )
}
