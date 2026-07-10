function isObject(value) {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeString(value) {
	return String(value ?? '').trim()
}

function normalizeNumber(value) {
	const number = Number(value ?? 0)
	return Number.isFinite(number) ? Math.round(number * 1000000) / 1000000 : 0
}

function getPositions(shipment) {
	if (Array.isArray(shipment?.positions)) {
		return shipment.positions
	}

	if (Array.isArray(shipment?.positions?.rows)) {
		return shipment.positions.rows
	}

	return []
}

function getReferenceKey(reference) {
	return normalizeString(
		reference?.meta?.href ||
			reference?.id ||
			reference?.meta?.uuidHref ||
			reference?.name ||
			reference?.externalCode ||
			reference?.code ||
			'',
	)
}

function getCounterpartyReference(shipment) {
	return shipment?.agent || shipment?.counterparty
}

function calculatePositionTotal(position) {
	const quantity = normalizeNumber(position?.quantity)
	const price = normalizeNumber(position?.price)
	const discount = normalizeNumber(position?.discount)
	return quantity * price * (1 - discount / 100)
}

function getShipmentTotal(shipment) {
	if (shipment?.sum !== undefined) {
		return normalizeNumber(shipment.sum)
	}

	if (shipment?.totalSum !== undefined) {
		return normalizeNumber(shipment.totalSum)
	}

	return normalizeNumber(
		getPositions(shipment).reduce(
			(total, position) => total + calculatePositionTotal(position),
			0,
		),
	)
}

function getPositionIdentity(position) {
	return [
		getReferenceKey(position?.assortment),
		normalizeNumber(position?.quantity),
		normalizeNumber(position?.price),
		normalizeNumber(position?.discount),
		normalizeString(position?.vat),
		normalizeString(position?.vatEnabled),
	].join('~')
}

function getProductSet(shipment) {
	return getPositions(shipment)
		.map(getPositionIdentity)
		.sort()
		.join('||')
}

export function buildShipmentIdentity(shipment) {
	return {
		moment: normalizeString(shipment?.moment),
		organization: getReferenceKey(shipment?.organization),
		counterparty: getReferenceKey(getCounterpartyReference(shipment)),
		warehouse: getReferenceKey(shipment?.store),
		total: getShipmentTotal(shipment),
		productSet: getProductSet(shipment),
	}
}

export function buildShipmentIdentityKey(shipment) {
	const identity = buildShipmentIdentity(shipment)
	return [
		identity.moment,
		identity.organization,
		identity.counterparty,
		identity.warehouse,
		identity.total,
		identity.productSet,
	].join('|')
}

export function compareShipmentIdentity(left, right) {
	const leftIdentity = buildShipmentIdentity(left)
	const rightIdentity = buildShipmentIdentity(right)
	const fields = [
		'moment',
		'organization',
		'counterparty',
		'warehouse',
		'total',
		'productSet',
	]

	return fields
		.filter(field => leftIdentity[field] !== rightIdentity[field])
		.map(field => ({
			field,
			left: leftIdentity[field],
			right: rightIdentity[field],
		}))
}

export function shipmentIdentitiesMatch(left, right) {
	return compareShipmentIdentity(left, right).length === 0
}

export function compareShipmentContent(left, right) {
	const identityDifferences = compareShipmentIdentity(left, right)
	const differences = [...identityDifferences]
	const leftComment = normalizeString(left?.description)
	const rightComment = normalizeString(right?.description)

	if (leftComment !== rightComment) {
		differences.push({
			field: 'comment',
			left: leftComment,
			right: rightComment,
		})
	}

	return differences
}

export function prepareShipmentForIdentity(mappedShipment, sourceShipment = {}) {
	return {
		...mappedShipment,
		sum: sourceShipment?.sum ?? mappedShipment?.sum,
		description: sourceShipment?.description ?? mappedShipment?.description,
	}
}

export function buildShipmentIdentityMap(shipments) {
	const map = new Map()

	for (const shipment of shipments) {
		const key = buildShipmentIdentityKey(shipment)
		if (!map.has(key)) {
			map.set(key, [])
		}
		map.get(key).push(shipment)
	}

	return map
}

export function findShipmentIdentityCandidates(expectedShipment, shipments) {
	const expectedIdentity = buildShipmentIdentity(expectedShipment)

	return shipments.filter(shipment => {
		const shipmentIdentity = buildShipmentIdentity(shipment)
		return (
			expectedIdentity.moment &&
			expectedIdentity.organization &&
			expectedIdentity.counterparty &&
			expectedIdentity.warehouse &&
			expectedIdentity.moment === shipmentIdentity.moment &&
			expectedIdentity.organization === shipmentIdentity.organization &&
			expectedIdentity.counterparty === shipmentIdentity.counterparty &&
			expectedIdentity.warehouse === shipmentIdentity.warehouse
		)
	})
}

export function describeShipmentIdentity(shipment) {
	const identity = buildShipmentIdentity(shipment)
	return Object.entries(identity)
		.map(([key, value]) => `${key}: ${isObject(value) ? JSON.stringify(value) : value}`)
		.join('\n')
}
