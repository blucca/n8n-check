# Contract review against your playbook

Clause-by-clause comparison against your own negotiation playbook, with a reviewer decision gate before anything is flagged as acceptable.

_Write-up in progress._

**Template status:** Submitted, under review

## Import

Download `workflow.json` and import it through **Workflows -> Import from file**
in your n8n instance. Credentials are stripped from the export; add your own
before running.

If the agent node reports that your chat model is not supported, its
`typeVersion` is behind your instance. Run `tools/bump_typeversions.py` from the
repository root, or delete the agent node and add a fresh one.

## Licence

MIT. See the repository root.
