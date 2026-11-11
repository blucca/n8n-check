# First-case walkthrough

Recorded browser preparation and native CLI 0.1.8 / n8n 2.41.7 on 12 November 2026. Synthetic invoice fixtures, real execution reports, AI narration. The installed CLI uses host networking and records zero HTTP requests; the Docker pack is shown as handoff.

Pin input and result after a known-good run on your workflow. This example supplies synthetic invoice pins. Import the JSON, keep Read invoices as the fixture boundary, and select Prepare notification as the output. Slack remains in the slice.

Enable Stop after selected output. The fixture replaces the Sheets input; the real Code node runs, and this branch stops before Slack. Other reachable branches stay in the run. Review the two expected items, then download the local pack.

Unzip the pack. Docker users can run the included script. This replay uses its case with installed n8n and n8n-check zero point one point eight. The fixed Code keeps both invoices. A deliberate one-row regression fails the output check while n8n succeeds. Both runs save JSON and JUnit reports.
