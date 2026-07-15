import { pathToFileURL } from 'node:url'

import { newClient } from '../api/newClient.js'
import { withApiRetries } from '../utils/apiRetry.js'

const PAGE_SIZE = 100
const PURCHASE_ORDER_ENDPOINT = 'entity/purchaseorder'
const SUPPLY_ENDPOINT = 'entity/supply'
const PAYMENT_OUT_ENDPOINT = 'entity/paymentout'
const CASH_OUT_ENDPOINT = 'entity/cashout'
const CONFIRM_FLAG = '--confirm-new-account'

const LINKED_DOCUMENT_ENDPOINTS = [
	{
		type: 'paymentout',
		label: 'Outgoing Payment',
		endpoint: PAYMENT_OUT_ENDPOINT,
		expand: 'operations',
		filterFields: ['operations'],
	},
	{
		type: 'cashout',
		label: 'CashOut',
		endpoint: CASH_OUT_ENDPOINT,
		expand: 'operations',
		filterFields: ['operations'],
	},
	{
		type: 'invoicein',
		label: 'Incoming Invoice',
		endpoint: 'entity/invoicein',
		filterFields: ['purchaseOrder', 'purchaseOrders', 'supply', 'supplies'],
	},
	{
		type: 'facturein',
		label: 'Incoming Facture',
		endpoint: 'entity/facturein',
		filterFields: ['purchaseOrder', 'purchaseOrders', 'supply', 'supplies'],
	},
	{
		type: 'purchasereturn',
		label: 'Purchase Return',
		endpoint: 'entity/purchasereturn',
		filterFields: ['purchaseOrder', 'purchaseOrders', 'supply', 'supplies'],
	},
]

function normalizeItems(response) {
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

function getHref(entity) {
	return entity?.meta?.href || entity?.href || ''
}

function getType(entity) {
	return entity?.meta?.type || entity?.type || ''
}

function getEntityKey(entity) {
	return getHref(entity) || entity?.id || ''
}

function getDocumentNumber(document) {
	return document?.name || document?.number || document?.code || document?.id || ''
}

function getRelativeApiPath(href) {
	const marker = '/api/remap/1.2/'
	const index = href?.indexOf(marker) ?? -1
	return index >= 0 ? href.slice(index + marker.length) : href
}

function isNotFound(error) {
	return error?.status === 404 || /not found/i.test(error?.message || '')
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

async function paginate(endpoint, params = {}) {
	const items = []
	let offset = 0
	let metaSize

	for (;;) {
		const response = await withApiRetries(
			() =>
				newClient.get(endpoint, {
					params: {
						...params,
						limit: PAGE_SIZE,
						offset,
					},
				}),
			`GET NEW ${endpoint}`,
		)
		const rows = normalizeItems(response)
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

function getOperations(payment) {
	return normalizeItems(payment?.operations)
}

function hasPurchaseGraphOperation(document) {
	return getOperations(document).some(operation => {
		const type = getType(operation)
		return type === 'purchaseorder' || type === 'supply'
	})
}

async function loadPurchaseGraphDocuments({ endpoint, expand }) {
	const params = expand ? { expand } : {}
	const documents = await paginate(endpoint, params)

	return documents.filter(hasPurchaseGraphOperation)
}

async function findLinkedDocumentsByFilters(targetDocuments) {
	const targets = targetDocuments.map(getHref).filter(Boolean)
	const documents = new Map()

	for (const targetHref of targets) {
		for (const definition of LINKED_DOCUMENT_ENDPOINTS) {
			for (const field of definition.filterFields) {
				try {
					const rows = await paginate(definition.endpoint, {
						filter: `${field}=${targetHref}`,
						...(definition.expand ? { expand: definition.expand } : {}),
					})

					for (const row of rows) {
						const key = getEntityKey(row)
						if (key) {
							documents.set(key, {
								...row,
								cleanupType: definition.type,
								cleanupLabel: definition.label,
								cleanupEndpoint: definition.endpoint,
							})
						}
					}
				} catch (error) {
					if (!isNotFound(error)) {
						console.log(
							`Linked lookup skipped: ${definition.endpoint} filter ${field}`,
						)
						console.log(formatApiError(error))
					}
				}
			}
		}
	}

	return [...documents.values()]
}

async function loadBlockingDocuments({ purchaseOrders, supplies }) {
	const [operationPayments, operationCashOuts, filterMatches] = await Promise.all([
		loadPurchaseGraphDocuments({
			endpoint: PAYMENT_OUT_ENDPOINT,
			expand: 'operations',
		}),
		loadPurchaseGraphDocuments({
			endpoint: CASH_OUT_ENDPOINT,
			expand: 'operations',
		}),
		findLinkedDocumentsByFilters([...purchaseOrders, ...supplies]),
	])
	const documents = new Map()

	for (const payment of operationPayments) {
		const key = getEntityKey(payment)
		if (key) {
			documents.set(key, {
				...payment,
				cleanupType: 'paymentout',
				cleanupLabel: 'Outgoing Payment',
				cleanupEndpoint: PAYMENT_OUT_ENDPOINT,
			})
		}
	}

	for (const cashOut of operationCashOuts) {
		const key = getEntityKey(cashOut)
		if (key) {
			documents.set(key, {
				...cashOut,
				cleanupType: 'cashout',
				cleanupLabel: 'CashOut',
				cleanupEndpoint: CASH_OUT_ENDPOINT,
			})
		}
	}

	for (const document of filterMatches) {
		const key = getEntityKey(document)
		if (key) {
			documents.set(key, document)
		}
	}

	return [...documents.values()]
}

function splitBlockingDocuments(documents) {
	const groups = new Map()
	for (const definition of LINKED_DOCUMENT_ENDPOINTS) {
		groups.set(definition.type, {
			...definition,
			documents: [],
		})
	}

	for (const document of documents) {
		const type = document.cleanupType || getType(document)
		if (!groups.has(type)) {
			groups.set(type, {
				type,
				label: type || 'Linked Document',
				endpoint: document.cleanupEndpoint || '',
				documents: [],
			})
		}

		groups.get(type).documents.push(document)
	}

	return groups
}

async function deleteByHref(href) {
	return withApiRetries(
		() => newClient.delete(getRelativeApiPath(href)),
		`DELETE NEW ${href}`,
	)
}

async function deleteDocument(document, label) {
	const href = getHref(document)
	if (!href) {
		throw new Error(`${label} has no meta.href: ${getDocumentNumber(document)}`)
	}

	await deleteByHref(href)
}

async function deleteDocuments(documents, label) {
	const result = {
		found: documents.length,
		deleted: 0,
		failed: 0,
		failures: [],
	}

	for (let index = 0; index < documents.length; index += 1) {
		const document = documents[index]
		const number = getDocumentNumber(document)
		console.log(`[${index + 1}/${documents.length}] ${label}: ${number}`)

		try {
			await deleteDocument(document, label)
			result.deleted += 1
			console.log('Deleted')
		} catch (error) {
			if (isNotFound(error)) {
				result.deleted += 1
				console.log('Skipped: already deleted')
				continue
			}

			result.failed += 1
			result.failures.push({
				number,
				reason: error?.message || 'Unknown error',
			})
			console.log(`Failed to delete ${label}`)
			console.log(formatApiError(error))
		}
	}

	return result
}

function assertSafetyConfirmation({ confirmed }) {
	if (!confirmed) {
		throw new Error(
			[
				'Purchase Chain cleanup deletes documents from the NEW account only.',
				`Re-run with ${CONFIRM_FLAG} to confirm NEW-account deletion.`,
				'Example: npm.cmd run cleanup:purchase-chain -- --confirm-new-account',
			].join('\n'),
		)
	}
}

function printSummary({ purchaseOrders, supplies, payments, cashOuts, linkedDocuments }) {
	console.log('')
	console.log(`CashOut found: ${cashOuts.found}`)
	console.log(`CashOut deleted: ${cashOuts.deleted}`)
	console.log('')
	console.log(`Purchase Orders found: ${purchaseOrders.found}`)
	console.log(`Purchase Orders deleted: ${purchaseOrders.deleted}`)
	console.log('')
	console.log(`Supplies found: ${supplies.found}`)
	console.log(`Supplies deleted: ${supplies.deleted}`)
	console.log('')
	console.log(`Outgoing Payments found: ${payments.found}`)
	console.log(`Outgoing Payments deleted: ${payments.deleted}`)
	console.log('')
	console.log(`Other linked documents found: ${linkedDocuments.found}`)
	console.log(`Other linked documents deleted: ${linkedDocuments.deleted}`)
	console.log('')

	const failed =
		purchaseOrders.failed +
		supplies.failed +
		payments.failed +
		cashOuts.failed +
		linkedDocuments.failed
	if (failed > 0) {
		console.log(`Cleanup completed with failures: ${failed}`)
		return
	}

	console.log('Cleanup completed successfully.')
}

export async function cleanupPurchaseChain({ confirmed = false } = {}) {
	assertSafetyConfirmation({ confirmed })

	console.log('Loading NEW Purchase Chain documents...')
	const [supplies, purchaseOrders] = await Promise.all([
		paginate(SUPPLY_ENDPOINT),
		paginate(PURCHASE_ORDER_ENDPOINT),
	])
	const blockingDocuments = await loadBlockingDocuments({
		purchaseOrders,
		supplies,
	})
	const blockingGroups = splitBlockingDocuments(blockingDocuments)
	const payments = blockingGroups.get('paymentout')?.documents || []
	const cashOuts = blockingGroups.get('cashout')?.documents || []
	const otherBlockingDocuments = [...blockingGroups.values()]
		.filter(group => !['paymentout', 'cashout'].includes(group.type))
		.flatMap(group => group.documents)

	console.log(`Outgoing Payments found: ${payments.length}`)
	console.log(`CashOut found: ${cashOuts.length}`)
	console.log(`Other linked documents found: ${otherBlockingDocuments.length}`)
	console.log(`Supplies found: ${supplies.length}`)
	console.log(`Purchase Orders found: ${purchaseOrders.length}`)
	console.log('')
	console.log('Deleting Outgoing Payments...')
	const paymentStats = await deleteDocuments(payments, 'Outgoing Payment')
	console.log('')
	console.log('Deleting CashOut...')
	const cashOutStats = await deleteDocuments(cashOuts, 'CashOut')
	console.log('')
	console.log('Deleting other linked documents...')
	const linkedDocumentStats = await deleteDocuments(
		otherBlockingDocuments,
		'Linked Document',
	)
	console.log('')
	console.log('Deleting Supplies...')
	const supplyStats = await deleteDocuments(supplies, 'Supply')
	console.log('')
	console.log('Deleting Purchase Orders...')
	const purchaseOrderStats = await deleteDocuments(
		purchaseOrders,
		'Purchase Order',
	)

	printSummary({
		purchaseOrders: purchaseOrderStats,
		supplies: supplyStats,
		payments: paymentStats,
		cashOuts: cashOutStats,
		linkedDocuments: linkedDocumentStats,
	})

	if (
		purchaseOrderStats.failed ||
		supplyStats.failed ||
		paymentStats.failed ||
		cashOutStats.failed ||
		linkedDocumentStats.failed
	) {
		process.exitCode = 1
	}

	return {
		purchaseOrders: purchaseOrderStats,
		supplies: supplyStats,
		payments: paymentStats,
		cashOuts: cashOutStats,
		linkedDocuments: linkedDocumentStats,
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	cleanupPurchaseChain({
		confirmed: process.argv.includes(CONFIRM_FLAG),
	}).catch(error => {
		console.log('Purchase Chain cleanup stopped')
		console.log(formatApiError(error))
		process.exitCode = 1
	})
}

export default cleanupPurchaseChain
