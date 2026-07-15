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

export function validateEnterPayload(payload) {
	requireCondition(isObject(payload), 'Enter payload is required')
	requireCondition(Boolean(payload.moment), 'Enter moment is required')
	validateMetaReference(payload.organization, 'Enter organization')
	validateMetaReference(payload.store, 'Enter warehouse')
	validateOptionalMetaReference(payload.owner, 'Enter owner')
	validateOptionalMetaReference(payload.state, 'Enter state')
	validateOptionalMetaReference(payload.project, 'Enter project')

	requireCondition(Array.isArray(payload.positions), 'Enter positions must be an array')
	requireCondition(payload.positions.length > 0, 'Enter positions are required')

	for (const position of payload.positions) {
		requireCondition(isObject(position), 'Enter position is invalid')
		validateMetaReference(position.assortment, 'Enter position assortment')
		requireCondition(
			position.quantity !== undefined,
			'Enter position quantity is required',
		)
		if (position.price !== undefined) {
			requireCondition(
				Number.isFinite(Number(position.price)),
				'Enter position price must be numeric',
			)
		}
	}

	return payload
}

export default {
	validateEnterPayload,
}
