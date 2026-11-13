# A repair needs the original encoding history

The n8n HTTP case above records **known corruption**: `Küçük` became
`K眉莽眉k`. [Leadflow's free browser CSV cleaner](https://fejzadenis.github.io/leadflow/studio.html)
restored that value in our actual browser run. One healthy UTF-8 control also
exposed a false positive.

## Actual browser results — 13 November 2026

The served `studio.html` matched source commit
[`c8dca157ce6254612bce784d629be49a23d1c9e7`](https://github.com/fejzadenis/leadflow/blob/c8dca157ce6254612bce784d629be49a23d1c9e7/studio.html#L338-L389)
byte for byte. Chrome 154 read our synthetic CSVs; we clicked **Clean & build
the files** and downloaded the cleaned CSV and row report.

| Input name | Expected name | Downloaded name | Result |
|---|---|---|---|
| `Demo K眉莽眉k` — known GB18030 damage | `Demo Küçük` | `Demo Küçük` | Restored |
| `示例 茅` — healthy UTF-8 | `示例 茅` | `示例 茅` | Preserved |
| `茅` — healthy UTF-8 Chinese surname | `茅` | `é` | **False positive** |

The last run reported one GB18030 cell repaired and zero rejected rows.
The reverse table accepts all non-ASCII characters in a cell before checking
that the reconstructed bytes decode as UTF-8. The additional Chinese characters
in the middle control keep that whole cell outside the reverse table.

The two histories meet at the same character:

```js
new TextDecoder('gb18030').decode(new TextEncoder().encode('é')) // '茅'
new TextDecoder('utf-8').decode(new TextEncoder().encode('茅'))  // '茅'
```

Use the original response bytes, charset and pre-damage value to establish
which history a cell followed. An explicit known-corruption mode or a confirmed
repair preview gives the user that choice before changing healthy text.

## Replay

1. Open the [browser cleaner](https://fejzadenis.github.io/leadflow/studio.html).
2. Paste [`known-damage-and-control.csv`](known-damage-and-control.csv), clean and download.
3. Paste [`healthy-surname.csv`](healthy-surname.csv), clean and download. The expected surname is `茅`.

[Recorded fields and settings](observed.json); the CSVs use fictional data and
example addresses. The characterisation check uses only Node.js:

```sh
node examples/http-utf8/recovery-provenance/verify.mjs
```

The report concerns the measured source revision. Node prevention remains
**Response Format → JSON**, followed by the complete exact-output regression
in the [parent case](../).
