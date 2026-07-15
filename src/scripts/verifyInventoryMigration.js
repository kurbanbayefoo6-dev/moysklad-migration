import { pathToFileURL } from 'node:url'

import { inventoryMapper } from '../mappers/inventoryMapper.js'
import { inventoryRepository } from '../repositories/inventoryRepository.js'
import { withApiRetries } from '../utils/apiRetry.js'

function getRows(value) {
	if (Array.isArray(value)) {
		return value
	}

	if (Array.isArray(value?.rows)) {
		return value.rows
	}

	return []
}

function getDocumentNumber(document) {
	return document?.name || document?.number || document?.code || document?.id || ''
}

function normalizeString(value) {
	return String(value ?? '').trim()
}

function normalizeNumber(value) {
	const number = Number(value ?? 0)
	return Number.isFinite(number) ? Math.round(number * 1000000) / 1000000 : 0
}

function normalizeHref(href) {
	return String(href || '').split('?')[0]
}

function getHref(reference) {
	return normalizeHref(reference?.meta?.href || reference?.href || '')
}

function getReferenceId(reference) {
	return getHref(reference).split('/').filter(Boolean).at(-1) || ''
}

function getReferenceKey(reference) {
	return getReferenceId(reference) || getHref(reference)
}

function buildPositionIdentity(position) {
	return [
		getReferenceKey(position?.assortment),
		normalizeNumber(position?.quantity),
	].join('~')
}

function buildInventoryBusinessIdentity(inventory) {
	return {
		moment: normalizeString(inventory?.moment),
		applicable: String(Boolean(inventory?.applicable)),
		store: getReferenceKey(inventory?.store),
		positions: getRows(inventory?.positions)
			.map(buildPositionIdentity)
			.sort()
			.join('||'),
	}
}

function buildInventoryBusinessIdentityKey(inventory) {
	const identity = buildInventoryBusinessIdentity(inventory)
	return [
		identity.moment,
		identity.applicable,
		identity.store,
		identity.positions,
	].join('|')
}

function compareInventory(expected, actual) {
	const expectedIdentity = buildInventoryBusinessIdentity(expected)
	const actualIdentity = buildInventoryBusinessIdentity(actual)

	return Object.keys(expectedIdentity)
		.filter(field => expectedIdentity[field] !== actualIdentity[field])
		.map(field => ({
			field,
			expected: expectedIdentity[field],
			actual: actualIdentity[field],
		}))
}

async function loadOldDetails(summaries) {
	const details = []
	for (const summary of summaries) {
		details.push(
			await withApiRetries(
				() => inventoryRepository.findById(summary.id, { client: 'old' }),
				`GET OLD ${inventoryRepository.endpoint}/${summary.id}`,
			),
		)
	}
	return details
}

export async function verifyInventoryMigration() {
	const [oldSummaries, newInventories] = await Promise.all([
		withApiRetries(
			() => inventoryRepository.findAll({ client: 'old' }),
			'GET OLD Inventory',
		),
		withApiRetries(
			() =>
				inventoryRepository.findAll({
					client: 'new',
					params: {
						expand:
							'organization,store,positions.assortment,state,project,owner,group',
					},
				}),
			'GET NEW Inventory',
		),
	])
	const oldInventories = await loadOldDetails(oldSummaries)
	const newByExternalCode = new Map(
		newInventories
			.filter(inventory => inventory.externalCode)
			.map(inventory => [inventory.externalCode, inventory]),
	)
	const stats = {
		matched: 0,
		missing: [],
		different: [],
	}

	for (const oldInventory of oldInventories) {
		const expected = await withApiRetries(
			() => inventoryMapper.map(oldInventory),
			`map Inventory ${getDocumentNumber(oldInventory)}`,
		)
		const expectedIdentity = buildInventoryBusinessIdentityKey(expected)
		const newInventory =
			newByExternalCode.get(oldInventory.externalCode) ||
			newInventories.find(
				inventory =>
					buildInventoryBusinessIdentityKey(inventory) === expectedIdentity,
			)
		if (!newInventory) {
			stats.missing.push({
				number: getDocumentNumber(oldInventory),
				id: oldInventory.id,
			})
			continue
		}

		const detailedNewInventory = await withApiRetries(
			() => inventoryRepository.findById(newInventory.id, { client: 'new' }),
			`GET NEW ${inventoryRepository.endpoint}/${newInventory.id}`,
		)
		const differences = compareInventory(expected, detailedNewInventory)

		if (differences.length) {
			stats.different.push({
				number: getDocumentNumber(oldInventory),
				id: oldInventory.id,
				differences,
			})
		} else {
			stats.matched += 1
		}
	}

	const migrationSafe =
		stats.missing.length === 0 && stats.different.length === 0

	console.log('Inventory')
	console.log(`Matched: ${stats.matched}`)
	console.log(`Missing: ${stats.missing.length}`)
	console.log(`Different: ${stats.different.length}`)
	console.log(`Migration Safe: ${migrationSafe ? 'YES' : 'NO'}`)

	return {
		...stats,
		migrationSafe,
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	verifyInventoryMigration().catch(error => {
		console.log('Inventory verification failed')
		console.log(error?.message || 'Unknown error')
		process.exitCode = 1
	})
}

export default verifyInventoryMigration
