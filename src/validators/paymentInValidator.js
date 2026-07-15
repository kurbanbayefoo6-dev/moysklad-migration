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

export function validatePaymentInPayload(payload) {
	requireCondition(isObject(payload), 'Incoming Payment payload is required')
	requireCondition(Boolean(payload.moment), 'Incoming Payment moment is required')
	validateMetaReference(payload.organization, 'Incoming Payment organization')
	validateMetaReference(payload.agent, 'Incoming Payment counterparty')

	if (payload.operations !== undefined) {
		requireCondition(
			Array.isArray(payload.operations),
			'Incoming Payment operations must be an array',
		)

		for (const operation of payload.operations) {
			validateMetaReference(operation, 'Incoming Payment operation')
			requireCondition(
				operation.linkedSum === undefined ||
					Number.isFinite(Number(operation.linkedSum)),
				'Incoming Payment operation linkedSum must be numeric',
			)
		}
	}

	return payload
}

export default {
	validatePaymentInPayload,
}
