import { pathToFileURL } from 'node:url'

import { paymentOutMapper, getPurchaseGraphOperations } from '../mappers/paymentOutMapper.js'
import { purchaseOrderMapper } from '../mappers/purchaseOrderMapper.js'
import { supplyMapper } from '../mappers/supplyMapper.js'
import { paymentOutRepository } from '../repositories/paymentOutRepository.js'
import { purchaseOrderRepository } from '../repositories/purchaseOrderRepository.js'
import { supplyRepository } from '../repositories/supplyRepository.js'
import { withApiRetries } from '../utils/apiRetry.js'
import {
	buildIdentityMap,
	buildInventoryDocumentIdentityKey,
	buildPaymentIdentityKey,
	compareInventoryDocument,
	comparePayment,
	findInventoryCandidates,
	findPaymentCandidates,
	getDocumentNumber,
	getEntityId,
	getRows,
} from '../utils/purchaseChainIdentity.js'

const PURCHASE_ORDER_EXPAND =
	'organization,agent,store,positions.assortment'
const SUPPLY_EXPAND =
	'purchaseOrder,organization,agent,store,positions.assortment'
const PAYMENT_EXPAND = 'operations,organization,agent'

function normalizeHref(href) {
	return String(href || '').split('?')[0]
}

function toMetaReference(document) {
	const meta = document?.meta
	if (!meta?.href || !meta?.type || !meta?.mediaType) {
		return null
	}

	return {
		meta: {
			href: normalizeHref(meta.href),
			type: meta.type,
			mediaType: meta.mediaType,
		},
	}
}

function getHref(reference) {
	return normalizeHref(reference?.meta?.href || reference?.href || '')
}

function getReferenceId(reference) {
	return getHref(reference).split('/').filter(Boolean).at(-1) || ''
}

function isSameReference(left, right) {
	const leftHref = getHref(left)
	const rightHref = getHref(right)
	const leftId = getReferenceId(left)
	const rightId = getReferenceId(right)

	return Boolean(
		(leftHref && rightHref && leftHref === rightHref) ||
			(leftId && rightId && leftId === rightId),
	)
}

function getOperationMeta(operation) {
	return operation?.meta || operation?.operation?.meta || null
}

function normalizeLinkedSum(value) {
	const number = Number(value ?? 0)
	return Number.isFinite(number) ? Math.round(number * 1000000) / 1000000 : 0
}

function isRoundedLinkedSumMatch(left, right) {
	return Math.abs(normalizeLinkedSum(left) - normalizeLinkedSum(right)) <= 1
}

function createSectionStats() {
	return {
		matched: 0,
		missing: [],
		different: [],
	}
}

function createRelationshipStats() {
	return {
		matched: 0,
		missing: 0,
		broken: [],
	}
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

function matchInventoryDocument(expected, candidates, stats, oldDocument) {
	const identityMap = buildIdentityMap(candidates, buildInventoryDocumentIdentityKey)
	const exact = identityMap.get(buildInventoryDocumentIdentityKey(expected))?.[0]
	if (exact) {
		const differences = compareInventoryDocument(expected, exact)
		if (!differences.length) {
			stats.matched += 1
			return exact
		}

		stats.different.push({
			number: getDocumentNumber(oldDocument),
			id: getEntityId(oldDocument),
			differences,
		})
		return exact
	}

	const near = findInventoryCandidates(expected, candidates)[0]
	if (near) {
		stats.different.push({
			number: getDocumentNumber(oldDocument),
			id: getEntityId(oldDocument),
			differences: compareInventoryDocument(expected, near),
		})
		return near
	}

	stats.missing.push({
		number: getDocumentNumber(oldDocument),
		id: getEntityId(oldDocument),
	})
	return null
}

function matchPayment(expected, candidates, stats, oldPayment) {
	const byExternalCode = expected?.externalCode
		? candidates.find(candidate => candidate.externalCode === expected.externalCode)
		: null
	if (byExternalCode) {
		const differences = getVerifierRelevantPaymentDifferences(
			expected,
			byExternalCode,
		)
		if (!differences.length) {
			stats.matched += 1
			return byExternalCode
		}

		stats.different.push({
			number: getDocumentNumber(oldPayment),
			id: getEntityId(oldPayment),
			differences,
		})
		return byExternalCode
	}

	const identityMap = buildIdentityMap(candidates, buildPaymentIdentityKey)
	const exact = identityMap.get(buildPaymentIdentityKey(expected))?.[0]
	if (exact) {
		const differences = getVerifierRelevantPaymentDifferences(expected, exact)
		if (!differences.length) {
			stats.matched += 1
			return exact
		}

		stats.different.push({
			number: getDocumentNumber(oldPayment),
			id: getEntityId(oldPayment),
			differences,
		})
		return exact
	}

	const near = findPaymentCandidates(expected, candidates)[0]
	if (near) {
		const differences = getVerifierRelevantPaymentDifferences(expected, near)
		stats.different.push({
			number: getDocumentNumber(oldPayment),
			id: getEntityId(oldPayment),
			differences,
		})
		return near
	}

	stats.missing.push({
		number: getDocumentNumber(oldPayment),
		id: getEntityId(oldPayment),
	})
	return null
}

function printDocumentStats(label, stats) {
	console.log(label)
	console.log(`Matched: ${stats.matched}`)
	console.log(`Missing: ${stats.missing.length}`)
	console.log(`Different: ${stats.different.length}`)
}

function printRelationshipStats(label, stats) {
	console.log(label)
	console.log(`Matched: ${stats.matched}`)
	console.log(`Missing: ${stats.missing}`)
}

function hasOperation(payment, type, expectedHref, linkedSum) {
	return getRows(payment?.operations).some(operation => {
		const meta = getOperationMeta(operation)
		return (
			meta?.type === type &&
			isSameReference({ meta }, { href: expectedHref }) &&
			isRoundedLinkedSumMatch(operation?.linkedSum, linkedSum)
		)
	})
}

function getOperationKey(operation) {
	const meta = getOperationMeta(operation)
	return [meta?.type || '', getReferenceId({ meta })].join('~')
}

function haveVerifierEquivalentOperations(expected, actual) {
	const expectedOperations = getRows(expected?.operations)
	const actualOperations = getRows(actual?.operations)

	if (expectedOperations.length !== actualOperations.length) {
		return false
	}

	const remaining = [...actualOperations]
	for (const expectedOperation of expectedOperations) {
		const expectedKey = getOperationKey(expectedOperation)
		const matchIndex = remaining.findIndex(
			actualOperation =>
				getOperationKey(actualOperation) === expectedKey &&
				isRoundedLinkedSumMatch(
					expectedOperation?.linkedSum,
					actualOperation?.linkedSum,
				),
		)

		if (matchIndex < 0) {
			return false
		}

		remaining.splice(matchIndex, 1)
	}

	return true
}

function getVerifierRelevantPaymentDifferences(expected, actual) {
	return comparePayment(expected, actual).filter(difference => {
		if (difference.field === 'name') {
			return false
		}

		if (
			difference.field === 'operations' &&
			haveVerifierEquivalentOperations(expected, actual)
		) {
			return false
		}

		return true
	})
}

function verifyPurchaseSupplyLinks({ oldSupplies, newSupplyByOldId, newPurchaseOrderByOldId }) {
	const stats = createRelationshipStats()

	for (const oldSupply of oldSupplies) {
		const oldPurchaseOrderId = getEntityId(oldSupply.purchaseOrder)
		if (!oldPurchaseOrderId) {
			continue
		}

		const newSupply = newSupplyByOldId.get(getEntityId(oldSupply))
		const newPurchaseOrder = newPurchaseOrderByOldId.get(oldPurchaseOrderId)
		if (!newSupply || !newPurchaseOrder) {
			stats.missing += 1
			stats.broken.push(`Supply ${getDocumentNumber(oldSupply)} mapping is missing`)
			continue
		}

		if (isSameReference(newSupply.purchaseOrder, newPurchaseOrder)) {
			stats.matched += 1
		} else {
			stats.missing += 1
			stats.broken.push(
				`Supply ${getDocumentNumber(oldSupply)} does not point to mapped Purchase Order`,
			)
		}
	}

	return stats
}

function verifyPaymentLinks({
	oldPayments,
	newPaymentByOldId,
	newPurchaseOrderByOldId,
	newSupplyByOldId,
}) {
	const paymentPurchaseStats = createRelationshipStats()
	const paymentSupplyStats = createRelationshipStats()
	const supplyPaymentStats = createRelationshipStats()

	for (const oldPayment of oldPayments) {
		const newPayment = newPaymentByOldId.get(getEntityId(oldPayment))
		for (const operation of getPurchaseGraphOperations(oldPayment)) {
			const meta = getOperationMeta(operation)
			const oldTargetId = getEntityId({ meta })
			const isPurchaseOrder = meta?.type === 'purchaseorder'
			const mappedTarget = isPurchaseOrder
				? newPurchaseOrderByOldId.get(oldTargetId)
				: newSupplyByOldId.get(oldTargetId)
			const targetHref = getHref(mappedTarget)
			const stats = isPurchaseOrder ? paymentPurchaseStats : paymentSupplyStats

			if (!newPayment || !targetHref) {
				stats.missing += 1
				stats.broken.push(
					`Payment ${getDocumentNumber(oldPayment)} target mapping is missing`,
				)
				if (!isPurchaseOrder) {
					supplyPaymentStats.missing += 1
				}
				continue
			}

			if (hasOperation(newPayment, meta.type, targetHref, operation.linkedSum)) {
				stats.matched += 1
				if (!isPurchaseOrder) {
					supplyPaymentStats.matched += 1
				}
			} else {
				stats.missing += 1
				stats.broken.push(
					`Payment ${getDocumentNumber(oldPayment)} is missing ${meta.type} operation`,
				)
				if (!isPurchaseOrder) {
					supplyPaymentStats.missing += 1
				}
			}
		}
	}

	return {
		paymentPurchaseStats,
		paymentSupplyStats,
		supplyPaymentStats,
	}
}

export async function verifyPurchaseChainMigration() {
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
	const purchaseGraphPayments = getPurchaseGraphPayments(oldPayments)
	const [newPurchaseOrders, newSupplies, newPayments] = await Promise.all([
		withApiRetries(
			() =>
				purchaseOrderRepository.findAll({
					client: 'new',
					params: { expand: PURCHASE_ORDER_EXPAND },
				}),
			'GET NEW Purchase Orders',
		),
		withApiRetries(
			() =>
				supplyRepository.findAll({
					client: 'new',
					params: { expand: SUPPLY_EXPAND },
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
	const purchaseOrderStats = createSectionStats()
	const supplyStats = createSectionStats()
	const paymentStats = createSectionStats()
	const newPurchaseOrderByOldId = new Map()
	const newSupplyByOldId = new Map()
	const newPaymentByOldId = new Map()

	for (const oldPurchaseOrder of oldPurchaseOrders) {
		const expected = {
			...(await withApiRetries(
				() => purchaseOrderMapper.map(oldPurchaseOrder),
				`map Purchase Order ${getDocumentNumber(oldPurchaseOrder)}`,
			)),
			sum: oldPurchaseOrder.sum,
		}
		const matched = matchInventoryDocument(
			expected,
			newPurchaseOrders,
			purchaseOrderStats,
			oldPurchaseOrder,
		)
		if (matched) {
			newPurchaseOrderByOldId.set(getEntityId(oldPurchaseOrder), matched)
		}
	}

	const oldPurchaseOrderMetaById = new Map(
		[...newPurchaseOrderByOldId.entries()].map(([oldId, document]) => [
			oldId,
			toMetaReference(document),
		]),
	)

	for (const oldSupply of oldSupplies) {
		const oldPurchaseOrderId = getEntityId(oldSupply.purchaseOrder)
		if (oldPurchaseOrderId && !oldPurchaseOrderMetaById.has(oldPurchaseOrderId)) {
			supplyStats.missing.push({
				number: getDocumentNumber(oldSupply),
				id: getEntityId(oldSupply),
				reason: 'Mapped Purchase Order is missing',
			})
			continue
		}

		const expected = {
			...(await withApiRetries(
				() =>
					supplyMapper.map(oldSupply, {
						purchaseOrderMetaByOldId: oldPurchaseOrderMetaById,
					}),
				`map Supply ${getDocumentNumber(oldSupply)}`,
			)),
			sum: oldSupply.sum,
		}
		const matched = matchInventoryDocument(expected, newSupplies, supplyStats, oldSupply)
		if (matched) {
			newSupplyByOldId.set(getEntityId(oldSupply), matched)
		}
	}

	const oldSupplyMetaById = new Map(
		[...newSupplyByOldId.entries()].map(([oldId, document]) => [
			oldId,
			toMetaReference(document),
		]),
	)

	for (const oldPayment of oldPayments) {
		const purchaseGraphOperations = getPurchaseGraphOperations(oldPayment)
		const hasMissingTarget = purchaseGraphOperations.some(operation => {
			const meta = getOperationMeta(operation)
			const oldTargetId = getEntityId({ meta })
			return meta?.type === 'purchaseorder'
				? !oldPurchaseOrderMetaById.has(oldTargetId)
				: !oldSupplyMetaById.has(oldTargetId)
		})

		if (hasMissingTarget) {
			paymentStats.missing.push({
				number: getDocumentNumber(oldPayment),
				id: getEntityId(oldPayment),
				reason: 'Mapped operation target is missing',
			})
			continue
		}

		const expected = {
			...(await withApiRetries(
				() =>
					paymentOutMapper.map(oldPayment, {
						purchaseOrderMetaByOldId: oldPurchaseOrderMetaById,
						supplyMetaByOldId: oldSupplyMetaById,
						requirePurchaseGraph: false,
					}),
				`map Outgoing Payment ${getDocumentNumber(oldPayment)}`,
			)),
			sum: oldPayment.sum,
		}
		const matched = matchPayment(expected, newPayments, paymentStats, oldPayment)
		if (matched) {
			newPaymentByOldId.set(getEntityId(oldPayment), matched)
		}
	}

	const purchaseSupplyStats = verifyPurchaseSupplyLinks({
		oldSupplies,
		newSupplyByOldId,
		newPurchaseOrderByOldId,
	})
	const { paymentPurchaseStats, paymentSupplyStats, supplyPaymentStats } =
		verifyPaymentLinks({
			oldPayments: purchaseGraphPayments,
			newPaymentByOldId,
			newPurchaseOrderByOldId,
			newSupplyByOldId,
		})
	const brokenReferences = [
		...purchaseSupplyStats.broken,
		...paymentPurchaseStats.broken,
		...paymentSupplyStats.broken,
	]
	const migrationSafe =
		purchaseOrderStats.missing.length === 0 &&
		purchaseOrderStats.different.length === 0 &&
		supplyStats.missing.length === 0 &&
		supplyStats.different.length === 0 &&
		paymentStats.missing.length === 0 &&
		paymentStats.different.length === 0 &&
		brokenReferences.length === 0

	console.log('Purchase Orders')
	printDocumentStats('', purchaseOrderStats)
	console.log('')
	console.log('Supplies')
	printDocumentStats('', supplyStats)
	console.log('')
	console.log('Outgoing Payments')
	printDocumentStats('', paymentStats)
	console.log('')
	console.log('Relationship verification')
	printRelationshipStats('Purchase -> Supply links', purchaseSupplyStats)
	printRelationshipStats('Supply -> Payment links', supplyPaymentStats)
	printRelationshipStats('Payment -> Purchase links', paymentPurchaseStats)
	printRelationshipStats('Payment -> Supply links', paymentSupplyStats)
	console.log(`Broken references: ${brokenReferences.length}`)
	for (const reference of brokenReferences) {
		console.log(`- ${reference}`)
	}
	console.log('')
	console.log(`Migration Safe: ${migrationSafe ? 'YES' : 'NO'}`)

	return {
		purchaseOrderStats,
		supplyStats,
		paymentStats,
		purchaseSupplyStats,
		supplyPaymentStats,
		paymentPurchaseStats,
		paymentSupplyStats,
		brokenReferences,
		migrationSafe,
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	verifyPurchaseChainMigration().catch(error => {
		console.log('Purchase Chain verification failed')
		console.log(error?.message || 'Unknown error')
		process.exitCode = 1
	})
}

export default verifyPurchaseChainMigration
