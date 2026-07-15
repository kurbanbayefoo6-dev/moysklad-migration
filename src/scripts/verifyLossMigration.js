import { pathToFileURL } from 'node:url'

import { lossMapper } from '../mappers/lossMapper.js'
import { lossRepository } from '../repositories/lossRepository.js'
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

function buildLossBusinessIdentity(loss) {
	return {
		moment: normalizeString(loss?.moment),
		applicable: String(Boolean(loss?.applicable)),
		store: getReferenceKey(loss?.store),
		positions: getRows(loss?.positions).map(buildPositionIdentity).sort().join('||'),
	}
}

function buildLossBusinessIdentityKey(loss) {
	const identity = buildLossBusinessIdentity(loss)
	return [
		identity.moment,
		identity.applicable,
		identity.store,
		identity.positions,
	].join('|')
}

function compareLoss(expected, actual) {
	const expectedIdentity = buildLossBusinessIdentity(expected)
	const actualIdentity = buildLossBusinessIdentity(actual)

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
				() => lossRepository.findById(summary.id, { client: 'old' }),
				`GET OLD ${lossRepository.endpoint}/${summary.id}`,
			),
		)
	}
	return details
}

export async function verifyLossMigration() {
	const [oldSummaries, newLosses] = await Promise.all([
		withApiRetries(
			() => lossRepository.findAll({ client: 'old' }),
			'GET OLD Loss',
		),
		withApiRetries(
			() =>
				lossRepository.findAll({
					client: 'new',
					params: {
						expand:
							'organization,store,positions.assortment,state,project,owner,group',
					},
				}),
			'GET NEW Loss',
		),
	])
	const oldLosses = await loadOldDetails(oldSummaries)
	const newByExternalCode = new Map(
		newLosses
			.filter(loss => loss.externalCode)
			.map(loss => [loss.externalCode, loss]),
	)
	const stats = {
		matched: 0,
		missing: [],
		different: [],
	}

	for (const oldLoss of oldLosses) {
		const expected = await withApiRetries(
			() => lossMapper.map(oldLoss),
			`map Loss ${getDocumentNumber(oldLoss)}`,
		)
		const expectedIdentity = buildLossBusinessIdentityKey(expected)
		const newLoss =
			newByExternalCode.get(oldLoss.externalCode) ||
			newLosses.find(
				loss => buildLossBusinessIdentityKey(loss) === expectedIdentity,
			)
		if (!newLoss) {
			stats.missing.push({
				number: getDocumentNumber(oldLoss),
				id: oldLoss.id,
			})
			continue
		}

		const detailedNewLoss = await withApiRetries(
			() => lossRepository.findById(newLoss.id, { client: 'new' }),
			`GET NEW ${lossRepository.endpoint}/${newLoss.id}`,
		)
		const differences = compareLoss(expected, detailedNewLoss)

		if (differences.length) {
			stats.different.push({
				number: getDocumentNumber(oldLoss),
				id: oldLoss.id,
				differences,
			})
		} else {
			stats.matched += 1
		}
	}

	const migrationSafe =
		stats.missing.length === 0 && stats.different.length === 0

	console.log('Loss')
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
	verifyLossMigration().catch(error => {
		console.log('Loss verification failed')
		console.log(error?.message || 'Unknown error')
		process.exitCode = 1
	})
}

export default verifyLossMigration
