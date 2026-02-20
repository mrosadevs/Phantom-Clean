# Phantom Cleaner

Single-page web app to clean raw bank transaction CSVs and export a formatted Excel file.

## Features

- Drag-and-drop CSV upload (`Date`, `amount`, `memo` columns).
- Supports uploading multiple CSV files and merges rows.
- Cleans memo values with the requested rule order.
- Preview table with editable clean names before export.
- Custom mapping table (`from -> to`) stored in `localStorage`.
- Excel export formatting:
  - Columns: `Date | clean transactions | amount | orginal transactons`
  - Widths: `14 | 45 | 14 | 90`
  - Arial 10, bold header row
  - Amount number format: `#,##0.00`
  - Auto-filter on all columns
  - Top row frozen

## Run

1. From this folder, start a local server:

```bash
python3 -m http.server 8080
```

2. Open:

```text
http://localhost:8080
```

3. Upload CSV file(s), review/edit clean names, then click **Download Excel**.
