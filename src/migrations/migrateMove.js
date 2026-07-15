import { pathToFileURL } from 'node:url'

import { moveMapper } from '../mappers/moveMapper.js'
import { moveRepository } from '../repositories/moveRepository.js'
import { withApiRetries } from '../utils/apiRetry.js'
import { validateMovePayload } from '../validators/moveValidator.js'

function isObject(value) {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
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

function getRows(value) {
	if (Array.isArray(value)) {
		return value
	}

	if (Array.isArray(value?.rows)) {
		return value.rows
	}

	return []
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

function getReferenceHref(reference) {
	return normalizeHref(reference?.meta?.href || reference?.href || '')
}

function getReferenceId(reference) {
	return getReferenceHref(reference).split('/').filter(Boolean).at(-1) || ''
}

function getReferenceKey(reference) {
	return getReferenceId(reference) || getReferenceHref(reference)
}

function buildMovePositionIdentity(position) {
	return [
		getReferenceKey(position?.assortment),
		normalizeNumber(position?.quantity),
	].join('~')
}

function buildMoveBusinessIdentity(move) {
	return [
		normalizeString(move?.moment),
		String(Boolean(move?.applicable)),
		getReferenceKey(move?.sourceStore),
		getReferenceKey(move?.targetStore),
		getRows(move?.positions).map(buildMovePositionIdentity).sort().join('||'),
	].join('|')
}

function createStats() {
	return { total: 0, created: 0, skipped: 0, failed: 0, failures: [] }
}

function createDryRunStats() {
	return {
		loaded: 0,
		built: 0,
		validationErrors: [],
		oldReferenceErrors: [],
	}
}

function addFailure(stats, document, error) {
	stats.failed += 1
	stats.failures.push({
		number: getDocumentNumber(document),
		id: getEntityId(document),
		reason: error?.message || 'Unknown error',
	})
}

function collectOldReferenceStrings(value, references = new Set()) {
	if (Array.isArray(value)) {
		for (const item of value) {
			collectOldReferenceStrings(item, references)
		}
		return references
	}

	if (!isObject(value)) {
		return references
	}

	if (value.meta?.href) {
		references.add(value.meta.href)
	}

	if (value.id) {
		references.add(value.id)
	}

	for (const child of Object.values(value)) {
		collectOldReferenceStrings(child, references)
	}

	return references
}

function findOldReferenceLeaks(value, oldReferences, path = '$', leaks = []) {
	if (Array.isArray(value)) {
		value.forEach((item, index) =>
			findOldReferenceLeaks(item, oldReferences, `${path}[${index}]`, leaks),
		)
		return leaks
	}

	if (!isObject(value)) {
		if (typeof value === 'string' && oldReferences.has(value)) {
			leaks.push(`${path}: ${value}`)
		}
		return leaks
	}

	for (const [key, child] of Object.entries(value)) {
		findOldReferenceLeaks(child, oldReferences, `${path}.${key}`, leaks)
	}

	return leaks
}

function validateNoOldReferences(payload, oldDocument) {
	const leaks = findOldReferenceLeaks(
		payload,
		collectOldReferenceStrings(oldDocument),
	)

	if (leaks.length) {
		throw new Error(
			[
				'Mapped payload still contains OLD account references:',
				...leaks,
			].join('\n'),
		)
	}
}

function addPreflightError(errors, document, error) {
	errors.push({
		number: getDocumentNumber(document),
		id: getEntityId(document),
		reason: error?.message || 'Unknown error',
	})
}

async function loadOldMoves() {
	const summaries = await withApiRetries(
		() => moveRepository.findAll({ client: 'old' }),
		'GET OLD Move',
	)

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

async function dryRunMoveMigration() {
	const moves = await loadOldMoves()
	const stats = createDryRunStats()
	stats.loaded = moves.length

	for (const move of moves) {
		let payload
		try {
			payload = await withApiRetries(
				() => moveMapper.map(move),
				`dry-run map Move ${getDocumentNumber(move)}`,
			)
			validateMovePayload(payload)
			stats.built += 1
		} catch (error) {
			addPreflightError(stats.validationErrors, move, error)
			continue
		}

		try {
			validateNoOldReferences(payload, move)
		} catch (error) {
			addPreflightError(stats.oldReferenceErrors, move, error)
		}
	}

	const readyToExecute =
		stats.validationErrors.length === 0 && stats.oldReferenceErrors.length === 0

	console.log(`Move loaded: ${stats.loaded}`)
	console.log(`Move payloads built: ${stats.built}`)
	console.log('')
	console.log(`Validation Errors: ${stats.validationErrors.length}`)
	for (const error of stats.validationErrors) {
		console.log(`- ${error.number} (${error.id}): ${error.reason}`)
	}
	console.log(`Old Reference Errors: ${stats.oldReferenceErrors.length}`)
	for (const error of stats.oldReferenceErrors) {
		console.log(`- ${error.number} (${error.id}): ${error.reason}`)
	}
	console.log(`Ready To Execute: ${readyToExecute ? 'YES' : 'NO'}`)

	return {
		stats,
		readyToExecute,
	}
}

async function migrateMoves() {
	const oldMoves = await loadOldMoves()
	const newMoves = await withApiRetries(
		() =>
			moveRepository.findAll({
				client: 'new',
				params: {
					expand: 'sourceStore,targetStore,positions.assortment',
				},
			}),
		'GET NEW Move',
	)
	const newByExternalCode = new Map(
		newMoves
			.filter(move => move.externalCode)
			.map(move => [move.externalCode, move]),
	)
	const stats = createStats()
	stats.total = oldMoves.length

	for (const move of oldMoves) {
		try {
			if (move.externalCode && newByExternalCode.has(move.externalCode)) {
				stats.skipped += 1
				continue
			}

			const payload = await withApiRetries(
				() => moveMapper.map(move),
				`map Move ${getDocumentNumber(move)}`,
			)
			validateMovePayload(payload)
			const existingByBusinessIdentity = newMoves.find(
				newMove =>
					buildMoveBusinessIdentity(newMove) ===
					buildMoveBusinessIdentity(payload),
			)
			if (existingByBusinessIdentity) {
				stats.skipped += 1
				continue
			}

			const created = await withApiRetries(
				() => moveRepository.create(payload, { client: 'new' }),
				`CREATE Move ${getDocumentNumber(move)}`,
			)
			if (created.externalCode) {
				newByExternalCode.set(created.externalCode, created)
			}
			stats.created += 1
		} catch (error) {
			addFailure(stats, move, error)
		}
	}

	console.log('Move:')
	console.log(`  Total: ${stats.total}`)
	console.log(`  Created: ${stats.created}`)
	console.log(`  Skipped: ${stats.skipped}`)
	console.log(`  Failed: ${stats.failed}`)
	for (const failure of stats.failures) {
		console.log(`  - ${failure.number} (${failure.id}): ${failure.reason}`)
	}

	return stats
}

export async function migrateMove({ execute = false } = {}) {
	if (!execute) {
		return dryRunMoveMigration()
	}

	return migrateMoves()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	migrateMove({ execute: process.argv.includes('--execute') }).catch(error => {
		console.log('Move migration failed')
		console.log(error?.message || 'Unknown error')
		process.exitCode = 1
	})
}

export default migrateMove
