import type { Row, Field } from './database-inspection-types'
import { useMemo } from 'react'

import { Link } from '@tanstack/react-router'
import { tableFeatures, useTable, type ColumnDef } from '@tanstack/react-table'

export function DataTable({
  title,
  data,
  fields,
  empty,
  serviceId,
}: {
  title: string
  data: Row[]
  fields: Field[]
  empty: string
  serviceId?: string
}) {
  const columns = useMemo<ColumnDef<typeof features, Row>[]>(
    () =>
      fields.map((f) => ({
        accessorKey: f.key,
        header: f.label,
        // oxlint-disable-next-line react-doctor/no-unstable-nested-components -- TanStack cell renderer is cached by useMemo until its column definition changes.
        cell: ({ row }) =>
          serviceId && f.key === 'name' ? (
            <Link
              className="text-orange-300 underline-offset-4 hover:underline"
              to="/services/$serviceId/overview"
              params={{ serviceId }}
              search={{ table: Number(row.original.id) }}
              resetScroll={false}
            >
              {String(row.original.name)}
            </Link>
          ) : f.format ? (
            f.format(row.original[f.key])
          ) : typeof row.original[f.key] === 'boolean' ? (
            row.original[f.key] ? (
              'Yes'
            ) : (
              'No'
            )
          ) : (
            String(row.original[f.key] ?? '—')
          ),
      })),
    [fields, serviceId],
  )
  const table = useTable({ key: title, features, data, columns })
  return (
    <section className="panel min-w-0 overflow-hidden [background:light-dark(#f4f4f5,_#131315)] [border:1px_solid_light-dark(#e4e4e7,_#28282c)] [border-radius:8px] [box-shadow:0_1px_0_#ffffff04_inset,_0_8px_24px_#0000000d]">
      <h3 className="border-b border-zinc-800 px-5 py-4 text-sm font-medium">{title}</h3>
      <div
        className="max-h-[32rem] overflow-auto"
        role="region"
        aria-label={`${title}, scroll for more columns`}
        // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Keyboard users must be able to scroll this overflow region.
        tabIndex={0}
      >
        <table
          className="w-full min-w-[600px] border-collapse text-left text-xs"
          aria-label={title}
        >
          <thead className="sticky top-0 bg-[light-dark(#f4f4f5,#171719)] text-muted">
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id}>
                {group.headers.map((header) => (
                  // oxlint-disable-next-line react-doctor/control-has-associated-label -- TanStack FlexRender supplies cell content; cells are not interactive controls.
                  <th key={header.id} scope="col" className="px-5 py-3 font-medium">
                    <table.FlexRender header={header} />
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id} className="border-t border-zinc-800/70">
                {row.getAllCells().map((cell) => (
                  // oxlint-disable-next-line react-doctor/control-has-associated-label -- TanStack FlexRender supplies cell content; cells are not interactive controls.
                  <td key={cell.id} className="max-w-80 break-words px-5 py-3 tabular-nums">
                    <table.FlexRender cell={cell} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.length === 0 && <p className="p-5 text-xs text-muted">{empty}</p>}
    </section>
  )
}

const features = tableFeatures({})
