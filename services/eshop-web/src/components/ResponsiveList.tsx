import { useSyncExternalStore, type Key, type ReactNode } from 'react'
import { Link } from 'react-router'

/** The desktop breakpoint from src/index.css: tables from here, cards below. */
const DESKTOP = '(min-width: 1280px)'

/** One column of a ResponsiveList. */
export type ListColumn<Row> = {
  /** The column header on desktop, and the label beside the value on each phone card. */
  label: string
  /** The cell's content for one row. */
  cell: (row: Row) => ReactNode
  /** Right-align on desktop (amounts, counts). */
  align?: 'end'
  /** On a phone card, put the value under its label instead of beside it (a form, long text). */
  block?: boolean
}

export type ResponsiveListProps<Row> = {
  /** The list's accessible name (usually the page heading): names the table, or the list of cards. */
  label: string
  /** The first column identifies the row: a row header on desktop, the top line of each card on a phone. */
  columns: readonly [ListColumn<Row>, ...ListColumn<Row>[]]
  rows: readonly Row[]
  rowKey: (row: Row) => Key
  /** Where the row leads, if anywhere: the first column's content becomes a link there. */
  rowLink?: (row: Row) => string
  /** Rows shown dimmed (e.g. retired); say why in a column too, since dimming alone is not announced. */
  dimmed?: (row: Row) => boolean
}

function subscribe(onChange: () => void) {
  const query = window.matchMedia(DESKTOP)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

/** True from the desktop breakpoint, following the window as it is resized or zoomed. */
function useDesktop(): boolean {
  return useSyncExternalStore(subscribe, () => window.matchMedia(DESKTOP).matches)
}

/**
 * The shared "table on desktop, stacked cards on phone" list (spec #46). Desktop gets a real table (column
 * headers, the first column as row headers); below 1280px each row is a card (a list item holding a description
 * list), so every value keeps its column label on screen and for screen readers. Only one of the two is rendered.
 */
export function ResponsiveList<Row>({ label, columns, rows, rowKey, rowLink, dimmed }: ResponsiveListProps<Row>) {
  const desktop = useDesktop()

  const content = (column: ListColumn<Row>, index: number, row: Row) => {
    const value = column.cell(row)
    return index === 0 && rowLink ? <Link to={rowLink(row)}>{value}</Link> : value
  }

  if (desktop) {
    return (
      <table className="list-table" aria-label={label}>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.label} scope="col" className={column.align === 'end' ? 'align-end' : undefined}>
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)} className={dimmed?.(row) ? 'dimmed' : undefined}>
              {columns.map((column, index) => {
                const className = column.align === 'end' ? 'align-end' : undefined
                return index === 0 ? (
                  <th key={column.label} scope="row" className={className}>
                    {content(column, index, row)}
                  </th>
                ) : (
                  <td key={column.label} className={className}>
                    {content(column, index, row)}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    )
  }

  return (
    // role="list": Safari drops list semantics from a list styled without bullets.
    <ul className="list-cards" role="list" aria-label={label}>
      {rows.map((row) => (
        <li key={rowKey(row)} className={dimmed?.(row) ? 'list-card dimmed' : 'list-card'}>
          <dl>
            {columns.map((column, index) => (
              <div key={column.label} className={column.block ? 'list-field block' : 'list-field'}>
                <dt>{column.label}</dt>
                <dd>{content(column, index, row)}</dd>
              </div>
            ))}
          </dl>
        </li>
      ))}
    </ul>
  )
}
