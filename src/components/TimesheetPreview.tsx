/** The timesheet as it will appear in the PDF: same title, lines and table rows. */
import type { Table, Timesheet } from '../lib/timesheet';

export function TimesheetPreview({ sheet }: { sheet: Timesheet }) {
  return (
    <div className="space-y-4 rounded-sm bg-white p-4 text-black shadow-md" aria-label="Voorbeeld van de urenstaat">
      <div>
        <p className="text-xl font-bold">{sheet.title}</p>
        {sheet.lines.map((line) => (
          <p key={line} className="text-sm">
            {line}
          </p>
        ))}
      </div>
      <PreviewTable table={sheet.hours} alignLast="right" noWrap={[0, 1, 3]} />
      <PreviewTable table={sheet.tools} noWrap={[2]} />
    </div>
  );
}

/** noWrap: columns kept on one line (dates, job numbers, hours), so the address column does the wrapping. */
function PreviewTable({ table, alignLast, noWrap = [] }: { table: Table; alignLast?: 'right'; noWrap?: number[] }) {
  const cell = 'border border-black px-1 py-0.5 align-top break-words';
  const align = (index: number) =>
    `${alignLast && index === table.head.length - 1 ? 'text-right' : 'text-left'} ${noWrap.includes(index) ? 'whitespace-nowrap' : ''}`;
  return (
    <div>
      <p className="mb-1 text-base font-bold">{table.title}</p>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[12px] leading-snug">
          <thead>
            <tr>
              {table.head.map((heading, i) => (
                <th key={heading} className={`${cell} font-bold ${align(i)}`}>
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.length === 0 ? (
              <tr>
                <td className={cell} colSpan={table.head.length}>
                  {table.empty}
                </td>
              </tr>
            ) : (
              table.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((value, i) => (
                    <td key={i} className={`${cell} ${align(i)}`}>
                      {value}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
