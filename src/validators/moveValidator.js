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

export function validateMovePayload(payload) {
	requireCondition(isObject(payload), 'Move payload is required')
	requireCondition(Boolean(payload.name), 'Move number is required')
	requireCondition(Boolean(payload.moment), 'Move moment is required')
	validateMetaReference(payload.organization, 'Move organization')
	validateMetaReference(payload.sourceStore, 'Move source warehouse')
	validateMetaReference(payload.targetStore, 'Move target warehouse')
	validateOptionalMetaReference(payload.owner, 'Move owner')
	validateOptionalMetaReference(payload.group, 'Move group')
	validateOptionalMetaReference(payload.state, 'Move state')
	validateOptionalMetaReference(payload.project, 'Move project')

	requireCondition(Array.isArray(payload.positions), 'Move positions must be an array')
	requireCondition(payload.positions.length > 0, 'Move positions are required')

	for (const position of payload.positions) {
		requireCondition(isObject(position), 'Move position is invalid')
		validateMetaReference(position.assortment, 'Move position assortment')
		requireCondition(
			position.quantity !== undefined,
			'Move position quantity is required',
		)
		if (position.price !== undefined) {
			requireCondition(
				Number.isFinite(Number(position.price)),
				'Move position price must be numeric',
			)
		}
		if (position.reserve !== undefined) {
			requireCondition(
				Number.isFinite(Number(position.reserve)),
				'Move position reserve must be numeric',
			)
		}
	}

	return payload
}

export default {
	validateMovePayload,
}
