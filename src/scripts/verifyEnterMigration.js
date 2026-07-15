import { pathToFileURL } from 'node:url'

import { enterMapper } from '../mappers/enterMapper.js'
import { enterRepository } from '../repositories/enterRepository.js'
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

function buildEnterBusinessIdentity(enter) {
	return {
		moment: normalizeString(enter?.moment),
		applicable: String(Boolean(enter?.applicable)),
		store: getReferenceKey(enter?.store),
		positions: getRows(enter?.positions).map(buildPositionIdentity).sort().join('||'),
	}
}

function buildEnterBusinessIdentityKey(enter) {
	const identity = buildEnterBusinessIdentity(enter)
	return [
		identity.moment,
		identity.applicable,
		identity.store,
		identity.positions,
	].join('|')
}

function compareEnter(expected, actual) {
	const expectedIdentity = buildEnterBusinessIdentity(expected)
	const actualIdentity = buildEnterBusinessIdentity(actual)

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
				() => enterRepository.findById(summary.id, { client: 'old' }),
				`GET OLD ${enterRepository.endpoint}/${summary.id}`,
			),
		)
	}
	return details
}

export async function verifyEnterMigration() {
	const [oldSummaries, newEnters] = await Promise.all([
		withApiRetries(
			() => enterRepository.findAll({ client: 'old' }),
			'GET OLD Enter',
		),
		withApiRetries(
			() =>
				enterRepository.findAll({
					client: 'new',
					params: {
						expand:
							'organization,store,positions.assortment,state,project,owner,group',
					},
				}),
			'GET NEW Enter',
		),
	])
	const oldEnters = await loadOldDetails(oldSummaries)
	const newByExternalCode = new Map(
		newEnters
			.filter(enter => enter.externalCode)
			.map(enter => [enter.externalCode, enter]),
	)
	const stats = {
		matched: 0,
		missing: [],
		different: [],
	}

	for (const oldEnter of oldEnters) {
		const expected = await withApiRetries(
			() => enterMapper.map(oldEnter),
			`map Enter ${getDocumentNumber(oldEnter)}`,
		)
		const expectedIdentity = buildEnterBusinessIdentityKey(expected)
		const newEnter =
			newByExternalCode.get(oldEnter.externalCode) ||
			newEnters.find(
				enter => buildEnterBusinessIdentityKey(enter) === expectedIdentity,
			)
		if (!newEnter) {
			stats.missing.push({
				number: getDocumentNumber(oldEnter),
				id: oldEnter.id,
			})
			continue
		}

		const detailedNewEnter = await withApiRetries(
			() => enterRepository.findById(newEnter.id, { client: 'new' }),
			`GET NEW ${enterRepository.endpoint}/${newEnter.id}`,
		)
		const differences = compareEnter(expected, detailedNewEnter)

		if (differences.length) {
			stats.different.push({
				number: getDocumentNumber(oldEnter),
				id: oldEnter.id,
				differences,
			})
		} else {
			stats.matched += 1
		}
	}

	const migrationSafe =
		stats.missing.length === 0 && stats.different.length === 0

	console.log('Enter')
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
	verifyEnterMigration().catch(error => {
		console.log('Enter verification failed')
		console.log(error?.message || 'Unknown error')
		process.exitCode = 1
	})
}

export default verifyEnterMigration
