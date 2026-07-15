import { newClient } from '../api/newClient.js'
import { oldClient } from '../api/oldClient.js'
import { counterpartyResolver } from '../resolvers/CounterpartyResolver.js'
import { employeeResolver } from '../resolvers/EmployeeResolver.js'
import { expenseItemResolver } from '../resolvers/ExpenseItemResolver.js'
import { organizationResolver } from '../resolvers/OrganizationResolver.js'
import {
	copyScalarFields,
	getEntityId,
	getRelativeApiPath,
	getRows,
	isObject,
	mapCommonDocumentReferences,
	paymentOutAttributeResolver,
	paymentOutStateResolver,
	removeUndefined,
	resolveRequiredReference,
	toMetaReference,
} from './purchaseChainMapperUtils.js'

const SCALAR_FIELDS = [
	'moment',
	'applicable',
	'description',
	'externalCode',
	'paymentPurpose',
	'sum',
]

function getOperationType(operation) {
	return operation?.meta?.type || operation?.operation?.meta?.type || ''
}

function getOperationId(operation) {
	return getEntityId(operation?.meta ? operation : operation?.operation)
}

const OPERATION_ENDPOINT_BY_TYPE = new Map([
	['purchaseorder', 'entity/purchaseorder'],
	['supply', 'entity/supply'],
	['invoicein', 'entity/invoicein'],
	['purchasereturn', 'entity/purchasereturn'],
	['commissionreportin', 'entity/commissionreportin'],
])

const oldOperationTargetByHref = new Map()
const newOperationTargetByKey = new Map()

export function getPurchaseGraphOperations(payment) {
	return getRows(payment.operations).filter(operation =>
		['purchaseorder', 'supply'].includes(getOperationType(operation)),
	)
}

function keepLocalPaymentName(payload, payment) {
	if (!payment.name) {
		return payload
	}

	Object.defineProperty(payload, 'name', {
		value: payment.name,
		enumerable: false,
		configurable: true,
		writable: true,
	})
	return payload
}

function getAgentResolver(agent) {
	const type = agent?.meta?.type
	if (type === 'employee') {
		return {
			resolver: employeeResolver,
			label: 'Employee',
			failureReason: 'Employee not found',
		}
	}

	if (type === 'organization') {
		return {
			resolver: organizationResolver,
			label: 'Organization',
			failureReason: 'Organization not found',
		}
	}

	return {
		resolver: counterpartyResolver,
		label: 'Counterparty',
		failureReason: 'Counterparty not found',
	}
}

function getOperationMeta(operation) {
	return operation?.meta || operation?.operation?.meta || null
}

function getOperationEndpoint(type) {
	return OPERATION_ENDPOINT_BY_TYPE.get(type) || (type ? `entity/${type}` : '')
}

function cloneMetaWithLinkedSum(document, linkedSum) {
	const reference = toMetaReference(document)
	if (!reference) {
		return null
	}

	if (linkedSum !== undefined) {
		reference.linkedSum = linkedSum
	}
	return reference
}

async function loadOldOperationTarget(meta) {
	if (!meta?.href) {
		return null
	}

	if (!oldOperationTargetByHref.has(meta.href)) {
		oldOperationTargetByHref.set(
			meta.href,
			oldClient.get(getRelativeApiPath(meta.href)),
		)
	}

	return oldOperationTargetByHref.get(meta.href)
}

async function findNewOperationTarget(oldTarget, type) {
	const endpoint = getOperationEndpoint(type)
	if (!endpoint || !oldTarget?.externalCode) {
		return null
	}

	const key = `${type}:${oldTarget.externalCode}`
	if (!newOperationTargetByKey.has(key)) {
		newOperationTargetByKey.set(
			key,
			newClient.get(endpoint, {
				params: {
					filter: `externalCode=${oldTarget.externalCode}`,
					limit: 10,
					offset: 0,
				},
			}),
		)
	}

	const response = await newOperationTargetByKey.get(key)
	const rows = getRows(response)
	return rows[0] || null
}

async function mapGenericOperation(operation, payment) {
	const meta = getOperationMeta(operation)
	const type = meta?.type
	const oldTarget = await loadOldOperationTarget(meta)
	const newTarget = await findNewOperationTarget(oldTarget, type)
	const mapped = cloneMetaWithLinkedSum(newTarget, operation.linkedSum)

	if (!mapped) {
		throw new Error(
			`Mapped ${type || 'operation'} is missing for Payment ${payment.name || payment.id}`,
		)
	}

	return mapped
}

export class PaymentOutMapper {
	async map(
		payment,
		{
			purchaseOrderMetaByOldId = new Map(),
			supplyMetaByOldId = new Map(),
			requirePurchaseGraph = true,
		} = {},
	) {
		if (!isObject(payment)) {
			throw new Error('Outgoing Payment payload is required')
		}

		const purchaseGraphOperations = getPurchaseGraphOperations(payment)
		if (requirePurchaseGraph && !purchaseGraphOperations.length) {
			return null
		}

		const payload = {}
		copyScalarFields(payload, payment, SCALAR_FIELDS)
		const agent = getAgentResolver(payment.agent)
		await mapCommonDocumentReferences(payload, payment, {
			stateResolver: paymentOutStateResolver,
			attributeResolver: paymentOutAttributeResolver,
			requireStore: false,
			documentType: 'paymentout',
			agentResolver: agent.resolver,
			agentLabel: agent.label,
			agentFailureReason: agent.failureReason,
		})

		payload.expenseItem = await resolveRequiredReference(
			payment.expenseItem,
			expenseItemResolver,
			'Expense Item',
			'Expense Item not found',
		)

		const operations = requirePurchaseGraph
			? purchaseGraphOperations
			: getRows(payment.operations)

		const mappedOperations = []
		for (const operation of operations) {
			const type = getOperationType(operation)
			const oldId = getOperationId(operation)
			const mapped =
				type === 'purchaseorder'
					? purchaseOrderMetaByOldId.get(oldId)
					: supplyMetaByOldId.get(oldId)

			if (mapped) {
				const mappedOperation = { ...mapped }
				if (operation.linkedSum !== undefined) {
					mappedOperation.linkedSum = operation.linkedSum
				}
				mappedOperations.push(mappedOperation)
				continue
			}

			if (type === 'purchaseorder' || type === 'supply') {
				throw new Error(
					`Mapped ${type} is missing for Payment ${payment.name || payment.id}`,
				)
			}

			mappedOperations.push(await mapGenericOperation(operation, payment))
		}

		if (mappedOperations.length) {
			payload.operations = mappedOperations
		}

		return keepLocalPaymentName(removeUndefined(payload) || {}, payment)
	}
}

export const paymentOutMapper = new PaymentOutMapper()

export default paymentOutMapper
