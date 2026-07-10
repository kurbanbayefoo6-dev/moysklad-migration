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

export function validateShipmentPayload(payload) {
	requireCondition(isObject(payload), 'Shipment payload is required')
	requireCondition(Boolean(payload.name), 'Shipment number is required')
	requireCondition(Boolean(payload.moment), 'Shipment moment is required')
	validateMetaReference(payload.organization, 'Shipment organization')
	validateMetaReference(payload.store, 'Shipment warehouse')
	validateMetaReference(payload.agent, 'Shipment counterparty')
	requireCondition(
		Array.isArray(payload.positions),
		'Shipment positions must be an array',
	)

	for (const position of payload.positions) {
		requireCondition(isObject(position), 'Shipment position is invalid')
		validateMetaReference(position.assortment, 'Shipment position assortment')
		requireCondition(
			position.quantity !== undefined,
			'Shipment position quantity is required',
		)
	}

	return payload
}

export default validateShipmentPayload
