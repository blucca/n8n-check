// An observed relation for declared independent records, not a business oracle.
// Compare JSON rows as a multiset: object key order is irrelevant; array order
// and repeated rows remain significant. Projection is explicit, top-level only.
export function canonical(value) {
  return JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.keys(v).sort().map(key => [key, v[key]])) : v);
}

export function compareRows(batch, parts, fields) {
  const project = row => {
    if (!fields) return row;
    return Object.fromEntries(fields.map(field => {
      if (!Object.hasOwn(row, field)) throw new Error(`Missing selected field: ${field}`);
      return [field, row[field]];
    }));
  };
  const bag = rows => {
    const counts = new Map();
    for (const row of rows) {
      const key = canonical(project(row));
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  };
  const a = bag(batch), b = bag(parts.flat());
  const differences = [...new Set([...a.keys(), ...b.keys()])].sort().flatMap(key => {
    const batchCount = a.get(key) ?? 0, partitionCount = b.get(key) ?? 0;
    return batchCount === partitionCount ? [] : [{ row: JSON.parse(key), batchCount, partitionCount }];
  });
  return { consistent: differences.length === 0, batchCount: batch.length,
    partitionCount: parts.flat().length, fields: fields ?? null, differences };
}
