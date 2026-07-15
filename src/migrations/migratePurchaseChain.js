import { pathToFileURL } from 'node:url'

import { paymentOutMapper, getPurchaseGraphOperations } from '../mappers/paymentOutMapper.js'
import { purchaseOrderMapper } from '../mappers/purchaseOrderMapper.js'
import { supplyMapper } from '../mappers/supplyMapper.js'
import { paymentOutRepository } from '../repositories/paymentOutRepository.js'
import { purchaseOrderRepository } from '../repositories/purchaseOrderRepository.js'
import { supplyRepository } from '../repositories/supplyRepository.js'
import { withApiRetries } from '../utils/apiRetry.js'
import {
	getPurchaseRateRemapDiagnostics,
	resetPurchaseRateRemapDiagnostics,
} from '../mappers/purchaseChainMapperUtils.js'
import {
	buildIdentityMap,
	buildInventoryDocumentIdentityKey,
	buildPaymentIdentityKey,
	findInventoryCandidates,
	findPaymentCandidates,
	getDocumentNumber,
	getEntityId,
} from '../utils/purchaseChainIdentity.js'
import {
	validatePaymentOutPayload,
	validatePurchaseOrderPayload,
	validateSupplyPayload,
} from '../validators/purchaseChainValidator.js'

const INVENTORY_EXPAND = 'organization,agent,store,positions.assortment'
const PAYMENT_EXPAND = 'organization,agent,operations'

function toMetaReference(document) {
	const meta = document?.meta
	if (!meta?.href || !meta?.type || !meta?.mediaType) {
		return null
	}

	return {
		meta: {
			href: meta.href,
			type: meta.type,
			mediaType: meta.mediaType,
		},
	}
}

function toDryRunMetaReference(type, index) {
	return {
		meta: {
			href: `dry-run:new/${type}/${index}`,
			type,
			mediaType: 'application/json',
		},
	}
}

function createStats() {
	return { created: 0, skipped: 0, failed: 0, total: 0, failures: [] }
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

async function loadOldDetails(repository, summaries) {
	const details = []
	for (const summary of summaries) {
		details.push(
			await withApiRetries(
				() => repository.findById(summary.id, { client: 'old' }),
				`GET OLD ${repository.endpoint}/${summary.id}`,
			),
		)
	}
	return details
}

function getPurchaseGraphPayments(payments) {
	return payments.filter(payment => getPurchaseGraphOperations(payment).length > 0)
}

function getStandalonePayments(payments) {
	return payments.filter(payment => getPurchaseGraphOperations(payment).length === 0)
}

function validateAnyPaymentOutPayload(payload) {
	return validatePaymentOutPayload(payload, {
		requirePurchaseGraphOperations: false,
		allowedOperationTypes: null,
	})
}

function isObject(value) {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
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
	const allowedSharedReferencePaths = [
		/^\$\.positions\[\d+\]\.country\.meta\.href$/,
		/^\$\.expenseItem\.meta\.href$/,
	]

	if (Array.isArray(value)) {
		value.forEach((item, index) =>
			findOldReferenceLeaks(item, oldReferences, `${path}[${index}]`, leaks),
		)
		return leaks
	}

	if (!isObject(value)) {
		const isAllowedSharedReference = allowedSharedReferencePaths.some(pattern =>
			pattern.test(path),
		)
		if (
			typeof value === 'string' &&
			oldReferences.has(value) &&
			!isAllowedSharedReference
		) {
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
	const oldReferences = collectOldReferenceStrings(oldDocument)
	const leaks = findOldReferenceLeaks(payload, oldReferences)

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

async function buildAndValidatePreflight({
	documents,
	stats,
	mapPayload,
	validatePayload,
	type,
	metaByOldId,
}) {
	stats.loaded = documents.length

	for (let index = 0; index < documents.length; index += 1) {
		const document = documents[index]
		let payload

		try {
			payload = await withApiRetries(
				() => mapPayload(document),
				`dry-run map ${type} ${getDocumentNumber(document)}`,
			)
			validatePayload(payload)
			stats.built += 1

			if (metaByOldId) {
				metaByOldId.set(getEntityId(document), toDryRunMetaReference(type, index + 1))
			}
		} catch (error) {
			addPreflightError(stats.validationErrors, document, error)
			continue
		}

		try {
			validateNoOldReferences(payload, document)
		} catch (error) {
			addPreflightError(stats.oldReferenceErrors, document, error)
		}
	}

	return stats
}

async function findExistingInventoryDocument(payload, repository, newDocuments) {
	const identityMap = buildIdentityMap(
		newDocuments,
		buildInventoryDocumentIdentityKey,
	)
	const exact = identityMap.get(buildInventoryDocumentIdentityKey(payload))?.[0]
	if (exact) {
		return exact
	}

	const candidates = findInventoryCandidates(payload, newDocuments)
	return candidates[0] || null
}

async function findExistingPayment(payload, newPayments) {
	const identityMap = buildIdentityMap(newPayments, buildPaymentIdentityKey)
	const exact = identityMap.get(buildPaymentIdentityKey(payload))?.[0]
	if (exact) {
		return exact
	}

	const candidates = findPaymentCandidates(payload, newPayments)
	return candidates[0] || null
}

async function migratePurchaseOrders({
	oldPurchaseOrders,
	newPurchaseOrders,
	oldPurchaseOrderMetaById,
}) {
	const stats = createStats()
	stats.total = oldPurchaseOrders.length

	for (const purchaseOrder of oldPurchaseOrders) {
		try {
			const payload = await withApiRetries(
				() => purchaseOrderMapper.map(purchaseOrder),
				`map Purchase Order ${getDocumentNumber(purchaseOrder)}`,
			)
			validatePurchaseOrderPayload(payload)
			const existing = await findExistingInventoryDocument(
				{ ...payload, sum: purchaseOrder.sum },
				purchaseOrderRepository,
				newPurchaseOrders,
			)

			if (existing) {
				oldPurchaseOrderMetaById.set(getEntityId(purchaseOrder), toMetaReference(existing))
				stats.skipped += 1
				continue
			}

			const created = await withApiRetries(
				() => purchaseOrderRepository.create(payload, { client: 'new' }),
				`CREATE Purchase Order ${getDocumentNumber(purchaseOrder)}`,
			)
			oldPurchaseOrderMetaById.set(getEntityId(purchaseOrder), toMetaReference(created))
			newPurchaseOrders.push(created)
			stats.created += 1
		} catch (error) {
			addFailure(stats, purchaseOrder, error)
		}
	}

	return stats
}

async function migrateSupplies({
	oldSupplies,
	newSupplies,
	oldPurchaseOrderMetaById,
	oldSupplyMetaById,
}) {
	const stats = createStats()
	stats.total = oldSupplies.length

	for (const supply of oldSupplies) {
		try {
			const payload = await withApiRetries(
				() =>
					supplyMapper.map(supply, {
						purchaseOrderMetaByOldId: oldPurchaseOrderMetaById,
					}),
				`map Supply ${getDocumentNumber(supply)}`,
			)
			validateSupplyPayload(payload)
			const existing = await findExistingInventoryDocument(
				{ ...payload, sum: supply.sum },
				supplyRepository,
				newSupplies,
			)

			if (existing) {
				oldSupplyMetaById.set(getEntityId(supply), toMetaReference(existing))
				stats.skipped += 1
				continue
			}

			const created = await withApiRetries(
				() => supplyRepository.create(payload, { client: 'new' }),
				`CREATE Supply ${getDocumentNumber(supply)}`,
			)
			oldSupplyMetaById.set(getEntityId(supply), toMetaReference(created))
			newSupplies.push(created)
			stats.created += 1
		} catch (error) {
			addFailure(stats, supply, error)
		}
	}

	return stats
}

async function migratePaymentOuts({
	oldPayments,
	newPayments,
	oldPurchaseOrderMetaById,
	oldSupplyMetaById,
}) {
	const stats = createStats()
	stats.total = oldPayments.length
	const newByExternalCode = new Map(
		newPayments
			.filter(payment => payment.externalCode)
			.map(payment => [payment.externalCode, payment]),
	)

	for (const payment of oldPayments) {
		try {
			if (payment.externalCode && newByExternalCode.has(payment.externalCode)) {
				stats.skipped += 1
				continue
			}

			const payload = await withApiRetries(
				() =>
					paymentOutMapper.map(payment, {
						purchaseOrderMetaByOldId: oldPurchaseOrderMetaById,
						supplyMetaByOldId: oldSupplyMetaById,
						requirePurchaseGraph: false,
					}),
				`map Outgoing Payment ${getDocumentNumber(payment)}`,
			)
			validateAnyPaymentOutPayload(payload)
			const existing = await findExistingPayment(
				{ ...payload, sum: payment.sum },
				newPayments,
			)

			if (existing) {
				if (existing.externalCode) {
					newByExternalCode.set(existing.externalCode, existing)
				}
				stats.skipped += 1
				continue
			}

			const created = await withApiRetries(
				() => paymentOutRepository.create(payload, { client: 'new' }),
				`CREATE Outgoing Payment ${getDocumentNumber(payment)}`,
			)
			newPayments.push(created)
			if (created.externalCode) {
				newByExternalCode.set(created.externalCode, created)
			}
			stats.created += 1
		} catch (error) {
			addFailure(stats, payment, error)
		}
	}

	return stats
}

function printStats(label, stats) {
	console.log(`${label}:`)
	console.log(`  Total: ${stats.total}`)
	console.log(`  Created: ${stats.created}`)
	console.log(`  Skipped: ${stats.skipped}`)
	console.log(`  Failed: ${stats.failed}`)

	if (stats.failures.length) {
		console.log('  Failures:')
		for (const failure of stats.failures) {
			console.log(`    ${failure.number} (${failure.id}): ${failure.reason}`)
		}
	}
}

async function loadOldPurchaseChain() {
	const [oldPurchaseOrderSummaries, oldSupplySummaries, oldPaymentSummaries] =
		await Promise.all([
			withApiRetries(
				() => purchaseOrderRepository.findAll({ client: 'old' }),
				'GET OLD Purchase Orders',
			),
			withApiRetries(
				() => supplyRepository.findAll({ client: 'old' }),
				'GET OLD Supplies',
			),
			withApiRetries(
				() => paymentOutRepository.findAll({ client: 'old' }),
				'GET OLD Outgoing Payments',
			),
		])
	const [oldPurchaseOrders, oldSupplies, oldPayments] = await Promise.all([
		loadOldDetails(purchaseOrderRepository, oldPurchaseOrderSummaries),
		loadOldDetails(supplyRepository, oldSupplySummaries),
		loadOldDetails(paymentOutRepository, oldPaymentSummaries),
	])

	return {
		oldPurchaseOrders,
		oldSupplies,
		oldPayments,
		purchaseGraphPayments: getPurchaseGraphPayments(oldPayments),
		standalonePayments: getStandalonePayments(oldPayments),
	}
}

function printDryRunReport({
	purchaseOrderStats,
	supplyStats,
	paymentStats,
	oldPaymentCount,
	purchaseGraphPaymentCount,
	standalonePaymentCount,
}) {
	const rateDiagnostics = getPurchaseRateRemapDiagnostics()
	const validationErrors = [
		...purchaseOrderStats.validationErrors,
		...supplyStats.validationErrors,
		...paymentStats.validationErrors,
	]
	const oldReferenceErrors = [
		...purchaseOrderStats.oldReferenceErrors,
		...supplyStats.oldReferenceErrors,
		...paymentStats.oldReferenceErrors,
	]
	const readyToExecute =
		validationErrors.length === 0 && oldReferenceErrors.length === 0

	console.log(`Purchase Orders loaded: ${purchaseOrderStats.loaded}`)
	console.log(`Purchase Order payloads built: ${purchaseOrderStats.built}`)
	console.log('')
	console.log(`Supplies loaded: ${supplyStats.loaded}`)
	console.log(`Supply payloads built: ${supplyStats.built}`)
	console.log('')
	console.log(`Outgoing Payments loaded: ${paymentStats.loaded}`)
	console.log(`Outgoing Payment payloads built: ${paymentStats.built}`)
	console.log('')
	console.log(`OLD PaymentOut: ${oldPaymentCount}`)
	console.log(`Purchase-chain: ${purchaseGraphPaymentCount}`)
	console.log(`Standalone: ${standalonePaymentCount}`)
	console.log(`Total payloads: ${paymentStats.built}`)
	console.log('')
	console.log(`Validation Errors: ${validationErrors.length}`)
	for (const error of validationErrors) {
		console.log(`- ${error.number} (${error.id}): ${error.reason}`)
	}
	console.log(`Old Reference Errors: ${oldReferenceErrors.length}`)
	for (const error of oldReferenceErrors) {
		console.log(`- ${error.number} (${error.id}): ${error.reason}`)
	}
	console.log('')
	console.log(
		`Purchase Orders with remapped rates: ${rateDiagnostics.purchaseorder}`,
	)
	console.log(`Supplies with remapped rates: ${rateDiagnostics.supply}`)
	console.log(
		`Outgoing Payments with remapped rates: ${rateDiagnostics.paymentout}`,
	)
	console.log('')
	console.log(`Rate remap failures: ${rateDiagnostics.failures.length}`)
	for (const failure of rateDiagnostics.failures) {
		console.log(
			`- ${failure.type} ${failure.number} (${failure.id}): ${failure.reason}`,
		)
	}
	console.log(`Ready To Execute: ${readyToExecute ? 'YES' : 'NO'}`)
}

export async function dryRunPurchaseChainMigration() {
	resetPurchaseRateRemapDiagnostics()
	const {
		oldPurchaseOrders,
		oldSupplies,
		oldPayments,
		purchaseGraphPayments,
		standalonePayments,
	} = await loadOldPurchaseChain()
	const oldPurchaseOrderMetaById = new Map()
	const oldSupplyMetaById = new Map()
	const purchaseOrderStats = createDryRunStats()
	const supplyStats = createDryRunStats()
	const paymentStats = createDryRunStats()

	await buildAndValidatePreflight({
		documents: oldPurchaseOrders,
		stats: purchaseOrderStats,
		type: 'purchaseorder',
		metaByOldId: oldPurchaseOrderMetaById,
		mapPayload: purchaseOrder => purchaseOrderMapper.map(purchaseOrder),
		validatePayload: validatePurchaseOrderPayload,
	})

	await buildAndValidatePreflight({
		documents: oldSupplies,
		stats: supplyStats,
		type: 'supply',
		metaByOldId: oldSupplyMetaById,
		mapPayload: supply =>
			supplyMapper.map(supply, {
				purchaseOrderMetaByOldId: oldPurchaseOrderMetaById,
			}),
		validatePayload: validateSupplyPayload,
	})

	await buildAndValidatePreflight({
		documents: oldPayments,
		stats: paymentStats,
		type: 'paymentout',
		mapPayload: payment =>
			paymentOutMapper.map(payment, {
				purchaseOrderMetaByOldId: oldPurchaseOrderMetaById,
				supplyMetaByOldId: oldSupplyMetaById,
				requirePurchaseGraph: false,
			}),
		validatePayload: validateAnyPaymentOutPayload,
	})

	printDryRunReport({
		purchaseOrderStats,
		supplyStats,
		paymentStats,
		oldPaymentCount: oldPayments.length,
		purchaseGraphPaymentCount: purchaseGraphPayments.length,
		standalonePaymentCount: standalonePayments.length,
	})

	return {
		purchaseOrderStats,
		supplyStats,
		paymentStats,
		readyToExecute:
			purchaseOrderStats.validationErrors.length === 0 &&
			supplyStats.validationErrors.length === 0 &&
			paymentStats.validationErrors.length === 0 &&
			purchaseOrderStats.oldReferenceErrors.length === 0 &&
			supplyStats.oldReferenceErrors.length === 0 &&
			paymentStats.oldReferenceErrors.length === 0,
	}
}

export async function migratePurchaseChain({ execute = false } = {}) {
	if (!execute) {
		return dryRunPurchaseChainMigration()
	}

	const { oldPurchaseOrders, oldSupplies, oldPayments } =
		await loadOldPurchaseChain()
	const [newPurchaseOrders, newSupplies, newPayments] = await Promise.all([
		withApiRetries(
			() =>
				purchaseOrderRepository.findAll({
					client: 'new',
					params: { expand: INVENTORY_EXPAND },
				}),
			'GET NEW Purchase Orders',
		),
		withApiRetries(
			() =>
				supplyRepository.findAll({
					client: 'new',
					params: { expand: INVENTORY_EXPAND },
				}),
			'GET NEW Supplies',
		),
		withApiRetries(
			() =>
				paymentOutRepository.findAll({
					client: 'new',
					params: { expand: PAYMENT_EXPAND },
				}),
			'GET NEW Outgoing Payments',
		),
	])
	const oldPurchaseOrderMetaById = new Map()
	const oldSupplyMetaById = new Map()

	console.log('Migrating Purchase Orders...')
	const purchaseOrderStats = await migratePurchaseOrders({
		oldPurchaseOrders,
		newPurchaseOrders,
		oldPurchaseOrderMetaById,
	})

	console.log('Migrating Supplies...')
	const supplyStats = await migrateSupplies({
		oldSupplies,
		newSupplies,
		oldPurchaseOrderMetaById,
		oldSupplyMetaById,
	})

	console.log('Migrating Outgoing Payments...')
	const paymentStats = await migratePaymentOuts({
		oldPayments,
		newPayments,
		oldPurchaseOrderMetaById,
		oldSupplyMetaById,
	})

	console.log('--------------------------------')
	printStats('Purchase Orders', purchaseOrderStats)
	printStats('Supplies', supplyStats)
	printStats('Outgoing Payments', paymentStats)

	return {
		purchaseOrderStats,
		supplyStats,
		paymentStats,
		oldPurchaseOrderMetaById,
		oldSupplyMetaById,
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	migratePurchaseChain({ execute: process.argv.includes('--execute') }).catch(error => {
		console.log('Purchase Chain migration failed')
		console.log(error?.message || 'Unknown error')
		process.exitCode = 1
	})
}

export default migratePurchaseChain
