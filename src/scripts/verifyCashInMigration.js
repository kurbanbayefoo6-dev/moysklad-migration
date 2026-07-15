import { pathToFileURL } from 'node:url'

import { newClient } from '../api/newClient.js'
import { oldClient } from '../api/oldClient.js'
import { cashInRepository } from '../repositories/cashInRepository.js'
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

function getEntityId(entity) {
	return (
		entity?.id ||
		entity?.meta?.href?.split('/').filter(Boolean).at(-1) ||
		entity?.href?.split('/').filter(Boolean).at(-1) ||
		''
	)
}

function getDocumentNumber(document) {
	return document?.name || document?.number || document?.code || document?.id || ''
}

function getOperationMeta(operation) {
	return operation?.meta || operation?.operation?.meta || null
}

function normalizeNumber(value) {
	const number = Number(value ?? 0)
	return Number.isFinite(number) ? Math.round(number * 1000000) / 1000000 : 0
}

function getRelativeApiPath(href) {
	const marker = '/api/remap/1.2/'
	const index = href?.indexOf(marker) ?? -1
	return index >= 0 ? href.slice(index + marker.length) : href
}

function getEndpoint(type) {
	return type ? `entity/${type}` : ''
}

async function loadOldDetails(summaries) {
	const details = []
	for (const summary of summaries) {
		details.push(
			await withApiRetries(
				() => cashInRepository.findById(summary.id, { client: 'old' }),
				`GET OLD ${cashInRepository.endpoint}/${summary.id}`,
			),
		)
	}
	return details
}

async function findNewOperationTarget(oldOperation) {
	const meta = getOperationMeta(oldOperation)
	if (!meta?.href || !meta?.type) {
		return null
	}

	const oldTarget = await withApiRetries(
		() => oldClient.get(getRelativeApiPath(meta.href)),
		`GET OLD operation ${meta.href}`,
	)
	if (!oldTarget?.externalCode) {
		return null
	}

	const response = await withApiRetries(
		() =>
			newClient.get(getEndpoint(meta.type), {
				params: {
					filter: `externalCode=${oldTarget.externalCode}`,
					limit: 10,
					offset: 0,
				},
			}),
		`GET NEW ${meta.type} by externalCode`,
	)
	return getRows(response)[0] || null
}

async function compareOperations(oldCashIn, newCashIn) {
	const differences = []
	const newOperations = getRows(newCashIn?.operations)

	for (const oldOperation of getRows(oldCashIn?.operations)) {
		const oldMeta = getOperationMeta(oldOperation)
		const newTarget = await findNewOperationTarget(oldOperation)
		const newHref = newTarget?.meta?.href
		const matched = newOperations.some(newOperation => {
			const newMeta = getOperationMeta(newOperation)
			return (
				newMeta?.type === oldMeta?.type &&
				newMeta?.href === newHref &&
				normalizeNumber(newOperation.linkedSum) ===
					normalizeNumber(oldOperation.linkedSum)
			)
		})

		if (!matched) {
			differences.push({
				field: 'operations',
				old: {
					type: oldMeta?.type,
					id: getEntityId({ meta: oldMeta }),
					linkedSum: oldOperation.linkedSum,
				},
				new: 'missing',
			})
		}
	}

	return differences
}

function compareScalarFields(oldCashIn, newCashIn) {
	const fields = ['externalCode', 'moment', 'applicable', 'description', 'paymentPurpose', 'sum']
	const differences = []

	for (const field of fields) {
		if ((oldCashIn?.[field] ?? null) !== (newCashIn?.[field] ?? null)) {
			differences.push({
				field,
				old: oldCashIn?.[field] ?? null,
				new: newCashIn?.[field] ?? null,
			})
		}
	}

	return differences
}

export async function verifyCashInMigration() {
	const [oldSummaries, newCashIns] = await Promise.all([
		withApiRetries(
			() => cashInRepository.findAll({ client: 'old' }),
			'GET OLD CashIn',
		),
		withApiRetries(
			() => cashInRepository.findAll({ client: 'new' }),
			'GET NEW CashIn',
		),
	])
	const oldCashIns = await loadOldDetails(oldSummaries)
	const newByExternalCode = new Map(
		newCashIns
			.filter(cashIn => cashIn.externalCode)
			.map(cashIn => [cashIn.externalCode, cashIn]),
	)
	const stats = {
		matched: 0,
		missing: [],
		different: [],
	}

	for (const oldCashIn of oldCashIns) {
		const newCashIn = newByExternalCode.get(oldCashIn.externalCode)
		if (!newCashIn) {
			stats.missing.push({
				number: getDocumentNumber(oldCashIn),
				id: oldCashIn.id,
			})
			continue
		}

		const detailedNewCashIn = await withApiRetries(
			() => cashInRepository.findById(newCashIn.id, { client: 'new' }),
			`GET NEW ${cashInRepository.endpoint}/${newCashIn.id}`,
		)
		const differences = [
			...compareScalarFields(oldCashIn, detailedNewCashIn),
			...(await compareOperations(oldCashIn, detailedNewCashIn)),
		]

		if (differences.length) {
			stats.different.push({
				number: getDocumentNumber(oldCashIn),
				id: oldCashIn.id,
				differences,
			})
		} else {
			stats.matched += 1
		}
	}

	const migrationSafe =
		stats.missing.length === 0 && stats.different.length === 0

	console.log('CashIn')
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
	verifyCashInMigration().catch(error => {
		console.log('CashIn verification failed')
		console.log(error?.message || 'Unknown error')
		process.exitCode = 1
	})
}

export default verifyCashInMigration
