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

function validateOptionalMetaReference(reference, label) {
	if (reference !== undefined) {
		validateMetaReference(reference, label)
	}
}

export function validateLossPayload(payload) {
	requireCondition(isObject(payload), 'Loss payload is required')
	requireCondition(Boolean(payload.moment), 'Loss moment is required')
	validateMetaReference(payload.organization, 'Loss organization')
	validateMetaReference(payload.store, 'Loss warehouse')
	validateOptionalMetaReference(payload.owner, 'Loss owner')
	validateOptionalMetaReference(payload.state, 'Loss state')
	validateOptionalMetaReference(payload.project, 'Loss project')

	requireCondition(Array.isArray(payload.positions), 'Loss positions must be an array')
	requireCondition(payload.positions.length > 0, 'Loss positions are required')

	for (const position of payload.positions) {
		requireCondition(isObject(position), 'Loss position is invalid')
		validateMetaReference(position.assortment, 'Loss position assortment')
		requireCondition(
			position.quantity !== undefined,
			'Loss position quantity is required',
		)
		if (position.price !== undefined) {
			requireCondition(
				Number.isFinite(Number(position.price)),
				'Loss position price must be numeric',
			)
		}
	}

	return payload
}

export default {
	validateLossPayload,
}
