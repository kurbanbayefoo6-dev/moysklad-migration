function normalizeString(value) {
	return String(value ?? '').trim()
}

function normalizeNumber(value) {
	const number = Number(value ?? 0)
	return Number.isFinite(number) ? Math.round(number * 1000000) / 1000000 : 0
}

export function getRows(value) {
	if (Array.isArray(value)) {
		return value
	}

	if (Array.isArray(value?.rows)) {
		return value.rows
	}

	if (Array.isArray(value?.items)) {
		return value.items
	}

	return []
}

export function getReferenceKey(reference) {
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

export function getEntityId(entity) {
	return (
		entity?.id ||
		entity?.meta?.href?.split('/').filter(Boolean).at(-1) ||
		entity?.href?.split('/').filter(Boolean).at(-1) ||
		''
	)
}

export function getDocumentNumber(document) {
	return document?.name || document?.number || document?.code || document?.id || ''
}

function calculatePositionTotal(position) {
	const quantity = normalizeNumber(position?.quantity)
	const price = normalizeNumber(position?.price)
	const discount = normalizeNumber(position?.discount)
	return quantity * price * (1 - discount / 100)
}

function getDocumentTotal(document) {
	if (document?.sum !== undefined) {
		return normalizeNumber(document.sum)
	}

	return normalizeNumber(
		getRows(document?.positions).reduce(
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

function getProductSet(document) {
	return getRows(document?.positions).map(getPositionIdentity).sort().join('||')
}

export function buildInventoryDocumentIdentity(document) {
	return {
		name: normalizeString(document?.name),
		moment: normalizeString(document?.moment),
		organization: getReferenceKey(document?.organization),
		agent: getReferenceKey(document?.agent),
		store: getReferenceKey(document?.store),
		total: getDocumentTotal(document),
		productSet: getProductSet(document),
	}
}

export function buildInventoryDocumentIdentityKey(document) {
	const identity = buildInventoryDocumentIdentity(document)
	return [
		identity.name,
		identity.moment,
		identity.organization,
		identity.agent,
		identity.store,
		identity.total,
		identity.productSet,
	].join('|')
}

function getOperationIdentity(operation) {
	const meta = operation?.meta || operation?.operation?.meta
	return [
		meta?.type || '',
		getEntityId(meta ? { meta } : operation?.operation),
		normalizeNumber(operation?.linkedSum),
	].join('~')
}

export function buildPaymentIdentity(payment) {
	return {
		name: normalizeString(payment?.name),
		moment: normalizeString(payment?.moment),
		organization: getReferenceKey(payment?.organization),
		agent: getReferenceKey(payment?.agent),
		total: normalizeNumber(payment?.sum),
		operations: getRows(payment?.operations).map(getOperationIdentity).sort().join('||'),
	}
}

export function buildPaymentIdentityKey(payment) {
	const identity = buildPaymentIdentity(payment)
	return [
		identity.name,
		identity.moment,
		identity.organization,
		identity.agent,
		identity.total,
		identity.operations,
	].join('|')
}

function compareIdentity(left, right, buildIdentity) {
	const leftIdentity = buildIdentity(left)
	const rightIdentity = buildIdentity(right)

	return Object.keys(leftIdentity)
		.filter(field => leftIdentity[field] !== rightIdentity[field])
		.map(field => ({
			field,
			left: leftIdentity[field],
			right: rightIdentity[field],
		}))
}

export function compareInventoryDocument(left, right) {
	const differences = compareIdentity(left, right, buildInventoryDocumentIdentity)
	const leftDescription = normalizeString(left?.description)
	const rightDescription = normalizeString(right?.description)

	if (leftDescription !== rightDescription) {
		differences.push({
			field: 'description',
			left: leftDescription,
			right: rightDescription,
		})
	}

	return differences
}

export function comparePayment(left, right) {
	return compareIdentity(left, right, buildPaymentIdentity)
}

export function buildIdentityMap(items, buildKey) {
	const map = new Map()

	for (const item of items) {
		const key = buildKey(item)
		if (!map.has(key)) {
			map.set(key, [])
		}
		map.get(key).push(item)
	}

	return map
}

export function findInventoryCandidates(expected, items) {
	const expectedIdentity = buildInventoryDocumentIdentity(expected)
	return items.filter(item => {
		const identity = buildInventoryDocumentIdentity(item)
		return (
			expectedIdentity.name &&
			expectedIdentity.moment &&
			expectedIdentity.name === identity.name &&
			expectedIdentity.moment === identity.moment
		)
	})
}

export function findPaymentCandidates(expected, items) {
	const expectedIdentity = buildPaymentIdentity(expected)
	return items.filter(item => {
		const identity = buildPaymentIdentity(item)
		return (
			expectedIdentity.name &&
			expectedIdentity.moment &&
			expectedIdentity.name === identity.name &&
			expectedIdentity.moment === identity.moment
		)
	})
}
