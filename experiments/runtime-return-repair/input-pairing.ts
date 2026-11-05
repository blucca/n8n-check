// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Blucca
import type { IPairedItemData, IRunExecutionData } from 'n8n-workflow';

export interface InputPairingCoordinate {
	node: string;
	run: number;
	output: number;
	item: number;
}

/** Resolve one actual terminal item to the child workflow's input item indices. */
export function resolveInputPairing(
	runData: IRunExecutionData,
	start: InputPairingCoordinate,
): IPairedItemData | IPairedItemData[] | undefined {
	const runs = runData?.resultData?.runData;
	const active = new Set<string>();
	const memo = new Map<string, IPairedItemData[] | undefined>();
	const validIndex = (value: number) => Number.isInteger(value) && value >= 0;

	function visit(coordinate: InputPairingCoordinate): IPairedItemData[] | undefined {
		const { node, run, output, item } = coordinate;
		if (!node || ![run, output, item].every(validIndex)) return undefined;
		const key = JSON.stringify([node, run, output, item]);
		if (memo.has(key)) return memo.get(key);
		if (active.has(key)) return undefined;
		const task = runs?.[node]?.[run];
		const current = task?.data?.main?.[output]?.[item];
		if (!task || current?.pairedItem === undefined) return undefined;
		const entries = Array.isArray(current.pairedItem) ? current.pairedItem : [current.pairedItem];
		if (entries.length === 0) return undefined;
		const roots = new Map<number, IPairedItemData>();
		active.add(key);
		try {
			for (const entry of entries) {
				const pair = typeof entry === 'number' ? { item: entry } : entry;
				if (!pair || !validIndex(pair.item)) return undefined;
				const input = pair.input ?? 0;
				if (!validIndex(input)) return undefined;
				if (task.source?.length === 0 && !pair.sourceOverwrite) {
					// The trigger's local pairing remains the input anchor, even in each mode.
					roots.set(pair.item, { item: pair.item });
					continue;
				}
				const source = pair.sourceOverwrite ?? task.source?.[input];
				if (!source?.previousNode) return undefined;
				const found = visit({
					node: source.previousNode,
					run: source.previousNodeRun ?? 0,
					output: source.previousNodeOutput ?? 0,
					item: pair.item,
				});
				if (!found) return undefined;
				for (const root of found) roots.set(root.item, root);
			}
			const found = [...roots.values()];
			memo.set(key, found);
			return found;
		} finally {
			active.delete(key);
		}
	}

	const roots = visit(start);
	return roots?.length === 1 ? roots[0] : roots;
}
