function isObject(value) {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function requireCondition(condition, message) {
	if (!condition) {
		throw new Error(message)
	}
}

function validateMetaReference(reference, label) {
	requireCondition(isObject(reference), `${label} is required`)
	requireCondition(isObject(reference.meta), `${label} meta is required`)
	requireCondition(Boolean(reference.meta.href), `${label} meta.href is required`)
	requireCondition(Boolean(reference.meta.type), `${label} meta.type is required`)
	requireCondition(
		Boolean(reference.meta.mediaType),
		`${label} meta.mediaType is required`,
	)
}

function validatePositions(payload, label) {
	requireCondition(Array.isArray(payload.positions), `${label} positions must be an array`)

	for (const position of payload.positions) {
		requireCondition(isObject(position), `${label} position is invalid`)
		validateMetaReference(position.assortment, `${label} position assortment`)
		requireCondition(
			position.quantity !== undefined,
			`${label} position quantity is required`,
		)
	}
}

export function validatePurchaseOrderPayload(payload) {
	requireCondition(isObject(payload), 'Purchase Order payload is required')
	requireCondition(Boolean(payload.name), 'Purchase Order number is required')
	requireCondition(Boolean(payload.moment), 'Purchase Order moment is required')
	validateMetaReference(payload.organization, 'Purchase Order organization')
	validateMetaReference(payload.agent, 'Purchase Order counterparty')
	validateMetaReference(payload.store, 'Purchase Order warehouse')
	validatePositions(payload, 'Purchase Order')
	return payload
}

export function validateSupplyPayload(payload) {
	requireCondition(isObject(payload), 'Supply payload is required')
	requireCondition(Boolean(payload.name), 'Supply number is required')
	requireCondition(Boolean(payload.moment), 'Supply moment is required')
	validateMetaReference(payload.organization, 'Supply organization')
	validateMetaReference(payload.agent, 'Supply counterparty')
	validateMetaReference(payload.store, 'Supply warehouse')
	validatePositions(payload, 'Supply')
	return payload
}

export function validatePaymentOutPayload(
	payload,
	{
		requirePurchaseGraphOperations = true,
		allowedOperationTypes = ['purchaseorder', 'supply'],
	} = {},
) {
	requireCondition(isObject(payload), 'Outgoing Payment payload is required')
	requireCondition(Boolean(payload.name), 'Outgoing Payment number is required')
	requireCondition(Boolean(payload.moment), 'Outgoing Payment moment is required')
	validateMetaReference(payload.organization, 'Outgoing Payment organization')
	validateMetaReference(payload.agent, 'Outgoing Payment counterparty')
	validateMetaReference(payload.expenseItem, 'Outgoing Payment expense item')
	if (requirePurchaseGraphOperations) {
		requireCondition(
			Array.isArray(payload.operations) && payload.operations.length > 0,
			'Outgoing Payment operations must contain Purchase graph links',
		)
	}

	if (payload.operations !== undefined) {
		requireCondition(
			Array.isArray(payload.operations),
			'Outgoing Payment operations must be an array',
		)
	}

	for (const operation of payload.operations || []) {
		validateMetaReference(operation, 'Outgoing Payment operation')
		requireCondition(
			operation.linkedSum === undefined ||
				Number.isFinite(Number(operation.linkedSum)),
			'Outgoing Payment operation linkedSum must be numeric',
		)
		if (allowedOperationTypes) {
			requireCondition(
				allowedOperationTypes.includes(operation.meta.type),
				`Outgoing Payment operation must link ${allowedOperationTypes.join(', ')}`,
			)
		}
	}

	return payload
}

export default {
	validatePurchaseOrderPayload,
	validateSupplyPayload,
	validatePaymentOutPayload,
}
