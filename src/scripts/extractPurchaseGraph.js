import { pathToFileURL } from 'node:url'

import { oldClient } from '../api/oldClient.js'

const PAGE_SIZE = 100
const PURCHASE_ORDER_ENDPOINT = 'entity/purchaseorder'
const SUPPLY_ENDPOINT = 'entity/supply'
const PAYMENT_OUT_ENDPOINT = 'entity/paymentout'
const TEMPORARY_STATUSES = new Set([408, 429, 500, 502, 503, 504])
const MAX_RETRIES = 4
const RETRY_DELAY_MS = 1000

function delay(ms) {
	return new Promise(resolve => {
		setTimeout(resolve, ms)
	})
}

function normalizeRows(response) {
	if (Array.isArray(response)) {
		return response
	}

	if (Array.isArray(response?.rows)) {
		return response.rows
	}

	if (Array.isArray(response?.items)) {
		return response.items
	}

	return []
}

function normalizeCollection(value) {
	if (Array.isArray(value)) {
		return value
	}

	if (Array.isArray(value?.rows)) {
		return value.rows
	}

	if (Array.isArray(value?.items)) {
		return value.items
	}

	return []
}

function getHref(entity) {
	return entity?.meta?.href || entity?.href || ''
}

function getType(entity) {
	return entity?.meta?.type || entity?.type || ''
}

function getIdFromHref(href) {
	return href?.split('/').filter(Boolean).at(-1) || ''
}

function getEntityId(entity) {
	return entity?.id || getIdFromHref(getHref(entity))
}

function getDocumentNumber(document) {
	return document?.name || document?.number || document?.code || document?.id || ''
}

function getReferenceId(reference) {
	return getEntityId(reference) || getIdFromHref(getHref(reference))
}

function formatLinkedSum(value) {
	if (value === undefined || value === null || value === '') {
		return 'not specified'
	}

	return String(value)
}

function formatApiError(error) {
	const body =
		error?.responseBody ||
		error?.response?.data ||
		error?.data ||
		error?.body ||
		null

	if (body) {
		return `${error?.message || 'API error'}\n${JSON.stringify(body, null, 2)}`
	}

	return error?.message || 'Unknown API error'
}

function isTemporaryError(error) {
	if (!error?.status) {
		return true
	}

	return TEMPORARY_STATUSES.has(error.status)
}

async function withRetries(action, label) {
	let lastError

	for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
		try {
			return await action()
		} catch (error) {
			lastError = error
			if (!isTemporaryError(error) || attempt === MAX_RETRIES) {
				throw error
			}

			console.log(
				`Temporary API error during ${label}. Retry ${attempt}/${MAX_RETRIES - 1}`,
			)
			console.log(formatApiError(error))
			await delay(RETRY_DELAY_MS * attempt)
		}
	}

	throw lastError
}

async function paginate(endpoint, params = {}) {
	const items = []
	let offset = 0
	let metaSize

	for (;;) {
		const response = await withRetries(
			() =>
				oldClient.get(endpoint, {
					params: {
						...params,
						limit: PAGE_SIZE,
						offset,
					},
				}),
			`GET OLD ${endpoint}`,
		)

		const rows = normalizeRows(response)
		items.push(...rows)

		if (typeof response?.meta?.size === 'number') {
			metaSize = response.meta.size
		}

		if (typeof metaSize === 'number' && items.length >= metaSize) {
			break
		}

		const nextOffset = offset + PAGE_SIZE
		if (
			rows.length < PAGE_SIZE &&
			(typeof metaSize !== 'number' || nextOffset >= metaSize)
		) {
			break
		}

		offset = nextOffset
	}

	items.metaSize = metaSize ?? items.length
	return items
}

function createDocumentIndex(documents) {
	const byId = new Map()
	const byHref = new Map()

	for (const document of documents) {
		const id = getEntityId(document)
		const href = getHref(document)

		if (id) {
			byId.set(id, document)
		}

		if (href) {
			byHref.set(href, document)
		}
	}

	return { byId, byHref }
}

function getPaymentOperations(payment) {
	return normalizeCollection(payment?.operations)
		.map(operation => {
			const reference = operation?.meta ? operation : operation?.operation || operation
			const meta = reference?.meta || operation?.meta
			const type = meta?.type || getType(reference)
			const href = meta?.href || getHref(reference)

			return {
				type,
				href,
				id: getIdFromHref(href),
				linkedSum: operation?.linkedSum,
			}
		})
		.filter(operation => operation.type || operation.href || operation.id)
}

function indexSuppliesByPurchaseOrder(supplies) {
	const suppliesByPurchaseOrderId = new Map()
	const suppliesWithoutPurchaseOrder = []

	for (const supply of supplies) {
		const purchaseOrderId = getReferenceId(supply?.purchaseOrder)

		if (!purchaseOrderId) {
			suppliesWithoutPurchaseOrder.push(supply)
			continue
		}

		if (!suppliesByPurchaseOrderId.has(purchaseOrderId)) {
			suppliesByPurchaseOrderId.set(purchaseOrderId, [])
		}

		suppliesByPurchaseOrderId.get(purchaseOrderId).push(supply)
	}

	return { suppliesByPurchaseOrderId, suppliesWithoutPurchaseOrder }
}

function analyzePayments(payments) {
	const paymentsByPurchaseOrderId = new Map()
	const paymentsBySupplyId = new Map()
	const paymentAnalysis = []

	for (const payment of payments) {
		const operations = getPaymentOperations(payment)
		const purchaseOrderLinks = operations.filter(
			operation => operation.type === 'purchaseorder',
		)
		const supplyLinks = operations.filter(operation => operation.type === 'supply')

		for (const operation of purchaseOrderLinks) {
			if (!paymentsByPurchaseOrderId.has(operation.id)) {
				paymentsByPurchaseOrderId.set(operation.id, [])
			}

			paymentsByPurchaseOrderId.get(operation.id).push({ payment, operation })
		}

		for (const operation of supplyLinks) {
			if (!paymentsBySupplyId.has(operation.id)) {
				paymentsBySupplyId.set(operation.id, [])
			}

			paymentsBySupplyId.get(operation.id).push({ payment, operation })
		}

		paymentAnalysis.push({
			payment,
			operations,
			purchaseOrderLinks,
			supplyLinks,
			isLinkedToPurchaseOrder: purchaseOrderLinks.length > 0,
			isLinkedToSupply: supplyLinks.length > 0,
		})
	}

	return {
		paymentsByPurchaseOrderId,
		paymentsBySupplyId,
		paymentAnalysis,
	}
}

function appendPayment(graphPayments, payment, operations) {
	const paymentId = getEntityId(payment)
	if (!paymentId) {
		return
	}

	const existing = graphPayments.get(paymentId)
	if (existing) {
		for (const operation of operations) {
			existing.operations.push(operation)
		}
		return
	}

	graphPayments.set(paymentId, {
		payment,
		operations: [...operations],
	})
}

function buildPurchaseOrderGraph({
	purchaseOrder,
	suppliesByPurchaseOrderId,
	paymentsByPurchaseOrderId,
	paymentsBySupplyId,
}) {
	const purchaseOrderId = getEntityId(purchaseOrder)
	const supplies = suppliesByPurchaseOrderId.get(purchaseOrderId) || []
	const graphPayments = new Map()

	const directPaymentLinks = paymentsByPurchaseOrderId.get(purchaseOrderId) || []
	for (const { payment, operation } of directPaymentLinks) {
		appendPayment(graphPayments, payment, [operation])
	}

	for (const supply of supplies) {
		const supplyId = getEntityId(supply)
		const supplyPaymentLinks = paymentsBySupplyId.get(supplyId) || []

		for (const { payment, operation } of supplyPaymentLinks) {
			appendPayment(graphPayments, payment, [operation])
		}
	}

	return {
		purchaseOrder,
		supplies,
		payments: [...graphPayments.values()],
	}
}

function printOperation(operation, purchaseOrderIndex, supplyIndex) {
	const target =
		operation.type === 'purchaseorder'
			? purchaseOrderIndex.byId.get(operation.id)
			: supplyIndex.byId.get(operation.id)
	const typeLabel =
		operation.type === 'purchaseorder'
			? 'Purchase Order'
			: operation.type === 'supply'
				? 'Supply'
				: operation.type || 'Unknown'
	const number = target ? getDocumentNumber(target) : 'Unknown'

	console.log(`      -> ${typeLabel}`)
	console.log(`         Number: ${number}`)
	console.log(`         ID: ${operation.id || 'Unknown'}`)
	console.log(`         linkedSum: ${formatLinkedSum(operation.linkedSum)}`)
}

function printGraph(graph, purchaseOrderIndex, supplyIndex) {
	const purchaseOrder = graph.purchaseOrder

	console.log('Purchase Order')
	console.log(`  Number: ${getDocumentNumber(purchaseOrder)}`)
	console.log(`  Old ID: ${getEntityId(purchaseOrder)}`)
	console.log('')
	console.log('  Supplies:')

	if (!graph.supplies.length) {
		console.log('    none')
	} else {
		for (const supply of graph.supplies) {
			console.log(`    - Number: ${getDocumentNumber(supply)}`)
			console.log(`      ID: ${getEntityId(supply)}`)
		}
	}

	console.log('')
	console.log('  Outgoing Payments:')

	if (!graph.payments.length) {
		console.log('    none')
	} else {
		for (const { payment, operations } of graph.payments) {
			console.log('')
			console.log('    Payment:')
			console.log(`      Number: ${getDocumentNumber(payment)}`)
			console.log(`      ID: ${getEntityId(payment)}`)
			console.log('')
			console.log('      Operations:')

			if (!operations.length) {
				console.log('        none')
			} else {
				for (const operation of operations) {
					printOperation(operation, purchaseOrderIndex, supplyIndex)
				}
			}
		}
	}

	console.log('')
}

function countPaymentsLinkedToBoth(paymentAnalysis) {
	return paymentAnalysis.filter(
		analysis => analysis.isLinkedToPurchaseOrder && analysis.isLinkedToSupply,
	).length
}

function countOrphanPayments(paymentAnalysis) {
	return paymentAnalysis.filter(
		analysis => !analysis.isLinkedToPurchaseOrder && !analysis.isLinkedToSupply,
	).length
}

function printSummary({
	purchaseOrders,
	supplies,
	payments,
	paymentAnalysis,
	suppliesByPurchaseOrderId,
	suppliesWithoutPurchaseOrder,
}) {
	const purchaseOrdersWithoutSupply = purchaseOrders.filter(
		purchaseOrder => !suppliesByPurchaseOrderId.has(getEntityId(purchaseOrder)),
	)
	const paymentsLinkedToPurchaseOrders = paymentAnalysis.filter(
		analysis => analysis.isLinkedToPurchaseOrder,
	)
	const paymentsLinkedToSupplies = paymentAnalysis.filter(
		analysis => analysis.isLinkedToSupply,
	)

	console.log('--------------------------------')
	console.log(`Purchase Orders: ${purchaseOrders.length}`)
	console.log(`Supplies: ${supplies.length}`)
	console.log(`Outgoing Payments: ${payments.length}`)
	console.log(
		`Payments linked to Purchase Orders: ${paymentsLinkedToPurchaseOrders.length}`,
	)
	console.log(`Payments linked to Supplies: ${paymentsLinkedToSupplies.length}`)
	console.log(`Payments linked to BOTH: ${countPaymentsLinkedToBoth(paymentAnalysis)}`)
	console.log(`Purchase Orders without Supply: ${purchaseOrdersWithoutSupply.length}`)
	console.log(`Supplies without Purchase Order: ${suppliesWithoutPurchaseOrder.length}`)
	console.log(`Orphan Payments: ${countOrphanPayments(paymentAnalysis)}`)
	console.log('--------------------------------')
}

function determineMigrationOrder(paymentAnalysis) {
	const hasSupplyPayments = paymentAnalysis.some(analysis => analysis.isLinkedToSupply)
	const hasPurchaseOrderPayments = paymentAnalysis.some(
		analysis => analysis.isLinkedToPurchaseOrder,
	)

	if (hasSupplyPayments) {
		return 'Purchase Order -> Supply -> Outgoing Payment'
	}

	if (hasPurchaseOrderPayments) {
		return 'Purchase Order -> Outgoing Payment. Supply can be migrated before payments for consistency, but payments do not require it.'
	}

	return 'Purchase Order -> Supply. Outgoing Payment order depends on orphan payment policy because no payments are linked to Purchase Orders or Supplies.'
}

export async function extractPurchaseGraph() {
	console.log('Loading OLD Purchase Orders...')
	const purchaseOrders = await paginate(PURCHASE_ORDER_ENDPOINT)

	console.log('Loading OLD Supplies...')
	const supplies = await paginate(SUPPLY_ENDPOINT, {
		expand: 'purchaseOrder',
	})

	console.log('Loading OLD Outgoing Payments...')
	const payments = await paginate(PAYMENT_OUT_ENDPOINT)

	const purchaseOrderIndex = createDocumentIndex(purchaseOrders)
	const supplyIndex = createDocumentIndex(supplies)
	const { suppliesByPurchaseOrderId, suppliesWithoutPurchaseOrder } =
		indexSuppliesByPurchaseOrder(supplies)
	const {
		paymentsByPurchaseOrderId,
		paymentsBySupplyId,
		paymentAnalysis,
	} = analyzePayments(payments)

	console.log('')
	console.log('OLD Purchase Graph')
	console.log('================================')
	console.log('')

	for (const purchaseOrder of purchaseOrders) {
		const graph = buildPurchaseOrderGraph({
			purchaseOrder,
			suppliesByPurchaseOrderId,
			paymentsByPurchaseOrderId,
			paymentsBySupplyId,
		})
		printGraph(graph, purchaseOrderIndex, supplyIndex)
	}

	printSummary({
		purchaseOrders,
		supplies,
		payments,
		paymentAnalysis,
		suppliesByPurchaseOrderId,
		suppliesWithoutPurchaseOrder,
	})

	const migrationOrder = determineMigrationOrder(paymentAnalysis)
	console.log(`Safe migration order: ${migrationOrder}`)

	return {
		purchaseOrders,
		supplies,
		payments,
		paymentAnalysis,
		suppliesWithoutPurchaseOrder,
		migrationOrder,
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	extractPurchaseGraph().catch(error => {
		console.log('Purchase graph extraction failed')
		console.log(formatApiError(error))
		process.exitCode = 1
	})
}

export default extractPurchaseGraph
