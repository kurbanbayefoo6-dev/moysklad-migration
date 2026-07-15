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

export function validateInventoryPayload(payload) {
	requireCondition(isObject(payload), 'Inventory payload is required')
	requireCondition(Boolean(payload.moment), 'Inventory moment is required')
	validateMetaReference(payload.organization, 'Inventory organization')
	validateMetaReference(payload.store, 'Inventory warehouse')
	validateOptionalMetaReference(payload.owner, 'Inventory owner')
	validateOptionalMetaReference(payload.state, 'Inventory state')
	validateOptionalMetaReference(payload.project, 'Inventory project')

	requireCondition(
		Array.isArray(payload.positions),
		'Inventory positions must be an array',
	)
	requireCondition(payload.positions.length > 0, 'Inventory positions are required')

	for (const position of payload.positions) {
		requireCondition(isObject(position), 'Inventory position is invalid')
		validateMetaReference(position.assortment, 'Inventory position assortment')
		requireCondition(
			position.quantity !== undefined,
			'Inventory position quantity is required',
		)
		if (position.price !== undefined) {
			requireCondition(
				Number.isFinite(Number(position.price)),
				'Inventory position price must be numeric',
			)
		}
	}

	return payload
}

export default {
	validateInventoryPayload,
}
