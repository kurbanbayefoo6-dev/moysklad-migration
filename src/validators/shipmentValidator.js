function isObject(value) {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function requireCondition(condition, message) {
	if (!condition) {
		throw new Error(message)
	}
}

export function validateShipmentPayload(payload) {
	requireCondition(isObject(payload), 'Shipment payload is required')
	requireCondition(
		Array.isArray(payload.positions),
		'Shipment positions must be an array',
	)

	for (const position of payload.positions) {
		requireCondition(isObject(position), 'Shipment position is invalid')
		requireCondition(
			isObject(position.assortment),
			'Shipment position assortment is required',
		)
		requireCondition(
			isObject(position.assortment.meta),
			'Shipment position assortment meta is required',
		)
	}

	return payload
}

export default validateShipmentPayload
