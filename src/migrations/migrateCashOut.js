import { pathToFileURL } from 'node:url'

import { cashOutMapper } from '../mappers/cashOutMapper.js'
import { cashOutRepository } from '../repositories/cashOutRepository.js'
import { withApiRetries } from '../utils/apiRetry.js'
import { validateCashOutPayload } from '../validators/cashOutValidator.js'

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
			if (path === '$.expenseItem.meta.href') {
				return leaks
			}
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

async function loadOldCashOuts() {
	const summaries = await withApiRetries(
		() => cashOutRepository.findAll({ client: 'old' }),
		'GET OLD CashOut',
	)

	const details = []
	for (const summary of summaries) {
		details.push(
			await withApiRetries(
				() => cashOutRepository.findById(summary.id, { client: 'old' }),
				`GET OLD ${cashOutRepository.endpoint}/${summary.id}`,
			),
		)
	}

	return details
}

async function dryRunCashOutMigration() {
	const cashOuts = await loadOldCashOuts()
	const stats = createDryRunStats()
	stats.loaded = cashOuts.length

	for (const cashOut of cashOuts) {
		let payload
		try {
			payload = await withApiRetries(
				() => cashOutMapper.map(cashOut),
				`dry-run map CashOut ${getDocumentNumber(cashOut)}`,
			)
			validateCashOutPayload(payload)
			stats.built += 1
		} catch (error) {
			addPreflightError(stats.validationErrors, cashOut, error)
			continue
		}

		try {
			validateNoOldReferences(payload, cashOut)
		} catch (error) {
			addPreflightError(stats.oldReferenceErrors, cashOut, error)
		}
	}

	const readyToExecute =
		stats.validationErrors.length === 0 && stats.oldReferenceErrors.length === 0

	console.log(`CashOut loaded: ${stats.loaded}`)
	console.log(`CashOut payloads built: ${stats.built}`)
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

async function migrateCashOuts() {
	const oldCashOuts = await loadOldCashOuts()
	const newCashOuts = await withApiRetries(
		() => cashOutRepository.findAll({ client: 'new' }),
		'GET NEW CashOut',
	)
	const newByExternalCode = new Map(
		newCashOuts
			.filter(cashOut => cashOut.externalCode)
			.map(cashOut => [cashOut.externalCode, cashOut]),
	)
	const stats = createStats()
	stats.total = oldCashOuts.length

	for (const cashOut of oldCashOuts) {
		try {
			if (cashOut.externalCode && newByExternalCode.has(cashOut.externalCode)) {
				stats.skipped += 1
				continue
			}

			const payload = await withApiRetries(
				() => cashOutMapper.map(cashOut),
				`map CashOut ${getDocumentNumber(cashOut)}`,
			)
			validateCashOutPayload(payload)
			const created = await withApiRetries(
				() => cashOutRepository.create(payload, { client: 'new' }),
				`CREATE CashOut ${getDocumentNumber(cashOut)}`,
			)
			if (created.externalCode) {
				newByExternalCode.set(created.externalCode, created)
			}
			stats.created += 1
		} catch (error) {
			addFailure(stats, cashOut, error)
		}
	}

	console.log('CashOut:')
	console.log(`  Total: ${stats.total}`)
	console.log(`  Created: ${stats.created}`)
	console.log(`  Skipped: ${stats.skipped}`)
	console.log(`  Failed: ${stats.failed}`)
	for (const failure of stats.failures) {
		console.log(`  - ${failure.number} (${failure.id}): ${failure.reason}`)
	}

	return stats
}

export async function migrateCashOut({ execute = false } = {}) {
	if (!execute) {
		return dryRunCashOutMigration()
	}

	return migrateCashOuts()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	migrateCashOut({ execute: process.argv.includes('--execute') }).catch(error => {
		console.log('CashOut migration failed')
		console.log(error?.message || 'Unknown error')
		process.exitCode = 1
	})
}

export default migrateCashOut
