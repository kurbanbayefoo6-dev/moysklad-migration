import {
	copyScalarFields,
	getEntityId,
	getRows,
	isObject,
	mapAssortmentPosition,
	mapCommonDocumentReferences,
	removeUndefined,
	supplyAttributeResolver,
	supplyStateResolver,
} from './purchaseChainMapperUtils.js'

const SCALAR_FIELDS = [
	'name',
	'moment',
	'applicable',
	'description',
	'externalCode',
	'vatEnabled',
	'vatIncluded',
	'incomingDate',
	'incomingNumber',
	'overhead',
]

export class SupplyMapper {
	async map(supply, { purchaseOrderMetaByOldId = new Map() } = {}) {
		if (!isObject(supply)) {
			throw new Error('Supply payload is required')
		}

		const payload = {}
		copyScalarFields(payload, supply, SCALAR_FIELDS)
		await mapCommonDocumentReferences(payload, supply, {
			stateResolver: supplyStateResolver,
			attributeResolver: supplyAttributeResolver,
			requireStore: true,
			documentType: 'supply',
		})

		const oldPurchaseOrderId = getEntityId(supply.purchaseOrder)
		if (oldPurchaseOrderId) {
			const purchaseOrder = purchaseOrderMetaByOldId.get(oldPurchaseOrderId)
			if (!purchaseOrder) {
				throw new Error(
					`Mapped Purchase Order is missing for Supply ${supply.name || supply.id}`,
				)
			}
			payload.purchaseOrder = purchaseOrder
		}

		payload.positions = await Promise.all(
			getRows(supply.positions).map(position =>
				mapAssortmentPosition(position, supply),
			),
		)

		return removeUndefined(payload) || {}
	}
}

export const supplyMapper = new SupplyMapper()

export default supplyMapper
