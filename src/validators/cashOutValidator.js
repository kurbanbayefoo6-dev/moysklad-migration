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

export function validateCashOutPayload(payload) {
	requireCondition(isObject(payload), 'CashOut payload is required')
	requireCondition(Boolean(payload.moment), 'CashOut moment is required')
	validateMetaReference(payload.organization, 'CashOut organization')
	validateMetaReference(payload.agent, 'CashOut counterparty')
	validateMetaReference(payload.expenseItem, 'CashOut expense item')

	if (payload.operations !== undefined) {
		requireCondition(
			Array.isArray(payload.operations),
			'CashOut operations must be an array',
		)

		for (const operation of payload.operations) {
			validateMetaReference(operation, 'CashOut operation')
			requireCondition(
				operation.linkedSum === undefined ||
					Number.isFinite(Number(operation.linkedSum)),
				'CashOut operation linkedSum must be numeric',
			)
		}
	}

	return payload
}

export default {
	validateCashOutPayload,
}
