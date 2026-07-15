import { newClient } from '../api/newClient.js'
import { oldClient } from '../api/oldClient.js'
import { contractResolver } from '../resolvers/ContractResolver.js'
import { counterpartyResolver } from '../resolvers/CounterpartyResolver.js'
import { employeeResolver } from '../resolvers/EmployeeResolver.js'
import { expenseItemResolver } from '../resolvers/ExpenseItemResolver.js'
import { organizationResolver } from '../resolvers/OrganizationResolver.js'
import { projectResolver } from '../resolvers/ProjectResolver.js'
import {
	cashOutAttributeResolver,
	cashOutStateResolver,
	copyScalarFields,
	getRelativeApiPath,
	getRows,
	isObject,
	mapAccount,
	mapAttributes,
	mapRate,
	removeUndefined,
	resolveOptionalReference,
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

const OPERATION_ENDPOINT_BY_TYPE = new Map([
	['purchaseorder', 'entity/purchaseorder'],
	['supply', 'entity/supply'],
	['invoicein', 'entity/invoicein'],
	['purchasereturn', 'entity/purchasereturn'],
	['commissionreportin', 'entity/commissionreportin'],
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

async function mapOperation(operation, cashOut) {
	const meta = getOperationMeta(operation)
	const type = meta?.type
	const oldTarget = await loadOldOperationTarget(meta)
	const newTarget = await findNewOperationTarget(oldTarget, type)
	const mapped = cloneMetaWithLinkedSum(newTarget, operation.linkedSum)

	if (!mapped) {
		throw new Error(
			`Mapped ${type || 'operation'} is missing for CashOut ${
				cashOut.name || cashOut.id
			}`,
		)
	}

	return mapped
}

function keepLocalCashOutName(payload, cashOut) {
	if (!cashOut.name) {
		return payload
	}

	Object.defineProperty(payload, 'name', {
		value: cashOut.name,
		enumerable: false,
		configurable: true,
		writable: true,
	})
	return payload
}

function getAgentResolver(agent) {
	const type = agent?.meta?.type
	if (type === 'employee') {
		return employeeResolver
	}

	if (type === 'organization') {
		return organizationResolver
	}

	return counterpartyResolver
}

async function mapCashOutReferences(payload, cashOut) {
	payload.organization = await resolveRequiredReference(
		cashOut.organization,
		organizationResolver,
		'Organization',
		'Organization not found',
	)
	payload.agent = await resolveRequiredReference(
		cashOut.agent,
		getAgentResolver(cashOut.agent),
		'Agent',
		'Agent not found',
	)

	const contract = await resolveOptionalReference(
		cashOut.contract,
		contractResolver,
		'Contract',
		'Contract not found',
	)
	if (contract) {
		payload.contract = contract
	}

	const project = await resolveOptionalReference(
		cashOut.project,
		projectResolver,
		'Project',
		'Project not found',
	)
	if (project) {
		payload.project = project
	}

	const state = await resolveOptionalReference(
		cashOut.state,
		cashOutStateResolver,
		'State',
	)
	if (state) {
		payload.state = state
	}

	const rate = await mapRate(cashOut.rate, {
		documentType: 'cashout',
		document: cashOut,
	})
	if (rate) {
		payload.rate = rate
	}

	const organizationAccount = await mapAccount(
		cashOut.organizationAccount,
		payload.organization,
	)
	if (organizationAccount) {
		payload.organizationAccount = organizationAccount
	}

	const agentAccount = await mapAccount(cashOut.agentAccount, payload.agent)
	if (agentAccount) {
		payload.agentAccount = agentAccount
	}

	const attributes = await mapAttributes(
		cashOut.attributes,
		cashOutAttributeResolver,
	)
	if (attributes) {
		payload.attributes = attributes
	}
}

export class CashOutMapper {
	async map(cashOut) {
		if (!isObject(cashOut)) {
			throw new Error('CashOut payload is required')
		}

		const payload = {}
		copyScalarFields(payload, cashOut, SCALAR_FIELDS)
		await mapCashOutReferences(payload, cashOut)

		payload.expenseItem = await resolveRequiredReference(
			cashOut.expenseItem,
			expenseItemResolver,
			'Expense Item',
			'Expense Item not found',
		)

		const operations = getRows(cashOut.operations)
		if (operations.length) {
			payload.operations = await Promise.all(
				operations.map(operation => mapOperation(operation, cashOut)),
			)
		}

		return keepLocalCashOutName(removeUndefined(payload) || {}, cashOut)
	}
}

export const cashOutMapper = new CashOutMapper()

export default cashOutMapper
