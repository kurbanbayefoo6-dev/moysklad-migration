import { pathToFileURL } from 'node:url'

import { paymentInMapper } from '../mappers/paymentInMapper.js'
import { paymentInRepository } from '../repositories/paymentInRepository.js'
import { withApiRetries } from '../utils/apiRetry.js'
import { validatePaymentInPayload } from '../validators/paymentInValidator.js'

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

async function loadOldPaymentIns() {
	const summaries = await withApiRetries(
		() => paymentInRepository.findAll({ client: 'old' }),
		'GET OLD Incoming Payments',
	)

	const details = []
	for (const summary of summaries) {
		details.push(
			await withApiRetries(
				() => paymentInRepository.findById(summary.id, { client: 'old' }),
				`GET OLD ${paymentInRepository.endpoint}/${summary.id}`,
			),
		)
	}

	return details
}

async function dryRunPaymentInMigration() {
	const payments = await loadOldPaymentIns()
	const stats = createDryRunStats()
	stats.loaded = payments.length

	for (const payment of payments) {
		let payload
		try {
			payload = await withApiRetries(
				() => paymentInMapper.map(payment),
				`dry-run map Incoming Payment ${getDocumentNumber(payment)}`,
			)
			validatePaymentInPayload(payload)
			stats.built += 1
		} catch (error) {
			addPreflightError(stats.validationErrors, payment, error)
			continue
		}

		try {
			validateNoOldReferences(payload, payment)
		} catch (error) {
			addPreflightError(stats.oldReferenceErrors, payment, error)
		}
	}

	const readyToExecute =
		stats.validationErrors.length === 0 && stats.oldReferenceErrors.length === 0

	console.log(`Incoming Payments loaded: ${stats.loaded}`)
	console.log(`Incoming Payment payloads built: ${stats.built}`)
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

async function migratePaymentIns() {
	const oldPayments = await loadOldPaymentIns()
	const newPayments = await withApiRetries(
		() => paymentInRepository.findAll({ client: 'new' }),
		'GET NEW Incoming Payments',
	)
	const newByExternalCode = new Map(
		newPayments
			.filter(payment => payment.externalCode)
			.map(payment => [payment.externalCode, payment]),
	)
	const stats = createStats()
	stats.total = oldPayments.length

	for (const payment of oldPayments) {
		try {
			if (payment.externalCode && newByExternalCode.has(payment.externalCode)) {
				stats.skipped += 1
				continue
			}

			const payload = await withApiRetries(
				() => paymentInMapper.map(payment),
				`map Incoming Payment ${getDocumentNumber(payment)}`,
			)
			validatePaymentInPayload(payload)
			const created = await withApiRetries(
				() => paymentInRepository.create(payload, { client: 'new' }),
				`CREATE Incoming Payment ${getDocumentNumber(payment)}`,
			)
			if (created.externalCode) {
				newByExternalCode.set(created.externalCode, created)
			}
			stats.created += 1
		} catch (error) {
			addFailure(stats, payment, error)
		}
	}

	console.log('Incoming Payments:')
	console.log(`  Total: ${stats.total}`)
	console.log(`  Created: ${stats.created}`)
	console.log(`  Skipped: ${stats.skipped}`)
	console.log(`  Failed: ${stats.failed}`)
	for (const failure of stats.failures) {
		console.log(`  - ${failure.number} (${failure.id}): ${failure.reason}`)
	}

	return stats
}

export async function migratePaymentIn({ execute = false } = {}) {
	if (!execute) {
		return dryRunPaymentInMigration()
	}

	return migratePaymentIns()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	migratePaymentIn({ execute: process.argv.includes('--execute') }).catch(error => {
		console.log('PaymentIn migration failed')
		console.log(error?.message || 'Unknown error')
		process.exitCode = 1
	})
}

export default migratePaymentIn
