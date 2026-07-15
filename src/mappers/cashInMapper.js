import { newClient } from '../api/newClient.js'
import { oldClient } from '../api/oldClient.js'
import {
	cashInAttributeResolver,
	cashInStateResolver,
	copyScalarFields,
	getRelativeApiPath,
	getRows,
	isObject,
	mapCommonDocumentReferences,
	removeUndefined,
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

const OPERATION_ENDPOINT_BY_TYPE = new Map([
	['customerorder', 'entity/customerorder'],
	['demand', 'entity/demand'],
	['invoiceout', 'entity/invoiceout'],
	['retaildemand', 'entity/retaildemand'],
	['salesreturn', 'entity/salesreturn'],
	['commissionreportout', 'entity/commissionreportout'],
])

const oldOperationTargetByHref = new Map()
const newOperationTargetByKey = new Map()

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

async function mapOperation(operation, cashIn) {
	const meta = getOperationMeta(operation)
	const type = meta?.type
	const oldTarget = await loadOldOperationTarget(meta)
	const newTarget = await findNewOperationTarget(oldTarget, type)
	const mapped = cloneMetaWithLinkedSum(newTarget, operation.linkedSum)

	if (!mapped) {
		throw new Error(
			`Mapped ${type || 'operation'} is missing for CashIn ${
				cashIn.name || cashIn.id
			}`,
		)
	}

	return mapped
}

function keepLocalCashInName(payload, cashIn) {
	if (!cashIn.name) {
		return payload
	}

	Object.defineProperty(payload, 'name', {
		value: cashIn.name,
		enumerable: false,
		configurable: true,
		writable: true,
	})
	return payload
}

export class CashInMapper {
	async map(cashIn) {
		if (!isObject(cashIn)) {
			throw new Error('CashIn payload is required')
		}

		const payload = {}
		copyScalarFields(payload, cashIn, SCALAR_FIELDS)
		await mapCommonDocumentReferences(payload, cashIn, {
			stateResolver: cashInStateResolver,
			attributeResolver: cashInAttributeResolver,
			requireStore: false,
			documentType: 'cashin',
		})

		const operations = getRows(cashIn.operations)
		if (operations.length) {
			payload.operations = await Promise.all(
				operations.map(operation => mapOperation(operation, cashIn)),
			)
		}

		return keepLocalCashInName(removeUndefined(payload) || {}, cashIn)
	}
}

export const cashInMapper = new CashInMapper()

export default cashInMapper
