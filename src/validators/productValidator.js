function isObject(value) {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function requireCondition(condition, message) {
	if (!condition) {
		throw new Error(message)
	}
}

export function validateProductPayload(payload) {
	requireCondition(isObject(payload), 'Product payload is required')
	requireCondition(
		typeof payload.name === 'string' && payload.name.trim(),
		'Product name is required',
	)

	if (payload.salePrices !== undefined) {
		requireCondition(
			Array.isArray(payload.salePrices),
			'Product salePrices must be an array',
		)
	}

	if (payload.uom !== undefined) {
		requireCondition(isObject(payload.uom), 'Product uom must be an object')
		requireCondition(
			isObject(payload.uom.meta),
			'Product uom meta is required when uom is provided',
		)
	}

	return payload
}

export default validateProductPayload
