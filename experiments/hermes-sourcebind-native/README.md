# SourceBind: current-source identity at a native execution boundary

An offline, executable Hermes v0.23.0 checkpoint by Codex / Blucca.

Both fictional customer IDs are valid. Before binding, the backend accepts a
Northwind job with Contoso's ID. An explicit `/sourcebind` command ties the job
to its selected JSON source. The native `pre_tool_call` hook then checks the
actual arguments against the source **at execution time**.

## Native results

| Call | Result |
| --- | --- |
| Unbound Northwind job, valid Contoso ID | Backend updates `ct-91` |
| Bound job, Contoso ID | Blocked before the handler |
| Bound job, current Northwind ID | Backend updates `nw-41` |
| Different job with the correct Northwind ID | Blocked |
| Source changes to `nw-42`, old ID supplied | Blocked |
| Updated source, current ID supplied | Backend updates `nw-42` |
| Native delegated session, wrong / current ID | Blocked / accepted |
| Native rotating compaction, wrong / current ID | Blocked / accepted |
| Separate native agent with a parent reference | Retains its independent scope |

[Recorded result](native-result.json) includes the actual, fictional native
session IDs and the committed rotation. The plugin was loaded with Hermes's
real manifest parser and registries. Calls execute through the unpatched
`AIAgent` executor and native dispatcher.

## Stable scope through public events

The released v0.23.0 tool handler supplies `session_id`. This checkpoint joins
sessions using two documented, explicit lifecycle events:

- `subagent_start(parent_session_id, child_session_id)` inherits the binding.
- `post_compaction(old_session_id, session_id)` preserves it across rotation.

A parent reference alone leaves an independently created agent in its own
scope. The binding uses plugin-owned, profile-scoped `ctx.state`. It reads one
selected JSON file, protects one fixture tool and two fields (`job`,
`customer_id`), and supports one active binding per profile.

## Reproduce

From this repository root, with `uv`, git and Python available:

```sh
PROOF="$PWD/experiments/hermes-sourcebind-native"
LAB="$PWD/temp/sourcebind-native"
HERMES="$PWD/temp/hermes-v0.23.0"
mkdir -p "$LAB/home/plugins"
git clone --depth 1 --branch v0.23.0 https://github.com/NousResearch/hermes-agent.git "$HERMES"
(cd "$HERMES" && uv sync --locked --python 3.14 --no-dev)
cp -r "$PROOF/plugin" "$LAB/home/plugins/sourcebind-native-gate"
printf 'plugins:\n  enabled: [sourcebind-native-gate]\n' > "$LAB/home/config.yaml"
HERMES_HOME="$LAB/home" "$HERMES/.venv/bin/hermes" plugins doctor --ci "$PROOF/plugin"
HERMES_HOME="$LAB/home" PYTHONPATH="$HERMES" "$HERMES/.venv/bin/python" "$PROOF/native-check.py"
```

The fixture blocks the model boundary through `pre_llm_call`. The compression
check supplies a synthetic cached `PreparedSummary` to the native compressor;
Hermes then performs the real database commit, session rotation and event
publication. This measures execution contracts. Model task performance and a
production connector are separate stages.

## Installation disclosures

The checkpoint reads the user-selected local JSON path, stores the active
binding and fictional backend calls in Hermes's own plugin state, and
registers two tools, four hooks and one slash command. It has no plugin Python
dependencies, third-party network calls, shell calls or background jobs. The
reproduction harness imports native test seams to supply cached summary input;
the plugin itself uses public registration, state and callback surfaces.

MIT-licensed code. Official contracts at the tested release:
[plugin guide](https://github.com/NousResearch/hermes-agent/blob/v0.23.0/website/docs/developer-guide/plugins/index.md)
and [lifecycle hooks](https://github.com/NousResearch/hermes-agent/blob/v0.23.0/website/docs/user-guide/features/hooks.md).
