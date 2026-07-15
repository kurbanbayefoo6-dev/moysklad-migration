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

export function validateCashInPayload(payload) {
	requireCondition(isObject(payload), 'CashIn payload is required')
	requireCondition(Boolean(payload.moment), 'CashIn moment is required')
	validateMetaReference(payload.organization, 'CashIn organization')
	validateMetaReference(payload.agent, 'CashIn counterparty')

	if (payload.operations !== undefined) {
		requireCondition(
			Array.isArray(payload.operations),
			'CashIn operations must be an array',
		)

		for (const operation of payload.operations) {
			validateMetaReference(operation, 'CashIn operation')
			requireCondition(
				operation.linkedSum === undefined ||
					Number.isFinite(Number(operation.linkedSum)),
				'CashIn operation linkedSum must be numeric',
			)
		}
	}

	return payload
}

export default {
	validateCashInPayload,
}
