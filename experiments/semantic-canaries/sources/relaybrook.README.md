# Lead list cleaner

Clean and deduplicate a lead list from Google Sheets or a CSV file, with no AI and no paid APIs. Fixes name casing, repairs common email typos, flags free-mail, role and disposable addresses, finds the company domain and merges duplicate people. Each row is marked `ready` or `review`.

## What it does

1. **Cleaner settings** picks the source (`sample`, `csv` or `google_sheets`) and holds file paths, the sheet URL, tab names and options.
2. **Read leads**: a CSV file is read and parsed with a header row, Google Sheets rows are read from your input tab, or **Sample messy leads** supplies 12 test rows.
3. **Normalize and validate leads** (plain JavaScript):
   - Maps common column names (`Full Name`, `E-mail`, `Email Address`, `Organization`, `Company URL`…) to one schema. Columns it doesn't know are kept.
   - Fixes name casing (`JOHN SMITH` → `John Smith`, `mary o'brien` → `Mary O'Brien`, `van der Berg`, `McDonald`), drops titles like `Dr.` and splits full names into first and last.
   - Cleans emails (`mailto:`, spaces, trailing `;`), fixes common domain typos (`gmial.com`, `hotmial.com`, `yahoo.con`…), checks syntax and classifies each address as business, free-mail, role (`info@`, `sales@`) or disposable.
   - Takes the company domain from the website column, or from a business email when there is no website.
4. **Merge duplicate leads** groups rows that are the same person: same mailbox (case, `+tags` and Gmail dots ignored), or same name plus company domain or company name. The first row wins and empty fields are filled from its duplicates. Each row gets `lead_status`, readable `issues` and `fixes`, `merged_rows`, `other_emails` and a stable `dedupe_key`.
5. **Write results**: CSV mode writes a cleaned CSV (overwritten each run). Google Sheets mode upserts into your output tab on `dedupe_key`, so re-runs update rows instead of adding duplicates. Sample mode shows the result in **Preview cleaned leads**.
6. **Summarize cleaning run** returns one item with counts: rows in and out, duplicates merged, ready vs review, email types and emails auto-fixed.

## Setup

1. Import `workflow.json` into n8n.
2. **CSV:** in **Cleaner settings** set `source = csv`, `csv_input_path` and `csv_output_path`. The folder must be readable and writable by n8n. On n8n 2.x the default allowed folder is `~/.n8n-files` (`/home/node/.n8n-files` in Docker); other folders need the `N8N_RESTRICT_FILE_ACCESS_TO` environment variable.
3. **Google Sheets:** set `source = google_sheets`, paste the sheet URL into `google_sheet_url`, set `input_tab` and `output_tab`, create the empty output tab, and select a Google Sheets OAuth2 credential in both Google Sheets nodes.
4. Click **Execute workflow**.

## Test mode

The workflow ships with `source = sample`. Click **Execute workflow** right after import: 12 synthetic messy rows go in, 9 cleaned rows come out (3 duplicates merged), and the summary shows the counts. No credentials needed.

## Limitations

- Rule-based only. It checks email syntax and known domain lists; it does not check whether a mailbox actually exists.
- Duplicate matching is deliberately conservative (same mailbox, or same name plus same company). Different spellings of a company name may not merge.
- If the CSV file is missing, n8n stops with "No file(s) found". A file or sheet with headers but no rows stops with "No lead rows found".
- Sample, CSV and error paths were tested end to end on self-hosted n8n 2.47.7. The Google Sheets read and upsert nodes are configured but have not been tested against a real sheet yet.
