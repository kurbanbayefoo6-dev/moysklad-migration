import { pathToFileURL } from 'node:url'

import { moveMapper } from '../mappers/moveMapper.js'
import { moveRepository } from '../repositories/moveRepository.js'
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

function buildMoveBusinessIdentity(move) {
	return {
		moment: normalizeString(move?.moment),
		applicable: String(Boolean(move?.applicable)),
		sourceStore: getReferenceKey(move?.sourceStore),
		targetStore: getReferenceKey(move?.targetStore),
		positions: getRows(move?.positions).map(buildPositionIdentity).sort().join('||'),
	}
}

function buildMoveBusinessIdentityKey(move) {
	const identity = buildMoveBusinessIdentity(move)
	return [
		identity.moment,
		identity.applicable,
		identity.sourceStore,
		identity.targetStore,
		identity.positions,
	].join('|')
}

function compareMove(expected, actual) {
	const expectedIdentity = buildMoveBusinessIdentity(expected)
	const actualIdentity = buildMoveBusinessIdentity(actual)

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
				() => moveRepository.findById(summary.id, { client: 'old' }),
				`GET OLD ${moveRepository.endpoint}/${summary.id}`,
			),
		)
	}
	return details
}

export async function verifyMoveMigration() {
	const [oldSummaries, newMoves] = await Promise.all([
		withApiRetries(
			() => moveRepository.findAll({ client: 'old' }),
			'GET OLD Move',
		),
		withApiRetries(
			() =>
				moveRepository.findAll({
					client: 'new',
					params: {
						expand:
							'organization,sourceStore,targetStore,positions.assortment,state,project,owner,group',
					},
				}),
			'GET NEW Move',
		),
	])
	const oldMoves = await loadOldDetails(oldSummaries)
	const stats = {
		matched: 0,
		missing: [],
		different: [],
	}

	for (const oldMove of oldMoves) {
		const expected = await withApiRetries(
			() => moveMapper.map(oldMove),
			`map Move ${getDocumentNumber(oldMove)}`,
		)
		const expectedIdentity = buildMoveBusinessIdentityKey(expected)
		const newMove = newMoves.find(
			move => buildMoveBusinessIdentityKey(move) === expectedIdentity,
		)
		if (!newMove) {
			stats.missing.push({
				number: getDocumentNumber(oldMove),
				id: oldMove.id,
			})
			continue
		}

		const detailedNewMove = await withApiRetries(
			() => moveRepository.findById(newMove.id, { client: 'new' }),
			`GET NEW ${moveRepository.endpoint}/${newMove.id}`,
		)
		const differences = compareMove(expected, detailedNewMove)

		if (differences.length) {
			stats.different.push({
				number: getDocumentNumber(oldMove),
				id: oldMove.id,
				differences,
			})
		} else {
			stats.matched += 1
		}
	}

	const migrationSafe =
		stats.missing.length === 0 && stats.different.length === 0

	console.log('Move')
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
	verifyMoveMigration().catch(error => {
		console.log('Move verification failed')
		console.log(error?.message || 'Unknown error')
		process.exitCode = 1
	})
}

export default verifyMoveMigration
